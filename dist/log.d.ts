/**
 * Structured logger for pigram internals.
 *
 * Writes to stderr (never stdout — pi owns stdout). Each line is a single
 * JSON object so it is greppable and parseable. Levels mirror syslog:
 *   debug < info < warn < error
 *
 * Level is controlled by the PIGRAM_LOG env var (case-insensitive):
 *   "debug" | "info" | "warn" | "error" | "silent"  (default: warn)
 *
 * The logger is process-global and side-effect free to import. Tests can
 * swap the sink via `setLogSink` to capture output.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
/** Sink receives the formatted JSON line. Default: stderr. */
export type LogSink = (line: string) => void;
/** Override the sink (used by tests). Pass undefined to restore stderr. */
export declare function setLogSink(next: LogSink | undefined): void;
/** Override the level at runtime (tests). */
export declare function setLogLevel(level: LogLevel): void;
export declare function getLogLevel(): LogLevel;
interface LogFields {
    [key: string]: unknown;
}
export declare const log: {
    debug: (msg: string, fields?: LogFields) => void;
    info: (msg: string, fields?: LogFields) => void;
    warn: (msg: string, fields?: LogFields) => void;
    error: (msg: string, fields?: LogFields) => void;
};
export {};
