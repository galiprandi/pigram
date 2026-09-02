/**
 * Declarative Telegram command registry and parser (pure, no I/O).
 *
 * Commands are parsed into typed intent objects. Executing intents happens
 * elsewhere (in adapters).
 */
/**
 * Specification for a single Telegram command.
 * Single source of truth for both dispatch and BotFather setup.
 */
export interface CommandSpec {
    /** Command name without leading slash */
    name: string;
    /** Description for BotFather /setcommands (verbose) */
    botFatherDescription: string;
    /** Full usage line with slash and syntax, for help reply (HTML-escaped) */
    helpUsage: string;
}
/**
 * Declarative command table.
 * This is the single source of truth for all command metadata.
 */
export declare const COMMAND_SPECS: CommandSpec[];
/**
 * Git subcommand parsing result.
 */
export type GitCommand = {
    ok: true;
    kind: "status";
} | {
    ok: true;
    kind: "log";
} | {
    ok: true;
    kind: "nb";
    branchName?: string;
} | {
    ok: false;
    message: string;
};
/**
 * Discriminated union of all parsed command intents.
 */
export type ParsedCommand = {
    kind: "new";
    name?: string;
} | {
    kind: "status";
} | {
    kind: "model";
    model: string;
    thinking?: string;
} | {
    kind: "thinking";
    level: string;
} | {
    kind: "compact";
} | {
    kind: "resend";
} | {
    kind: "stop";
} | {
    kind: "help";
} | {
    kind: "start";
} | {
    kind: "git";
    git: GitCommand;
} | {
    kind: "unknown";
};
/**
 * Message to show for unrecognized commands.
 */
export declare const UNKNOWN_COMMAND_MESSAGE = "invalid command, type /help if you need help";
/**
 * Parse a git subcommand from tokens.
 * @param tokens - Array starting with "/git" followed by subcommand and args
 * @returns Parsed git command or error
 */
export declare function parseGitCommand(tokens: string[]): GitCommand;
/**
 * Parse a command string into a typed intent.
 * @param text - The message text to parse
 * @returns Parsed command intent, or null if text is not a command
 */
export declare function parseCommand(text: string): ParsedCommand | null;
/**
 * Format commands for BotFather /setcommands.
 * @returns Newline-joined "name - description" lines (no slashes)
 */
export declare function formatBotFatherCommands(): string;
/**
 * Format the help reply message.
 * @param opts - Options controlling the output
 * @returns Formatted help text with optional BotFather block
 */
export declare function formatHelpReply(opts: {
    includeBotFatherCommands: boolean;
}): string;
