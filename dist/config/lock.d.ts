/** Shape of the lock file on disk. */
export interface LockInfo {
    pid: number;
    tokenHash: string;
    startedAt: string;
    heartbeat: string;
}
/** Result of a lock acquisition attempt. */
export type LockResult = {
    acquired: true;
} | {
    acquired: false;
    holderPid: number;
    holderSince: string;
};
/**
 * Check whether a process with the given PID is alive.
 *
 * Uses signal 0 (POSIX existence check) — no actual signal is sent.
 * Works on Linux, macOS, and Windows (Node.js translates internally).
 */
export declare function isPidAlive(pid: number): boolean;
/**
 * Attempt to acquire the poller lock.
 *
 * Strategy:
 * 1. Try exclusive create (wx flag) — wins if no lock exists.
 * 2. If EEXIST, read the existing lock:
 *    a. Same PID → re-entry, already own it.
 *    b. Different PID, alive, same tokenHash → blocked (another instance).
 *    c. Different PID, dead → steal the lock (write + verify).
 *    d. Different PID, alive, different tokenHash → different bot, no conflict.
 */
export declare function tryAcquireLock(lockPath: string, tokenHash: string): Promise<LockResult>;
/**
 * Release the poller lock by deleting the lock file.
 * Best-effort: no-op if the file doesn't exist.
 */
export declare function releaseLock(lockPath: string): Promise<void>;
/**
 * Update the heartbeat field in the lock file.
 * Best-effort: silently ignored if the lock file is gone or unwritable.
 */
export declare function touchHeartbeat(lockPath: string): Promise<void>;
/**
 * Start a heartbeat interval that updates the lock file every `intervalMs`.
 * Returns a stop function. Stops automatically if the lock file disappears
 * (another instance stole it) or if the PID check shows we no longer own it.
 */
export declare function startHeartbeat(lockPath: string, intervalMs?: number): () => void;
