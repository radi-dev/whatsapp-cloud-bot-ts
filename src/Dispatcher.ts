/**
 * Dispatcher Class
 * Routes incoming messages to appropriate handlers
 */

import type { WebhookPayload, WebhookValue, NextStepConfig } from './types';
import { Update } from './Update';
import { UserContext } from './UserContext';
import type { UpdateHandler } from './Handlers';
import { MessageHandler } from './Handlers';
import { keysExist } from './utils/helpers';

/**
 * Async Queue for processing updates
 */
class AsyncQueue<T> {
  private queue: T[] = [];
  private processing = false;

  async enqueue(item: T, processor: (item: T) => Promise<void>): Promise<void> {
    this.queue.push(item);
    if (!this.processing) {
      await this.processQueue(processor);
    }
  }

  private async processQueue(
    processor: (item: T) => Promise<void>
  ): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        await processor(item);
      }
    }
    this.processing = false;
  }

  get size(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }
}

/**
 * Dispatcher class - manages message routing and handler execution
 */
export class Dispatcher {
  private bot: any;
  private queue: AsyncQueue<WebhookPayload>;
  private registeredHandlers: UpdateHandler[] = [];
  private markAsRead: boolean;
  private nextStepHandlers: Map<string, NextStepConfig> = new Map();

  constructor(bot: any, markAsRead: boolean = true) {
    this.bot = bot;
    this.queue = new AsyncQueue<WebhookPayload>();
    this.markAsRead = markAsRead;
  }

  /**
   * Process incoming webhook update
   */
  async processUpdate(update: WebhookPayload): Promise<void> {
    await this.queue.enqueue(update, this.processQueueItem.bind(this));
  }

  /**
   * Process a single queue item
   */
  private async processQueueItem(
    webhookPayload: WebhookPayload
  ): Promise<void> {
    if (!keysExist(webhookPayload, 'entry', 0, 'changes', 0, 'value')) {
      return;
    }

    const value: WebhookValue = webhookPayload.entry[0].changes[0].value;

    if (!keysExist(value, 'metadata', 'phone_number_id')) {
      return;
    }

    if (String(value.metadata.phone_number_id) !== String(this.bot.id)) {
      return;
    }

    if (!keysExist(value, 'messages')) {
      return;
    }

    const message = value.messages![0];

    // Mark message as read if enabled
    if (this.markAsRead) {
      await this.bot.markAsRead(message).catch(() => {
        // Silently fail - marking as read is not critical
      });
    }

    const update = new Update(this.bot, value);

    // Get applicable handlers
    const handlers = this.getHandlersForUpdate(update);

    // Process handlers
    for (const handler of handlers) {
      const messageText = handler.extractData(message).messageText;

      const shouldRun = await this.checkAndRunHandler(
        handler,
        value,
        messageText
      );

      if (shouldRun) {
        // Remove next step handler if it was executed
        const nextStepConfig = this.nextStepHandlers.get(
          update.userPhoneNumber
        );
        if (
          nextStepConfig &&
          (nextStepConfig.handler === handler ||
            nextStepConfig.fallbackHandler === handler)
        ) {
          this.nextStepHandlers.delete(update.userPhoneNumber);
        }
        return; // Stop processing after first successful handler
      }
    }
  }

  /**
   * Get handlers for current update
   */
  private getHandlersForUpdate(update: Update): UpdateHandler[] {
    const persistentHandlers = this.registeredHandlers.filter(
      (h) => h.persistent
    );

    const nextStepConfig = this.nextStepHandlers.get(update.userPhoneNumber);

    if (nextStepConfig) {
      const handlers: UpdateHandler[] = [];
      if (nextStepConfig.fallbackHandler) {
        handlers.push(nextStepConfig.fallbackHandler);
      }
      handlers.push(nextStepConfig.handler);
      return [...persistentHandlers, ...handlers];
    }

    return [...persistentHandlers, ...this.registeredHandlers];
  }

  /**
   * Check if handler matches and run it
   */
  private async checkAndRunHandler(
    handler: UpdateHandler,
    value: WebhookValue,
    messageText: string
  ): Promise<boolean> {
    const message = value.messages?.[0];
    if (!message) return false;

    // Check if handler type matches message type
    if (handler.name !== message.type) {
      return false;
    }

    // Check filter
    if (!handler.filterCheck(messageText)) {
      return false;
    }

    // Create update with extracted data
    const update = new Update(this.bot, value);
    const extractedData = handler.extractData(message);

    update.messageText = extractedData.messageText;
    Object.assign(update, extractedData);

    // Run handler with or without context
    if (handler.context) {
      const context = new UserContext(update.userPhoneNumber);
      await handler.run(update, context);
    } else {
      await handler.run(update);
    }

    return true;
  }

  /**
   * Register a handler
   */
  registerHandler(handler: UpdateHandler): number {
    this.registeredHandlers.push(handler);
    return this.registeredHandlers.length - 1;
  }

  /**
   * Set next step handler for a specific user
   */
  setNextStep(
    update: Update,
    handler: UpdateHandler,
    fallbackFunction?: () => void | Promise<void>,
    fallbackRegex: string | RegExp = /^(end|stop|cancel)$/i
  ): void {
    const config: NextStepConfig = {
      handler: handler,
    };

    if (fallbackFunction) {
      const regex =
        typeof fallbackRegex === 'string'
          ? new RegExp(fallbackRegex)
          : fallbackRegex;

      config.fallbackHandler = new MessageHandler(fallbackFunction as any, {
        regex,
      });
    }

    this.nextStepHandlers.set(update.userPhoneNumber, config);
  }

  /**
   * Clear next step handler for a user
   */
  clearNextStep(phoneNumber: string): void {
    this.nextStepHandlers.delete(phoneNumber);
  }

  /**
   * Get all registered handlers
   */
  getHandlers(): UpdateHandler[] {
    return [...this.registeredHandlers];
  }

  /**
   * Clear all handlers
   */
  clearHandlers(): void {
    this.registeredHandlers = [];
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { size: number; isProcessing: boolean } {
    return {
      size: this.queue.size,
      isProcessing: this.queue.isProcessing,
    };
  }
}
