import type { PigramConfig } from "./schema.js";
export type Scope = "project" | "global";
export interface PigramState {
    lastUpdateId: number;
    pairedUserId?: number;
    botId?: number;
    botUsername?: string;
}
export interface ResolvedPaths {
    scope: Scope;
    configPath: string;
    statePath: string;
    tempDir: string;
}
export declare function resolveScope(opts: {
    cwd: string;
    homeDir: string;
    scope?: Scope;
}): Promise<ResolvedPaths>;
export declare function readConfig(paths: ResolvedPaths): Promise<PigramConfig | null>;
export declare function writeConfig(paths: ResolvedPaths, config: PigramConfig): Promise<void>;
export declare function readState(paths: ResolvedPaths): Promise<PigramState>;
export declare function writeState(paths: ResolvedPaths, state: PigramState): Promise<void>;
export declare function ensureProjectGitignore(cwd: string): Promise<void>;
