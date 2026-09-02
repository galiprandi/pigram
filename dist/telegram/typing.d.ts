/**
 * Repeating "typing…" indicator for a Telegram chat.
 *
 * Sends `sendChatAction("typing")` immediately on start and then every
 * `intervalMs` milliseconds until `stop()` is called. The Telegram typing
 * indicator expires after ~5 s, so the default interval of 4 s keeps it alive
 * continuously.
 *
 * Timer primitives are injected so tests can drive ticks deterministically.
 */
import type { TelegramTransport } from "./transport.js";
export interface TypingDeps {
    sendChatAction: TelegramTransport["sendChatAction"];
    setInterval: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>;
    clearInterval: (id: ReturnType<typeof globalThis.setInterval>) => void;
}
export declare class TypingIndicator {
    private readonly chatId;
    private readonly deps;
    private readonly intervalMs;
    private timerId;
    private running;
    constructor(chatId: number, deps: TypingDeps, intervalMs?: number);
    /** Send typing immediately and begin the repeat interval. */
    start(): void;
    /** Stop repeating. Idempotent — safe to call multiple times. */
    stop(): void;
    private fire;
}
