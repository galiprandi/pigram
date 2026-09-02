/**
 * The Telegram operations a preview needs. parseMode is omitted for plain text.
 * The rich* methods are optional so existing fakes/tests keep working without
 * them — when absent, finalize simply never attempts the rich path.
 */
export interface PreviewTransport {
    sendMessage(opts: {
        chatId: number;
        text: string;
        parseMode?: "HTML";
    }): Promise<{
        message_id: number;
    }>;
    editMessageText(opts: {
        chatId: number;
        messageId: number;
        text: string;
        parseMode?: "HTML";
    }): Promise<void>;
    sendRichMessage?(opts: {
        chatId: number;
        markdown: string;
    }): Promise<{
        message_id: number;
    }>;
    editMessageRich?(opts: {
        chatId: number;
        messageId: number;
        markdown: string;
    }): Promise<void>;
}
/**
 * A one-shot trailing timer. set() replaces any pending callback; clear()
 * cancels it. Injectable so tests can fire it deterministically.
 */
export interface PreviewTimer {
    set(fn: () => void, ms: number): void;
    clear(): void;
}
export interface PreviewSessionDeps {
    transport: PreviewTransport;
    /** Minimum gap between preview edits. Default 750ms. */
    throttleMs?: number;
    /** Clock, injectable for tests. Default Date.now. */
    now?: () => number;
    /** Trailing timer, injectable for tests. Default setTimeout-backed. */
    timer?: PreviewTimer;
    /**
     * Attempt Bot API 10.1 rich delivery for replies containing GFM tables
     * (native bordered tables). Default true; failures fall back to HTML.
     */
    richTables?: boolean | undefined;
}
export declare class PreviewSession {
    private readonly chatId;
    private readonly transport;
    private readonly throttleMs;
    private readonly now;
    private readonly timer;
    private readonly richTables;
    private messageId;
    private pending;
    private lastSent;
    private lastFlushAt;
    private finalized;
    private richDisabled;
    constructor(chatId: number, deps: PreviewSessionDeps);
    /**
     * Feed the latest partial assistant text (raw Markdown). Streams it as PLAIN
     * text, coalescing rapid calls: the first update in a window flushes
     * immediately, later ones schedule a single trailing flush.
     */
    update(rawPartial: string): Promise<void>;
    private flush;
    /**
     * Replace the streamed preview with the final, richly formatted reply.
     *
     * When the reply contains a GFM table and the transport supports Bot API
     * 10.1 rich messages, the whole reply is first attempted as ONE rich send:
     * Telegram renders the table natively (bordered, horizontally scrollable).
     * A permanent rich failure latches rich off for the session and falls back
     * to the classic HTML path below. Transient failures also fall back here —
     * without a legacy resend, since the message may have reached Telegram.
     *
     * Without tables (or with rich unavailable) the markdown is converted to
     * Telegram HTML and chunked. When a preview message exists, the first
     * chunk edits it in place (no duplicate bubble); any overflow chunks are
     * sent as new messages. With no preview message (no tokens streamed) all
     * chunks are sent fresh. Falls back to plain text if Telegram rejects
     * the HTML.
     */
    finalize(markdown: string): Promise<void>;
    /**
     * One-shot attempt to deliver the reply as a single Bot API 10.1 rich
     * message. Returns true when delivered; false when the caller must fall
     * back to the HTML path. A permanent error latches rich off for the rest
     * of the session so later table replies skip the failed attempt entirely.
     */
    private tryRichFinalize;
    private editRich;
    private sendRich;
}
