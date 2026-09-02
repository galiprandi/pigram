export declare function escapeTelegramHtml(text: string): string;
export declare function displayWidth(text: string): number;
export declare function markdownToTelegramHtml(markdown: string): string;
/**
 * Split HTML into <=maxLength chunks while preserving tag balance.
 * Open tags are closed at chunk boundaries and reopened in the next chunk.
 */
export declare function chunkTelegramHtml(html: string, maxLength?: number): string[];
/**
 * Split plain text into <=maxLength chunks at paragraph boundaries (`\\n\\n`).
 * Falls back to splitting on single newlines, then character boundaries.
 * Used for assistant replies sent as plain text (richText disabled).
 */
export declare function chunkPlainText(text: string, maxLength?: number): string[];
