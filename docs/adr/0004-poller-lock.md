# ADR-0004: Poller lock for single-instance enforcement

- Status: Proposed
- Date: 2026-07-30
- Supersedes: — (extends ADR-0001)

## Context

ADR-0001 established Pigram as session-local: the bridge lives inside a pi
session and dies with it. This keeps setup simple, but creates a blind spot
when **two pi processes share the same bot token**:

| Scenario | What happens |
|---|---|
| **Multiplexer** — user opens tmux pane A and B in the same project dir | Both load `.pi/pigram.json` (same `botToken`). Both call `getUpdates`. Telegram returns 409 to one of them. They ping-pong 409s every 3 s until one session ends. |
| **Sub-agent** — Pi spawns a child via `delegate_task` | Child process loads the same extension, starts its own poller. Same 409 conflict. |
| **Global config** — two different projects with `~/.pi/agent/pigram.json` | Same conflict if both sessions start polling the same global bot. |

Today's only mitigation is `POLL_CONFLICT_BACKOFF_MS` (3 s backoff on 409).
This is **reactive** — the conflict already happened, Telegram delivery is
degraded (some updates may be swallowed by the wrong consumer), and the
status bar flickers between error and connected.

### Why not just skip the extension in sub-agents?

Pi does not expose a "is this a sub-agent session" signal to extensions.
Even if it did, the multiplexer scenario is the primary one — two top-level
pi sessions in different terminals, both legitimate, both loading the same
project config.

### Why not a daemon?

ADR-0001 explicitly rejects background services. A daemon would solve this
cleanly (single poller process, IPC to bridge instances) but contradicts
the zero-config, session-local philosophy. This ADR proposes a lighter
mechanism that preserves that property.

## Decision

Introduce a **file-based cooperative lock** at the poller level. The lock
lives alongside existing State files (in the scope's `tmp/pigram/` directory)
and uses three primitives: claim, heartbeat, and release.

### Lock file location

```
<scope>/tmp/pigram/lock.json
```

- **Project scope**: `<project>/.pi/tmp/pigram/lock.json`
- **Global scope**: `~/.pi/agent/tmp/pigram/lock.json`

Same directory as `state.json` — no new paths to manage.

### Lock file format

```jsonc
{
  "pid": 12345,                 // OS process ID of the holder
  "tokenHash": "a1b2c3...",     // SHA-256 of botToken (never store raw token)
  "startedAt": "2026-07-30T09:00:00Z",  // ISO-8601, for diagnostics
  "heartbeat": "2026-07-30T09:05:30Z"   // last liveness tick
}
```

### Lock lifecycle

```
startPolling()
  │
  ├─ read lock.json
  │   ├─ doesn't exist → WRITE lock with my PID → start polling
  │   └─ exists → check PID liveness
  │       ├─ PID alive + same tokenHash → REFUSE (another instance owns this bot)
  │       ├─ PID alive + different tokenHash → WRITE new lock (different bot, no conflict)
  │       └─ PID dead (stale) → STEAL lock (overwrite with my PID) → start polling
  │
  ├─ while polling: heartbeat every 10s (touch "heartbeat" field)
  │
  └─ on stop/crash: delete lock.json (best-effort)
```

### PID liveness check

```typescript
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no actual signal sent
    return true;
  } catch {
    return false;
  }
}
```

Cross-platform: works on Linux, macOS, Windows. Signal 0 is POSIX-standard
for "are you there?" without side effects.

### Stale lock recovery

A lock is stale when its `pid` no longer exists. This handles:
- Pi crashed without cleanup (SIGKILL, OOM-kill)
- User killed pi with `kill -9`
- Machine reboot (PID namespace resets)

The `heartbeat` field is **not used for staleness detection** — PID check is
authoritative. Heartbeat exists purely for diagnostics (shown in status output).

### Sub-agent behavior

Sub-agents are separate OS processes with their own PID. When a sub-agent's
Pi session loads Pigram and calls `startPolling()`:

1. It reads lock.json → finds parent's PID → PID is alive → **refuses silently**
2. Sub-agent Pi session operates without Telegram (desktop-only, as if Pigram
   were not installed)
3. When sub-agent exits, no lock cleanup needed (it never acquired one)

This is the correct behavior: the parent session owns the Telegram connection,
sub-agents are ephemeral workers that don't need bot access.

### What the user sees

**When lock is acquired (happy path):**
- Same as today — footer shows bot username + scope + config path.

**When lock is refused (another instance holds it):**
- Status bar: `pigram: held by PID 12345 (started 5m ago)`
- Silent skip — no Telegram message, no error. The other instance handles
  the bot.
- `pigram-status` command shows: `polling: blocked (PID 12345 holds this bot)`

**When a stale lock is stolen:**
- Status bar: `pigram: reclaimed stale lock (previous PID 12345)`
- Normal polling resumes.

### Atomicity

Two instances starting at the exact same millisecond could both read
"no lock" and both write. To prevent this:

1. **Write-then-verify**: Write lock with `wx` flag (exclusive create).
   - If `wx` succeeds → we own the lock.
   - If `wx` fails with `EEXIST` → another instance won the race → re-read
     and follow the normal PID-check flow.
2. On platforms where `wx` is unreliable (older Node on Windows), fall back
   to write + re-read + verify PID. The window is microseconds; acceptable
   for a cooperative (not adversarial) lock.

```typescript
import { writeFile, readFile, unlink } from "node:fs/promises";

async function tryAcquireLock(lockPath: string, tokenHash: string): Promise<
  | { acquired: true }
  | { acquired: false; holderPid: number; holderSince: string }
> {
  const payload = JSON.stringify({
    pid: process.pid,
    tokenHash,
    startedAt: new Date().toISOString(),
    heartbeat: new Date().toISOString(),
  });

  try {
    await writeFile(lockPath, payload, { flag: "wx" });
    return { acquired: true };
  } catch (err: unknown) {
    if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err; // unexpected I/O error
    }
    // Lock exists — check who holds it.
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    if (existing.pid === process.pid) {
      return { acquired: true }; // we already hold it (re-entry)
    }
    if (isPidAlive(existing.pid) && existing.tokenHash === tokenHash) {
      return { acquired: false, holderPid: existing.pid, holderSince: existing.startedAt };
    }
    // Stale lock — steal it.
    await writeFile(lockPath, payload, { flag: "w" });
    // Re-read to confirm we won the steal (another instance may have raced).
    const verify = JSON.parse(await readFile(lockPath, "utf8"));
    if (verify.pid === process.pid) {
      return { acquired: true };
    }
    // Lost the steal race — treat as blocked.
    return { acquired: false, holderPid: verify.pid, holderSince: verify.startedAt };
  }
}
```

### Heartbeat

A `setInterval` at 10 s updates the `heartbeat` field in lock.json.
This is purely informational — shown in `pigram-status` and useful for
debugging ("lock held for 3h, last heartbeat 2s ago → healthy").

```typescript
const heartbeatInterval = setInterval(async () => {
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    if (lock.pid === process.pid) {
      lock.heartbeat = new Date().toISOString();
      await writeFile(lockPath, JSON.stringify(lock));
    }
  } catch {
    // best-effort; if lock file is gone, we've been superseded
  }
}, 10_000);
```

### Cleanup

On `stopPolling()` and `session_shutdown`:
```typescript
await unlink(lockPath).catch(() => {}); // best-effort
clearInterval(heartbeatInterval);
```

Best-effort is fine: stale lock recovery handles the crash case.

## Consequences

### Positive

- **No more 409 ping-pong.** Only one instance polls per bot token. Clean
  Telegram connection, no swallowed updates.
- **Sub-agents work correctly.** They silently yield the bot to the parent
  session.
- **Multiplexer-safe.** User can open 10 terminals; only the first one that
  acquires the lock polls Telegram. Rest operate desktop-only.
- **Zero new dependencies.** Uses `fs.writeFile` with `wx`, `process.kill(pid, 0)`,
  `setInterval`. All Node.js built-ins.
- **Fits ADR-0001.** No daemon, no system service. Lock is a file in the
  existing temp directory. Session-local philosophy preserved.
- **Transparent.** `pigram-status` shows who holds the lock and since when.

### Negative

- **Filesystem latency.** Lock read/write adds ~1ms to startup. Negligible.
- **Heartbeat churn.** Every 10s, a small JSON write. The state file already
  churns on every poll (cursor update), so this is not new.
- **Stale lock window.** If a process is SIGKILL'd, the lock is stale until
  the next `startPolling` call checks PID. Max staleness = time until next
  Pi session starts in that scope. Acceptable — the bot just appears offline
  during that window (which it would anyway, since the dead process stopped
  polling).

### Neutral

- Lock file is added to `.gitignore` (alongside state.json in tmp/).
- No schema changes to `PigramConfig` or `PigramState`. Lock is a new,
  independent file.

## Implementation notes

### New module: `src/config/lock.ts`

```
Exports:
  acquireLock(lockPath, tokenHash) → { acquired, holderPid?, holderSince? }
  releaseLock(lockPath) → void
  startHeartbeat(lockPath) → stop function
  isPidAlive(pid) → boolean
```

### Integration points in `src/index.ts`

1. **`startPolling()`** — call `acquireLock()` before creating transport.
   If not acquired, set status bar message and return early.
2. **`stopPolling()`** — call `releaseLock()` after aborting the poller.
3. **`session_shutdown` handler** — call `releaseLock()` (already calls
   `stopPolling()` which will do it).
4. **`pigram-status` command** — include lock holder info when polling is
   blocked.

### Tests

- **Unit tests** for `lock.ts`:
  - `tryAcquireLock` on fresh path → acquired
  - `tryAcquireLock` when lock held by dead PID → steal → acquired
  - `tryAcquireLock` when lock held by live PID → not acquired, returns holder info
  - `releaseLock` deletes file
  - `isPidAlive` with own PID → true
  - `isPidAlive` with PID 999999 → false
  - Concurrent `tryAcquireLock` (two async calls with `wx`) → exactly one wins

- **Integration test** in `index.ts` test suite:
  - Mock `isPidAlive` to return false → verify lock stolen
  - Mock `isPidAlive` to return true → verify polling skipped
  - Verify status bar message on lock refusal

### Migration

None. Lock file is additive. Existing installations continue to work.
Old Pigram versions ignore the lock file (they don't read it).

## Alternatives considered

### A. Telegram `getMe` as ownership signal

Attempt a single `getUpdates` call; if 409, assume another instance owns it.
**Rejected**: Telegram's 409 is not deterministic — two pollers can both
succeed briefly before the conflict surfaces. Also, this burns a Telegram API
call just to discover what a file check could tell instantly.

### B. Cooperative handoff via OS signal (SIGUSR1)

New instance sends SIGUSR1 to lock holder → holder gracefully stops → new
instance takes over.
**Deferred**: Smoother UX (auto-switchover), but significantly more complex.
Needs cross-platform signal handling, re-entry guards, and race condition
management. Can be layered on top of the file lock in a future ADR if demand
exists.

### C. Socket-based IPC (Unix domain socket)

Lock holder listens on a UDS; new instances connect to negotiate ownership.
**Rejected**: Over-engineered for a cooperative lock. Adds socket lifecycle
management, platform-specific paths, and error handling for a problem that
a simple file solves.

### D. Global system-wide lock (single file in `/tmp`)

One lock file regardless of scope.
**Rejected**: Different scopes use different bot tokens. A project-scoped bot
should not block a global-scoped bot, and vice versa. Per-scope locks are
the correct granularity.
