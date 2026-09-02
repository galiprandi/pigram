/**
 * Minimal Telegram user shape.
 */
export interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
}
/**
 * Minimal Telegram chat shape.
 */
export interface TelegramChat {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
}
/**
 * Telegram photo size.
 */
export interface TelegramPhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}
/**
 * Telegram document.
 */
export interface TelegramDocument {
    file_id: string;
    file_unique_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}
/**
 * Telegram voice message.
 */
export interface TelegramVoice {
    file_id: string;
    file_unique_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
}
/**
 * Telegram message.
 */
export interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    date: number;
    chat: TelegramChat;
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    document?: TelegramDocument;
    voice?: TelegramVoice;
}
/**
 * Telegram callback query (from inline keyboard button).
 */
export interface TelegramCallbackQuery {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
}
/**
 * Telegram update.
 */
export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
}
/**
 * The seam to the Telegram Bot API.
 * Knows how to fetch updates, send and edit messages, upload files, and download inbound files.
 */
export interface TelegramTransport {
    /**
     * Get bot identity.
     */
    getMe(): Promise<{
        id: number;
        username?: string;
        is_bot: boolean;
        first_name: string;
    }>;
    /**
     * Fetch updates with long polling.
     */
    getUpdates(opts: {
        offset?: number;
        timeout?: number;
    }, signal?: AbortSignal): Promise<TelegramUpdate[]>;
    /**
     * Send a text message.
     */
    sendMessage(opts: {
        chatId: number;
        text: string;
        parseMode?: "HTML";
        replyMarkup?: unknown;
    }): Promise<{
        message_id: number;
    }>;
    /**
     * Edit an existing message.
     */
    editMessageText(opts: {
        chatId: number;
        messageId: number;
        text: string;
        parseMode?: "HTML";
        replyMarkup?: unknown;
    }): Promise<void>;
    /**
     * Send a Bot API 10.1 rich message from raw markdown.
     * Telegram renders GFM pipe tables as native bordered tables.
     * Throws on any API error; callers classify via isPermanentRichError.
     */
    sendRichMessage(opts: {
        chatId: number;
        markdown: string;
    }): Promise<{
        message_id: number;
    }>;
    /**
     * Edit an existing message into a Bot API 10.1 rich message.
     */
    editMessageRich(opts: {
        chatId: number;
        messageId: number;
        markdown: string;
    }): Promise<void>;
    /**
     * Send a chat action (typing indicator, upload indicator, etc).
     */
    sendChatAction(opts: {
        chatId: number;
        action: "typing" | "upload_document" | "upload_photo";
    }): Promise<void>;
    /**
     * Answer a callback query from an inline keyboard button.
     */
    answerCallbackQuery(opts: {
        callbackQueryId: string;
        text?: string;
    }): Promise<void>;
    /**
     * Upload and send a document.
     */
    sendDocument(opts: {
        chatId: number;
        filePath: string;
        fileName: string;
        caption?: string;
    }): Promise<{
        message_id: number;
    }>;
    /**
     * Upload and send a photo.
     */
    sendPhoto(opts: {
        chatId: number;
        filePath: string;
        fileName: string;
        caption?: string;
    }): Promise<{
        message_id: number;
    }>;
    /**
     * Download a file from Telegram.
     * Returns the destination path.
     */
    downloadFile(opts: {
        fileId: string;
        destPath: string;
    }): Promise<string>;
}
/**
 * Create an HTTP-based Telegram transport.
 * fetchImpl is injectable for testing.
 */
export declare function createHttpTransport(opts: {
    botToken: string;
    fetchImpl?: typeof fetch;
}): TelegramTransport;
