/**
 * AgentSession adapter — the seam to the pi coding agent.
 *
 * This module defines a narrow port interface (AgentSessionPort) that pigram
 * depends on, and a structural driver interface (PiSessionDriver) that the
 * real pi ExtensionAPI/AgentSession satisfies. The adapter bridges the two
 * without requiring pigram to import pi at runtime.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
/** Context usage for the active model, mirroring pi's getContextUsage(). */
export interface ContextUsage {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
}
/** Cumulative token usage across a session (summed assistant entries). */
export interface TokenUsage {
    input: number;
    output: number;
}
export interface SessionStatus {
    modelId?: string;
    provider?: string;
    thinkingLevel: ThinkingLevel;
    busy: boolean;
    /** User-defined session name, if any. */
    sessionName?: string;
    /** Working directory of the active session. */
    cwd?: string;
    /** Live context-window usage for the active model. */
    contextUsage?: ContextUsage;
    /** Cumulative token usage across the whole session. */
    usage?: TokenUsage;
}
/**
 * Sum input/output token usage across all assistant message entries in a
 * session. Mirrors how pi's own footer accumulates usage: it walks the session
 * entries and totals each assistant message's usage. Non-assistant entries and
 * missing usage fields are skipped, so partial or legacy sessions still total
 * cleanly.
 *
 * Typed against a structural shape rather than pi's SessionEntry so it stays
 * unit-testable without importing pi.
 */
export declare function sumAssistantUsage(entries: ReadonlyArray<{
    type: string;
    message?: {
        role?: string;
        usage?: {
            input?: number;
            output?: number;
        };
    };
}>): TokenUsage;
export interface AgentSessionPort {
    getStatus(): SessionStatus;
    setModel(modelId: string): Promise<void>;
    setThinkingLevel(level: ThinkingLevel): void;
    compact(): Promise<void>;
    abort(): Promise<void>;
    sendPrompt(text: string, imagePaths?: string[]): Promise<void>;
}
/**
 * Narrow structural type capturing only what we call on pi.
 * The real pi ExtensionAPI and AgentSession satisfy this interface
 * structurally, allowing tests to use fakes without importing pi.
 */
export interface PiSessionDriver {
    getThinkingLevel(): ThinkingLevel;
    setThinkingLevel(level: ThinkingLevel): void;
    readonly session: {
        readonly model?: {
            id: string;
            provider?: string;
        };
        readonly isProcessing?: boolean;
        setModel(modelId: string): Promise<void>;
        compact(): Promise<unknown>;
        abort(): Promise<void>;
        prompt(text: string, options?: {
            images?: string[];
        }): Promise<void>;
    };
}
/**
 * Create an AgentSessionPort from a PiSessionDriver.
 * This adapter maps our port interface onto the driver, isolating pigram
 * from direct dependencies on pi's runtime types.
 */
export declare function createAgentSession(driver: PiSessionDriver): AgentSessionPort;
