import type { TelegramCallbackQuery, TelegramTransport } from "./transport.js";
/**
 * Dependencies for DialogManager.
 */
export interface DialogDeps {
    transport: Pick<TelegramTransport, "sendMessage" | "editMessageText" | "answerCallbackQuery">;
    chatId: number;
    idGen?: () => string;
    timeoutMs?: number;
}
/**
 * A select option.
 */
export interface SelectOption {
    label: string;
    value: string;
}
/**
 * Manages native Telegram dialogs using inline keyboards.
 * Correlates callback_query events back to awaiting promises.
 */
export declare class DialogManager {
    private readonly transport;
    private readonly chatId;
    private readonly idGen;
    private readonly timeoutMs?;
    private pendingSelects;
    private pendingTextInput?;
    private idCounter;
    constructor(deps: DialogDeps);
    /**
     * Show a select dialog with multiple options.
     * Returns the value of the chosen option.
     */
    select(prompt: string, options: SelectOption[]): Promise<string>;
    /**
     * Show a confirm dialog (Yes/No).
     * Returns true for Yes, false for No.
     */
    confirm(prompt: string): Promise<boolean>;
    /**
     * Show a text input prompt.
     * Returns the text provided by the user via handleText.
     */
    textInput(prompt: string): Promise<string>;
    /**
     * Handle a callback query from an inline keyboard button.
     * Returns true if this query matched a pending dialog, false otherwise.
     */
    handleCallbackQuery(query: TelegramCallbackQuery): Promise<boolean>;
    /**
     * Handle inbound text for text input dialogs.
     * Returns true if text was consumed by a pending textInput, false otherwise.
     */
    handleText(text: string): boolean;
}
