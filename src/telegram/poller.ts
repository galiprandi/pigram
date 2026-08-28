import type { TelegramTransport, TelegramUpdate } from "./transport.js";
import { getRetryAfterSeconds } from "./errors.js";
import { log } from "../log.js";

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
export class TelegramPoller {
	private readonly transport: Pick<TelegramTransport, "getUpdates">;
	private readonly handler: UpdateHandler;
	private readonly getCursor: () => number;
	private readonly setCursor: (updateId: number) => Promise<void>;
	private readonly pollTimeoutSeconds: number;
	private readonly onError: ((err: unknown) => void) | undefined;
	private readonly errorDelayMs: number;
	private readonly conflictDelayMs: number;
	private readonly maxErrorBackoffMs: number;
	/**
	 * Consecutive non-conflict error count for exponential backoff.
	 * Reset to 0 on the first successful getUpdates response.
	 */
	private consecutiveErrors = 0;

	constructor(deps: PollerDeps) {
		this.transport = deps.transport;
		this.handler = deps.handler;
		this.getCursor = deps.getCursor;
		this.setCursor = deps.setCursor;
		this.pollTimeoutSeconds = deps.pollTimeoutSeconds ?? 30;
		this.onError = deps.onError;
		this.errorDelayMs = deps.errorDelayMs ?? 0;
		this.conflictDelayMs = deps.conflictDelayMs ?? 3000;
		this.maxErrorBackoffMs = deps.maxErrorBackoffMs ?? 30_000;
	}

	/**
	 * Start the long-polling loop.
	 * Runs until the signal is aborted.
	 */
	async start(signal: AbortSignal): Promise<void> {
		log.info("poller.start", { pollTimeout: this.pollTimeoutSeconds });
		while (!signal.aborted) {
			try {
				const offset = this.getCursor() + 1;
				const updates = await this.transport.getUpdates(
					{
						offset,
						timeout: this.pollTimeoutSeconds,
					},
					signal,
				);

				// Success — reset the backoff counter.
				if (this.consecutiveErrors > 0) {
					log.info("poller.recovered", { after: this.consecutiveErrors });
				}
				this.consecutiveErrors = 0;

				// Process each update in order
				for (const update of updates) {
					// Check if aborted before processing
					if (signal.aborted) {
						return;
					}

					// Persist the cursor BEFORE dispatching the handler, not
					// after. A handler may tear down this very poller mid-flight
					// — most notably /new, which calls newSession() and rebuilds
					// the extension runtime while we are still awaiting the
					// handler. If we advanced the cursor only afterwards, that
					// teardown would skip the persist, the replacement session
					// would restore the stale cursor, and Telegram would
					// re-deliver the same update (a phantom second /new). Saving
					// first gives at-most-once delivery, which is the correct
					// trade-off for commands that must never double-fire.
					await this.setCursor(update.update_id);
					await this.handler(update);
				}
			} catch (err) {
				// Exit only when OUR signal is set. Never classify by message
				// content: undici/socket failures on a long-poll can mention
				// "aborted" without our signal being the cause, and treating
				// those as aborts killed the loop silently (bridge goes quiet
				// while the lock heartbeat keeps beating).
				if (signal.aborted) {
					return;
				}

				// Report via onError, but never let reporting itself take the
				// loop down (e.g. ctx.ui.setStatus throwing on a stale context).
				if (this.onError) {
					try {
						this.onError(err);
					} catch {
						// Swallow: the loop must survive its own error reporter.
					}
				}

				const isConflict = this.isConflictError(err);
				const retryAfter = getRetryAfterSeconds(err);
				this.consecutiveErrors += 1;

				// Compute the delay for this attempt.
				let delay: number;
				if (isConflict) {
					// A 409 conflict means another poller holds this bot's
					// getUpdates (e.g. a previous session winding down after
					// /new). Back off longer so it can terminate.
					delay = this.conflictDelayMs;
				} else {
					// Exponential backoff: base * 2^(errors-1), capped.
					delay = this.errorDelayMs * 2 ** (this.consecutiveErrors - 1);
					if (delay > this.maxErrorBackoffMs) delay = this.maxErrorBackoffMs;
				}

				// A 429 rate-limit carries an authoritative retry_after.
				// Always honor it: Telegram will reject anything sooner.
				if (retryAfter !== undefined) {
					const retryMs = retryAfter * 1000;
					if (retryMs > delay) delay = retryMs;
				}

				log.warn("poller.error", {
					error: err instanceof Error ? err.message : String(err),
					isConflict,
					retryAfter,
					consecutive: this.consecutiveErrors,
					delayMs: delay,
				});

				if (delay > 0) {
					await this.sleep(delay, signal);
				}
			}
		}
		log.debug("poller.exit");
	}

	/**
	 * Check if an error is Telegram's 409 getUpdates conflict.
	 * Telegram phrases it "Conflict: terminated by other getUpdates request";
	 * we match the stable "Conflict" + "getUpdates" signal case-insensitively.
	 */
	private isConflictError(err: unknown): boolean {
		if (!(err instanceof Error)) return false;
		const msg = err.message.toLowerCase();
		return msg.includes("conflict") && msg.includes("getupdates");
	}

	/**
	 * Sleep for the specified number of milliseconds.
	 * Resolves immediately if the signal aborts mid-sleep, so /pigram-disconnect
	 * does not block waiting for a long backoff to finish.
	 */
	private sleep(ms: number, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) return Promise.resolve();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				signal?.removeEventListener("abort", onAbort);
				resolve();
			}, ms);
			const onAbort = () => {
				clearTimeout(timer);
				resolve();
			};
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}
}
