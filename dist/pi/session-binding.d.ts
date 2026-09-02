import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentSessionPort } from "./session.js";
/**
 * Returns the latest pi event context, if any. Pi hands a context to every
 * event handler; the bridge stores the most recent so session operations act
 * on the live session.
 *
 * NOTE: this is the plain ExtensionContext (event context), NOT the
 * ExtensionCommandContext. Session-replacement methods (newSession, fork,
 * waitForIdle) exist only on the command context and are intentionally NOT
 * used here — those are handled in the composition root with a context
 * captured from an actual command handler.
 */
export type CommandContextGetter = () => ExtensionContext | undefined;
/**
 * Build an AgentSessionPort backed by the real pi ExtensionAPI.
 *
 * @param pi - the pi extension API handed to the extension entrypoint
 * @param getCtx - returns the latest ExtensionCommandContext, if any
 */
export declare function bindPiSession(pi: ExtensionAPI, getCtx: CommandContextGetter): AgentSessionPort;
