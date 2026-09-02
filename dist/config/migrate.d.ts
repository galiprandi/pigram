import type { Scope } from "./store.js";
export type MigrationResult = {
    status: "migrated";
    configPath: string;
    statePath: string;
} | {
    status: "skipped-existing";
} | {
    status: "no-legacy";
} | {
    status: "error";
    message: string;
};
export declare function legacyPaths(opts: {
    cwd: string;
    homeDir: string;
    scope: Scope;
}): {
    legacyConfigPath: string;
};
export declare function migrateLegacyConfig(opts: {
    cwd: string;
    homeDir: string;
    scope: "project" | "global";
}): Promise<MigrationResult>;
