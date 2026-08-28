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

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: 100,
};

function resolveLevel(): LogLevel {
	const raw = (process.env.PIGRAM_LOG ?? "warn").toLowerCase();
	if (raw in LEVEL_ORDER) return raw as LogLevel;
	return "warn";
}

let currentLevel: LogLevel = resolveLevel();

/** Sink receives the formatted JSON line. Default: stderr. */
export type LogSink = (line: string) => void;
let sink: LogSink = (line: string) => process.stderr.write(line);

/** Override the sink (used by tests). Pass undefined to restore stderr. */
export function setLogSink(next: LogSink | undefined): void {
	sink = next ?? ((line: string) => process.stderr.write(line));
}

/** Override the level at runtime (tests). */
export function setLogLevel(level: LogLevel): void {
	currentLevel = level;
}

export function getLogLevel(): LogLevel {
	return currentLevel;
}

interface LogFields {
	[key: string]: unknown;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		level,
		msg,
		...fields,
	});
	try {
		sink(`${line}\n`);
	} catch {
		// Sink failures must never take the bridge down.
	}
}

export const log = {
	debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
	info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
	warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
	error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
