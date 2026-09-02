/**
 * Pure resolution of a /model specifier to a concrete registry model (no I/O).
 *
 * The tricky case this exists for: a model id can ITSELF contain a slash (e.g.
 * "kr/claude-sonnet-4.5" served by provider "9router"). A naive "split on the
 * first slash to get the provider" guess mis-reads "kr" as the provider and the
 * lookup fails. So we never guess from slash position: we only treat the prefix
 * as a provider when it is a KNOWN provider in the registry. Otherwise the whole
 * specifier is the model id under the current provider.
 *
 * Adapted from resolveTelegramModelCommandTarget in jetmiky/pi-telegram.
 */
/** Minimal structural view of a registry model. */
export interface ModelLookupModel {
    provider: string;
    id: string;
}
/** Minimal structural view of pi's ModelRegistry needed for resolution. */
export interface ModelRegistryLookup<TModel extends ModelLookupModel> {
    /** All known models (built-in + custom). */
    getAll(): readonly TModel[];
    /** Exact lookup by provider + model id. */
    find(provider: string, modelId: string): TModel | undefined;
}
export type ResolveModelResult<TModel> = {
    ok: true;
    model: TModel;
} | {
    ok: false;
    message: string;
};
/**
 * Resolve a /model specifier against the registry.
 *
 *  - "claude-sonnet-4.5"            → find(currentProvider, "claude-sonnet-4.5")
 *  - "kr/claude-sonnet-4.5"         → "kr" is not a known provider, so the whole
 *                                     string is the model id under currentProvider
 *  - "9router/kr/claude-sonnet-4.5" → "9router" IS a known provider, so split once:
 *                                     find("9router", "kr/claude-sonnet-4.5")
 *
 * Provider matching is case-insensitive; the canonical casing from the registry
 * is used for the actual lookup.
 */
export declare function resolveModelTarget<TModel extends ModelLookupModel>(options: {
    registry: ModelRegistryLookup<TModel>;
    currentProvider: string;
    specifier: string;
}): ResolveModelResult<TModel>;
