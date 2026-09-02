/**
 * Domain module for mapping inbound Telegram messages into Prompts
 * and managing a follow-up queue for messages that arrive while pi is busy.
 *
 * Pure module: no I/O, no fs, no network. File downloading happens elsewhere;
 * here we only map already-downloaded local paths into prompt structure.
 */
/** An inbound message from Telegram before mapping to a Prompt. */
export interface InboundMessage {
    text?: string;
    imagePaths?: string[];
    documentPaths?: string[];
}
/** A Prompt ready to send to the pi coding agent. */
export interface MappedPrompt {
    text: string;
    imagePaths: string[];
    documentPaths: string[];
}
/**
 * Map an inbound Telegram message into a Prompt.
 *
 * - Prefixes text with "[telegram] " marker so pi knows the origin
 * - When no text but files present, generates "[telegram] (sent N file(s))"
 * - Defaults imagePaths/documentPaths to empty arrays when absent
 */
export declare function mapInboundMessage(msg: InboundMessage): MappedPrompt;
/**
 * FIFO queue for follow-up messages that arrive while pi is busy processing.
 * Preserves insertion order.
 */
export declare class FollowUpQueue {
    private queue;
    /**
     * Add a message to the end of the queue.
     */
    enqueue(msg: InboundMessage): void;
    /**
     * Remove and return the message at the front of the queue.
     * Returns undefined if the queue is empty.
     */
    dequeue(): InboundMessage | undefined;
    /**
     * The number of messages currently in the queue.
     */
    get size(): number;
    /**
     * Remove all messages from the queue.
     */
    clear(): void;
}
