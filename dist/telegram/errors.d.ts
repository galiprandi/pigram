/**
 * Telegram-specific error types the poller reacts to.
 *
 * The transport throws plain `Error` for most failures, but two cases need
 * structured data so the poller can choose the right backoff:
 *
 *   - 429 Too Many Requests: Telegram returns `retry_after` (seconds). The
 *     poller must wait at least that long before retrying, or it will be
 *     rate-limited again immediately.
 *   - 409 Conflict: another getUpdates consumer holds the slot. The poller
 *     backs off longer to let it wind down.
 *
 * Detection stays message-based for 409 (Telegram's wording is stable and
 * already covered by tests), but 429 carries the parsed retry_after so the
 * poller does not have to scrape the message.
 */
export declare class TelegramRateLimitError extends Error {
    /** Seconds Telegram asked us to wait before retrying. */
    readonly retryAfterSeconds: number;
    constructor(retryAfterSeconds: number, message?: string);
}
/**
 * Check if an error is a Telegram 429 carrying a retry_after value.
 * Returns the parsed seconds, or undefined if not a rate-limit error.
 */
export declare function getRetryAfterSeconds(err: unknown): number | undefined;
