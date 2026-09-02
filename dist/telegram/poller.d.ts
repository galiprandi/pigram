import type { TelegramTransport, TelegramUpdate } from "./transport.js";
/**
 * Handler for a single Telegram update.
 */
export type UpdateHandler = (update: TelegramUpdate) => Promise<void>;
/**
 * Dependencies for TelegramPoller.
 */
export interface PollerDeps {
    /**
     * Transport to fetch updates from.
     */
    transport: Pick<TelegramTransport, "getUpdates">;
    /**
     * Handler to process each update.
     */
    handler: UpdateHandler;
    /**
     * Get the current update cursor (last processed update_id).
     */
    getCursor: () => number;
    /**
     * Persist the new update cursor after processing an update.
     */
    setCursor: (updateId: number) => Promise<void>;
    /**
     * Timeout in seconds for long polling (passed to getUpdates).
     * Defaults to 30.
     */
    pollTimeoutSeconds?: number;
    /**
     * Optional error handler for non-abort errors.
     * The loop continues after calling this.
     */
    onError?: (err: unknown) => void;
    /**
     * Delay in milliseconds after a non-abort error before retrying.
     * Defaults to 0 (useful for fast tests).
     *
     * When > 0, repeated consecutive errors use exponential backoff:
     * errorDelayMs, 2×, 4×, ... up to maxErrorBackoffMs. The counter resets
     * on the first successful getUpdates. A 429 with retry_after overrides
     * the computed delay with max(computed, retry_after*1000).
     */
    errorDelayMs?: number;
    /**
     * Delay in milliseconds after a Telegram 409 "Conflict: terminated by other
     * getUpdates request" error. This conflict means another poller is (or was)
     * consuming updates for the same bot — typically a previous session's poll
     * that has not yet wound down (e.g. right after /new). A longer backoff than
     * a normal error gives the competing consumer time to terminate Telegram-side
     * instead of two pollers ping-ponging 409s at each other. Defaults to 3000.
     */
    conflictDelayMs?: number;
    /**
     * Cap in milliseconds for exponential backoff on repeated non-conflict
     * errors. Defaults to 30000. Only applies when errorDelayMs > 0.
     */
    maxErrorBackoffMs?: number;
}
/**
 * Long-polling update fetcher for Telegram.
 * Pulls updates from the transport and routes them to a handler.
 */
export declare class TelegramPoller {
    private readonly transport;
    private readonly handler;
    private readonly getCursor;
    private readonly setCursor;
    private readonly pollTimeoutSeconds;
    private readonly onError;
    private readonly errorDelayMs;
    private readonly conflictDelayMs;
    private readonly maxErrorBackoffMs;
    /**
     * Consecutive non-conflict error count for exponential backoff.
     * Reset to 0 on the first successful getUpdates response.
     */
    private consecutiveErrors;
    constructor(deps: PollerDeps);
    /**
     * Start the long-polling loop.
     * Runs until the signal is aborted.
     */
    start(signal: AbortSignal): Promise<void>;
    /**
     * Check if an error is Telegram's 409 getUpdates conflict.
     * Telegram phrases it "Conflict: terminated by other getUpdates request";
     * we match the stable "Conflict" + "getUpdates" signal case-insensitively.
     */
    private isConflictError;
    /**
     * Sleep for the specified number of milliseconds.
     * Resolves immediately if the signal aborts mid-sleep, so /pigram-disconnect
     * does not block waiting for a long backoff to finish.
     */
    private sleep;
}
