/**
 * /new session-reset handshake.
 *
 * Resetting the pi session from Telegram is not a synchronous call we can make
 * and await: pi's `newSession()` tears down the current extension runtime and
 * builds a fresh one for the replacement session. Any context, poller, or
 * transport we hold belongs to the OLD runtime and is invalid afterwards — pi
 * explicitly forbids using a captured ctx past `newSession()`.
 *
 * So we hand the work across the session boundary as DATA instead of a live
 * closure. When `/new` runs, we persist a reconnect-request entry into the
 * brand-new session (via the `setup` callback, which receives the new
 * session's SessionManager). The replacement session then boots and fires
 * `session_start`; our handler there finds the pending request, restarts
 * polling in the NEW runtime, and sends the Telegram confirmation. A matching
 * "consumed" entry is appended so a resumed/forked session never re-fires the
 * same reconnect.
 *
 * This mirrors the upstream pi-telegram approach and sidesteps the race that
 * killed the naive "reconnect inside withSession" design (two pollers racing
 * for Telegram's single getUpdates slot → 409 → silent bridge).
 */
export declare const RECONNECT_REQUEST_ENTRY_TYPE = "pigram-reconnect-request";
export declare const RECONNECT_CONSUMED_ENTRY_TYPE = "pigram-reconnect-consumed";
/** Persisted in the replacement session; drives reconnect on session_start. */
export interface ReconnectRequest {
    /** Unique id so a consumed request is never re-fired (resume/fork safety). */
    requestId: string;
    /** Chat to send the "new session started" confirmation to. */
    chatId: number;
    /** Optional session name the user passed as `/new <name>`. */
    sessionName?: string;
    /** Whether sessionName was truncated to the max length. */
    truncated?: boolean;
}
/** Marker entry recording that a given reconnect request was already handled. */
export interface ReconnectConsumed {
    requestId: string;
}
/** Minimal shape of a session entry we inspect (pi's SessionEntry, narrowed). */
export interface InspectableEntry {
    type?: string;
    customType?: string;
    data?: unknown;
}
/**
 * Find the newest reconnect request that has not yet been consumed.
 *
 * Resumed and forked sessions replay historical entries, so a request alone is
 * not enough — we must skip any whose id appears in a consumed marker. Scans
 * newest-first so the most recent /new wins if several are somehow pending.
 */
export declare function findPendingReconnectRequest(entries: readonly InspectableEntry[]): ReconnectRequest | undefined;
/** Format the Telegram confirmation shown after a successful /new. */
export declare function formatNewSessionConfirmation(request: Pick<ReconnectRequest, "sessionName" | "truncated">): string;
