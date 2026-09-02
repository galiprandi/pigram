/**
 * Pure formatters for the Telegram /status reply (no I/O).
 *
 * The composition root aggregates live data from pi (model, context usage,
 * cumulative token usage) and the pigram config layer (scope, config path,
 * queued count), then hands a plain view object to formatSessionStatus. Keeping
 * this module pure mirrors formatHelpReply and keeps the status layout unit-
 * testable without touching pi or Telegram.
 */
/**
 * Format a token count into a compact human-readable string (e.g. 14M, 25k).
 * Mirrors the upstream pi-telegram heuristic so numbers line up with pi's own
 * footer.
 */
export declare function formatTokens(count: number): string;
/** Context usage for the active model, as reported by pi's getContextUsage(). */
export interface ContextUsage {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
}
/** Cumulative token usage across the session (summed assistant entries). */
export interface TokenUsage {
    input: number;
    output: number;
}
/**
 * Plain, fully-resolved view of the data shown by /status. The composition root
 * builds this from pi (provider, model, thinking, sessionName, context, usage,
 * busy, rootDirectory) and the config layer (queued, mode, configPath); this
 * module only lays it out.
 */
export interface SessionStatusView {
    provider?: string;
    model?: string;
    thinking: string;
    sessionName?: string;
    context?: ContextUsage;
    usage?: TokenUsage;
    busy: boolean;
    queued: number;
    rootDirectory?: string;
    mode: "project" | "global";
    configPath: string;
    lockHolderPid?: number;
    lockHolderSince?: string | undefined;
}
/**
 * Render the /status reply as Telegram HTML.
 */
export declare function formatSessionStatus(view: SessionStatusView): string;
/** Data shown in the pi footer/status bar while the bridge is connected. */
export interface FooterStatusView {
    botUsername?: string;
    mode: "project" | "global";
    configPath: string;
}
/**
 * Format the one-line pi footer status set via ctx.ui.setStatus. Plain text
 * (the footer is not HTML): bot handle, active scope, and config location, so
 * the user can see at a glance that Telegram is connected and which config is
 * loaded.
 */
export declare function formatFooterStatus(view: FooterStatusView): string;
