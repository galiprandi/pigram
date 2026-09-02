import { type Static } from "@sinclair/typebox";
export declare const UxPreferencesSchema: import("@sinclair/typebox").TObject<{
    richText: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    streamPreviews: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    richTables: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
}>;
export type UxPreferences = Static<typeof UxPreferencesSchema>;
export declare const DEFAULT_UX: UxPreferences;
export declare const PigramConfigSchema: import("@sinclair/typebox").TObject<{
    botToken: import("@sinclair/typebox").TString;
    ux: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        richText: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        streamPreviews: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        richTables: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    }>>;
}>;
export type PigramConfig = Static<typeof PigramConfigSchema>;
type ValidationResult = {
    ok: true;
    config: PigramConfig;
} | {
    ok: false;
    errors: string[];
};
export declare function validateConfig(input: unknown): ValidationResult;
export {};
