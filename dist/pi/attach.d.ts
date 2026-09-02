export interface Attachment {
    path: string;
    fileName: string;
}
export declare const MAX_ATTACHMENTS_PER_TURN = 10;
export declare class AttachmentQueue {
    private queue;
    add(path: string): Attachment;
    addMany(paths: string[]): Attachment[];
    drain(): Attachment[];
    get size(): number;
    clear(): void;
}
export interface AttachmentSender {
    sendDocument(opts: {
        chatId: number;
        filePath: string;
        fileName: string;
        caption?: string;
    }): Promise<{
        message_id: number;
    }>;
}
export declare function flushAttachments(queue: AttachmentQueue, sender: AttachmentSender, chatId: number): Promise<number>;
export declare function buildAttachToolParams(): import("@sinclair/typebox").TObject<{
    paths: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>;
export declare function executeAttach(params: {
    paths: string[];
}, queue: AttachmentQueue, statFile?: (p: string) => Promise<{
    isFile: () => boolean;
}>): Promise<{
    added: string[];
}>;
