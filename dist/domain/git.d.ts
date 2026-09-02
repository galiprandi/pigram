/**
 * Pure logic for the /git command: map a parsed git subcommand into a sequence
 * of git argv steps, run them through an injected runner, and format the reply.
 *
 * No I/O lives here. The actual `execFile("git", ...)` runner is supplied by the
 * composition root, which keeps this module fully unit-testable with a fake
 * runner and free of any node:child_process import.
 *
 * Adapted from the design in jetmiky/pi-telegram (getTelegramGitExecSpec /
 * runGit / formatTelegramGitReply): an exec-spec carries an ordered list of
 * steps so `nb` can validate the branch name with `git check-ref-format`
 * BEFORE creating it, stopping at the first failing step.
 */
import type { GitCommand } from "./commands.js";
/** A safe git invocation: argv only, never a shell string (injection-proof). */
export interface GitExecStep {
    /** Arguments passed to `git` (e.g. ["status", "--short", "--branch"]). */
    args: string[];
    /** Title used when THIS step fails; falls back to "<spec.title> failed". */
    failureTitle?: string;
}
/** An ordered plan of git steps to run for one /git subcommand. */
export interface GitExecSpec {
    /** Human-readable title shown above the command output. */
    title: string;
    /** Steps run in order; execution stops at the first non-zero exit. */
    steps: GitExecStep[];
}
/** The result of running a single git step. */
export interface GitRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
/** Runs `git <args>` in `cwd`. Injected so the orchestration stays pure. */
export type GitRunner = (args: string[], cwd: string) => Promise<GitRunResult>;
/**
 * Map a successfully-parsed git subcommand to its exec-spec.
 *
 *  - status → git status --short --branch
 *  - log    → git log --oneline --decorate -20
 *  - nb      → git check-ref-format --branch <name> (validate), then git switch -c <name>
 */
export declare function getGitExecSpec(command: Extract<GitCommand, {
    ok: true;
}>): GitExecSpec;
/**
 * Format a git step result into a Telegram reply: a title line, a blank line,
 * then stdout (or stderr, or "(no output)"). Truncated to Telegram's limit.
 */
export declare function formatGitReply(input: {
    title: string;
    stdout: string;
    stderr: string;
}): string;
/**
 * Run an exec-spec through the injected runner and produce the reply text.
 * Steps run in order; the first non-zero exit stops the run and reports that
 * step's failure (using its failureTitle when set). On success the last step's
 * output is reported under the spec title.
 */
export declare function runGitSpec(spec: GitExecSpec, runner: GitRunner, cwd: string): Promise<string>;
