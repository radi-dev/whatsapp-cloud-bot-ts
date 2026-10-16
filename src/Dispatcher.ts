/**
 * Dispatcher Class
 * Routes incoming messages to appropriate handlers
 */

import type {
  WebhookPayload,
  WebhookValue,
  WhatsAppMessage,
  WhatsAppClient,
  StatusHandlerFunction,
  StatusHandlerOptions,
  MessageStatusType,
  NextStepOptions,
  NextStepState,
} from './types/index.js';
import { Update } from './Update.js';
import { StatusUpdate } from './StatusUpdate.js';
import { UpdateHandler } from './Handlers.js';
import { isOlderThanMinutes } from './utils/helpers.js';
import type { ContextStore } from './context/ContextStore.js';
import {
  ContextConflictError,
  ContextStoreError,
  ContextStoreRequiredError,
} from './context/ContextStore.js';
import { UserContext } from './context/UserContext.js';
import type { UserContextHooks } from './context/UserContext.js';

/**
 * Thrown when a step name is referenced that was never registered with
 * `registerStep` (typo, or the handler was registered on another instance
 * only — every instance must register every step at startup).
 */
export class UnknownStepError extends Error {
  public readonly step: string;

  constructor(step: string, known: string[]) {
    super(
      `Unknown next-step handler "${step}". Register it at startup on every ` +
        `instance with client.registerStep('${step}', handler) or the \`steps\` ` +
        `config option. Registered steps: ${known.length ? known.join(', ') : '(none)'}.`
    );
    this.name = 'UnknownStepError';
    this.step = step;
  }
}

/** A handler considered for an update, with routing metadata. */
interface Candidate {
  handler: UpdateHandler;
  /** Extra gate evaluated on the extracted message text (fallback regex). */
  gate?: RegExp;
  /** Running this handler consumes the user's pending next step. */
  consumesStep: boolean;
}

/** Default number of re-runs of a handler after an optimistic-lock conflict. */
export const DEFAULT_CONTEXT_CONFLICT_RETRIES = 3;

/** Context-related dispatcher settings (mirrors the `WhatsAppConfig` fields). */
export interface DispatcherContextOptions {
  /** Persistent per-user context storage; absent = context disabled. */
  store?: ContextStore;
  /** Re-runs of a handler after an optimistic-lock conflict. Default 3. */
  conflictRetries?: number;
  /**
   * Skip a message whose id was already handled for this user (WhatsApp
   * redelivers webhooks that were not acknowledged in time). Requires a
   * store. Default `true`.
   */
  dedupeMessages?: boolean;
}

/**
 * Dispatcher class - manages message routing and handler execution
 */
export class Dispatcher {
  private bot: WhatsAppClient;
  /**
   * Per-phone-number processing chains. Updates for the same number are
   * processed serially (chained); different numbers run concurrently.
   */
  private chains: Map<string, Promise<void>> = new Map();
  private inFlight = 0;
  private registeredHandlers: UpdateHandler[] = [];
  private statusHandlers: Array<{
    action: StatusHandlerFunction;
    statuses?: MessageStatusType[];
    ignoreAfterMinutes?: number;
  }> = [];
  private markAsRead: boolean;
  private showTyping: boolean;
  /**
   * Named step handlers for multi-turn flows. The *name* is what gets
   * persisted in the user's context record, so every instance must register
   * the same steps at startup.
   */
  private readonly steps: Map<string, UpdateHandler> = new Map();
  private readonly stepNames: Map<UpdateHandler, string> = new Map();
  /**
   * Contexts currently attached to an in-flight handler run, by phone number.
   * Per-phone serialisation guarantees at most one per number per process;
   * lets `setNextStep(phone)` / `clearNextStep(phone)` called from inside a
   * handler join that handler's atomic save instead of racing it.
   */
  private readonly inFlightContexts: Map<string, UserContext> = new Map();
  /** Persistent per-user context storage; absent = context disabled. */
  private readonly contextStore?: ContextStore;
  /** How many times to re-run a handler after a context version conflict. */
  private readonly contextConflictRetries: number;
  /** Whether already-handled message ids are skipped (needs a store). */
  private readonly dedupeMessages: boolean;

  constructor(
    bot: WhatsAppClient,
    markAsRead: boolean = true,
    showTyping: boolean = false,
    context: DispatcherContextOptions = {}
  ) {
    this.bot = bot;
    this.markAsRead = markAsRead;
    this.showTyping = showTyping;
    this.contextStore = context.store;
    this.contextConflictRetries = Math.max(
      0,
      Math.floor(context.conflictRetries ?? DEFAULT_CONTEXT_CONFLICT_RETRIES)
    );
    this.dedupeMessages = context.dedupeMessages !== false;
  }

  /**
   * The configured {@link ContextStore}, if any.
   */
  getContextStore(): ContextStore | undefined {
    return this.contextStore;
  }

  /**
   * Load the persistent context for a user (for use outside handlers, e.g.
   * from a status handler or an admin endpoint). Remember to `await
   * context.save()` after changing it.
   *
   * @throws {ContextStoreRequiredError} when no store is configured
   */
  async getContext(userId: string): Promise<UserContext> {
    return this.loadContext(this.requireContextStore('getContext()'), userId);
  }

  /**
   * Delete a user's persistent context.
   *
   * @throws {ContextStoreRequiredError} when no store is configured
   */
  async clearContext(userId: string): Promise<void> {
    await this.requireContextStore('clearContext()').delete(userId);
  }

  /**
   * Hard-fail guard: anything that references the context without a store
   * configured throws, so misconfiguration is surfaced immediately.
   */
  private requireContextStore(what: string): ContextStore {
    if (!this.contextStore) {
      throw new ContextStoreRequiredError(`${what} requires a context store.`);
    }
    return this.contextStore;
  }

  /**
   * Enforce that a context-aware handler can actually be served.
   */
  private assertHandlerContext(handler: UpdateHandler, how: string): void {
    if (handler.context && !this.contextStore) {
      throw new ContextStoreRequiredError(
        `A "${handler.name}" handler registered via ${how} declares a context ` +
          `parameter (or sets { context: true }).`
      );
    }
  }

  private loadContext(
    store: ContextStore,
    userId: string
  ): Promise<UserContext> {
    return UserContext.load(store, userId, this.contextHooks());
  }

  private contextHooks(): UserContextHooks {
    return { validateStep: (name) => this.assertStepRegistered(name) };
  }

  private assertStepRegistered(name: string): void {
    if (!this.steps.has(name)) {
      throw new UnknownStepError(name, [...this.steps.keys()]);
    }
  }

  /**
   * Process an incoming webhook update.
   *
   * Updates for the same phone number are processed serially (so conversation
   * state such as {@link setNextStep} and per-user context stays ordered),
   * while updates for different numbers are processed concurrently.
   *
   * The returned promise resolves (or rejects) with this update's own outcome;
   * a failure in one update never blocks subsequent updates for that number.
   */
  async processUpdate(update: WebhookPayload): Promise<void> {
    const key = this.serializationKey(update);
    const previous = this.chains.get(key) ?? Promise.resolve();

    const run = previous.then(() => this.processQueueItem(update));
    // The stored chain must never reject, or a thrown handler would break
    // serialization for every later update from the same number.
    const chained = run.catch(() => {});
    this.chains.set(key, chained);
    this.inFlight++;

    try {
      await run;
    } finally {
      this.inFlight--;
      // Drop the key once this is the tail of its chain, to avoid leaking a
      // map entry per phone number seen.
      if (this.chains.get(key) === chained) {
        this.chains.delete(key);
      }
    }
  }

  /**
   * Derive the serialization key for an update — the user's phone number, so
   * all events (messages and statuses) for one number share a chain.
   */
  private serializationKey(payload: WebhookPayload): string {
    const value = payload.entry?.[0]?.changes?.[0]?.value;
    return (
      value?.messages?.[0]?.from ??
      value?.statuses?.[0]?.recipient_id ??
      '__default__'
    );
  }

  /**
   * Process a single queue item.
   *
   * When a context store is configured the user's record is loaded once per
   * message: it tells us whether a next step is pending (routing) and is
   * handed to the handler (state). The whole route → run → save sequence is
   * optimistically locked — if another instance changed the record meanwhile,
   * routing is re-resolved against the fresh record and the handler re-run,
   * up to `contextConflictRetries` times.
   */
  private async processQueueItem(
    webhookPayload: WebhookPayload
  ): Promise<void> {
    const value: WebhookValue | undefined =
      webhookPayload.entry?.[0]?.changes?.[0]?.value;

    if (!value?.metadata?.phone_number_id) {
      return;
    }

    if (String(value.metadata.phone_number_id) !== String(this.bot.id)) {
      return;
    }

    // Status webhooks carry delivery receipts (sent/delivered/read/failed),
    // not inbound messages — route them to the registered status handlers.
    if (value.statuses && value.statuses.length > 0) {
      await this.dispatchStatuses(value);
      return;
    }

    const message = value.messages?.[0];
    if (!message) {
      return;
    }

    // Mark message as read if enabled
    if (this.markAsRead) {
      await this.bot.markAsRead(message, this.showTyping).catch(() => {
        // Silently fail - marking as read is not critical
      });
    }

    const userId = new Update(this.bot, value).userPhoneNumber;
    const store = this.contextStore;
    const maxAttempts = store ? 1 + this.contextConflictRetries : 1;

    for (let attempt = 1; ; attempt++) {
      const context = store ? await this.loadContext(store, userId) : undefined;
      try {
        await this.routeAndRun(value, message, context);
        return;
      } catch (error) {
        if (
          !(error instanceof ContextConflictError) ||
          attempt >= maxAttempts
        ) {
          throw error;
        }
      }
    }
  }

  /**
   * One attempt: pick the first matching handler for the message (honouring
   * the pending next step from `context`), run it, and persist the context.
   *
   * Idempotency: once a handler has committed for a message id, the id is
   * stored in the user's record (same save, same optimistic lock). WhatsApp
   * redelivers webhooks it did not see a timely 200 for; such a redelivery
   * finds the id and is skipped instead of being applied twice. A message
   * whose handler failed is *not* marked, so the redelivery re-runs it.
   */
  private async routeAndRun(
    value: WebhookValue,
    message: WhatsAppMessage,
    context: UserContext | undefined
  ): Promise<void> {
    if (this.dedupeMessages && context?.hasSeenMessage(message.id)) {
      return; // redelivery of an already-handled message
    }

    for (const candidate of this.getCandidates(context)) {
      const { handler } = candidate;
      const extractedData = handler.extractData(message);
      const messageText = extractedData.messageText;

      if (candidate.gate && !candidate.gate.test(messageText)) {
        continue;
      }
      if (!this.handlerMatches(handler, message, messageText)) {
        continue;
      }

      const update = new Update(this.bot, value);
      update.messageText = messageText;
      Object.assign(update, extractedData);
      update.attachContext(context);

      if (candidate.consumesStep) {
        // Consumed before running so the handler may set a new next step.
        context?.clearNextStep();
      }

      if (context) {
        this.inFlightContexts.set(update.userPhoneNumber, context);
      }
      try {
        await handler.run(update, handler.context ? context : undefined);
        // Persist state, step transition and the handled-message marker
        // together. A throwing handler skips this, so its changes (and the
        // step consumption) are discarded and a redelivery will retry it.
        if (context && this.dedupeMessages) {
          context.markMessageSeen(message.id);
        }
        await context?.save();
      } finally {
        this.inFlightContexts.delete(update.userPhoneNumber);
      }
      return; // Stop processing after first successful handler
    }

    // No handler matched. The only possible in-memory change is a stale step
    // having been dropped in getCandidates(); persist that opportunistically.
    if (context?.isDirty) {
      await context.save().catch((error) => {
        if (!(error instanceof ContextConflictError)) throw error;
      });
    }
  }

  /**
   * Handlers to try for this update, in order: persistent handlers first,
   * then — if a next step is pending — its fallback (gated by the fallback
   * regex) and the step itself; otherwise every registered handler.
   */
  private getCandidates(context: UserContext | undefined): Candidate[] {
    const persistent: Candidate[] = this.registeredHandlers
      .filter((h) => h.persistent)
      .map((handler) => ({ handler, consumesStep: false }));

    const nextStep = context?.nextStep;
    if (nextStep) {
      const stepHandler = this.steps.get(nextStep.step);
      if (stepHandler) {
        const candidates = [...persistent];
        const fallback = nextStep.fallback
          ? this.steps.get(nextStep.fallback)
          : undefined;
        if (fallback) {
          candidates.push({
            handler: fallback,
            gate: nextStep.fallbackRegex,
            consumesStep: true,
          });
        }
        candidates.push({ handler: stepHandler, consumesStep: true });
        return candidates;
      }
      // The step was registered by a previous deployment but not this one:
      // drop it rather than leaving the user stuck, and route normally.
      context?.clearNextStep();
    }

    return [
      ...persistent,
      ...this.registeredHandlers.map((handler) => ({
        handler,
        consumesStep: false,
      })),
    ];
  }

  /**
   * Whether a handler accepts this message (type, interactive sub-type, age
   * limit and filter).
   */
  private handlerMatches(
    handler: UpdateHandler,
    message: WhatsAppMessage,
    messageText: string
  ): boolean {
    // Check if handler type matches message type
    if (handler.name !== message.type) {
      return false;
    }

    // For interactive handlers, gate on the reply sub-type (button_reply /
    // list_reply / nfm_reply) so button/list/flow handlers don't cross-fire.
    if (
      message.type === 'interactive' &&
      handler.interactiveTypes &&
      (!message.interactive ||
        !handler.interactiveTypes.includes(message.interactive.type))
    ) {
      return false;
    }

    // Skip stale messages if the handler opted into an age limit
    if (
      handler.ignoreAfterMinutes !== undefined &&
      isOlderThanMinutes(message.timestamp, handler.ignoreAfterMinutes)
    ) {
      return false;
    }

    return handler.filterCheck(messageText);
  }

  /**
   * Dispatch each status in a `statuses` webhook to the registered status
   * handlers. Errors thrown by a handler are swallowed so that one failing
   * handler cannot block the others.
   */
  private async dispatchStatuses(value: WebhookValue): Promise<void> {
    if (this.statusHandlers.length === 0 || !value.statuses) {
      return;
    }

    for (const status of value.statuses) {
      const statusUpdate = new StatusUpdate(this.bot, value, status);

      for (const handler of this.statusHandlers) {
        if (handler.statuses && !handler.statuses.includes(status.status)) {
          continue;
        }
        if (
          handler.ignoreAfterMinutes !== undefined &&
          isOlderThanMinutes(status.timestamp, handler.ignoreAfterMinutes)
        ) {
          continue;
        }
        try {
          await handler.action(statusUpdate);
        } catch {
          // A failing status handler must not break others or stall the queue
        }
      }
    }
  }

  /**
   * Register a handler
   */
  registerHandler(handler: UpdateHandler): number {
    this.assertHandlerContext(handler, 'registerHandler()');
    this.registeredHandlers.push(handler);
    return this.registeredHandlers.length - 1;
  }

  /**
   * Register a message-status handler
   */
  registerStatusHandler(
    action: StatusHandlerFunction,
    options: StatusHandlerOptions = {}
  ): void {
    const statuses = options.status
      ? Array.isArray(options.status)
        ? options.status
        : [options.status]
      : undefined;

    this.statusHandlers.push({
      action,
      statuses,
      ignoreAfterMinutes: options.ignoreAfterMinutes,
    });
  }

  // ---------------------------------------------------------------------------
  // Next steps (persisted in the context store)
  // ---------------------------------------------------------------------------

  /**
   * Register a named step handler for multi-turn flows. Must be called at
   * startup on **every** instance, because only the name is persisted.
   *
   * @throws {ContextStoreRequiredError} when no context store is configured
   *   (steps are stored in it)
   */
  registerStep(name: string, handler: UpdateHandler): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new ContextStoreError(
        'registerStep: name must be a non-empty string.'
      );
    }
    if (!(handler instanceof UpdateHandler)) {
      throw new ContextStoreError(
        `registerStep("${name}"): handler must be an UpdateHandler instance ` +
          `(e.g. new TextHandler(fn)).`
      );
    }
    this.requireContextStore(`registerStep("${name}")`);
    this.assertHandlerContext(handler, `registerStep("${name}")`);
    if (this.steps.has(name) && this.steps.get(name) !== handler) {
      throw new ContextStoreError(
        `registerStep: a different handler is already registered as "${name}".`
      );
    }
    this.steps.set(name, handler);
    this.stepNames.set(handler, name);
  }

  /** The handler registered under `name`, if any. */
  getStep(name: string): UpdateHandler | undefined {
    return this.steps.get(name);
  }

  /** Names of all registered steps. */
  getStepNames(): string[] {
    return [...this.steps.keys()];
  }

  /**
   * Route the user's next message to a registered step.
   *
   * `target` is the current `Update` (inside a handler) or a phone number.
   * Inside a handler the change joins the handler's own context save; from
   * elsewhere (cron, admin endpoint) it is written to the store immediately
   * with optimistic locking.
   *
   * `step` may be the registered name or the registered handler instance.
   *
   * @throws {ContextStoreRequiredError} when no context store is configured
   * @throws {UnknownStepError} when the step (or fallback) is not registered
   */
  async setNextStep(
    target: Update | string,
    step: string | UpdateHandler,
    options: NextStepOptions = {}
  ): Promise<void> {
    if (typeof options === 'function') {
      throw new ContextStoreError(
        'setNextStep no longer accepts a fallback function: next steps are ' +
          'persisted by name. Register the fallback with registerStep() and ' +
          'pass { fallback: "name", fallbackRegex } instead.'
      );
    }
    this.requireContextStore('setNextStep()');
    const stepName = this.resolveStepName(step);
    this.assertStepRegistered(stepName);
    if (options.fallback !== undefined) {
      this.assertStepRegistered(options.fallback);
    }
    await this.mutateContext('setNextStep()', target, (context) => {
      context.setNextStep(stepName, options);
    });
  }

  /**
   * Cancel the user's pending next step (no-op when none is pending).
   */
  async clearNextStep(target: Update | string): Promise<void> {
    await this.mutateContext('clearNextStep()', target, (context) => {
      context.clearNextStep();
    });
  }

  /**
   * The user's pending next step, if any.
   */
  async getNextStep(
    target: Update | string
  ): Promise<NextStepState | undefined> {
    const attached = this.attachedContextFor(target);
    if (attached) {
      return attached.nextStep;
    }
    const store = this.requireContextStore('getNextStep()');
    const context = await this.loadContext(store, this.userIdOf(target));
    return context.nextStep;
  }

  private resolveStepName(step: string | UpdateHandler): string {
    if (typeof step === 'string') {
      return step;
    }
    const name = this.stepNames.get(step);
    if (!name) {
      throw new ContextStoreError(
        'setNextStep was given a handler instance that is not registered as a ' +
          'step. Next steps are persisted by name so they survive restarts and ' +
          'are shared across instances: register the handler at startup with ' +
          'registerStep("name", handler) and pass the name (or that instance).'
      );
    }
    return name;
  }

  /**
   * Apply `mutate` to the user's context: in memory when a handler for that
   * user is in flight (persisted with the handler's save), otherwise via an
   * immediate optimistically-locked read-modify-write.
   */
  private async mutateContext(
    what: string,
    target: Update | string,
    mutate: (context: UserContext) => void
  ): Promise<void> {
    const store = this.requireContextStore(what);
    const attached = this.attachedContextFor(target);
    if (attached) {
      mutate(attached);
      return;
    }

    const userId = this.userIdOf(target);
    const maxAttempts = 1 + this.contextConflictRetries;
    for (let attempt = 1; ; attempt++) {
      const context = await this.loadContext(store, userId);
      mutate(context);
      try {
        await context.save();
        return;
      } catch (error) {
        if (
          !(error instanceof ContextConflictError) ||
          attempt >= maxAttempts
        ) {
          throw error;
        }
      }
    }
  }

  private attachedContextFor(target: Update | string): UserContext | undefined {
    if (target instanceof Update) {
      return target.hasContext
        ? target.context
        : this.inFlightContexts.get(target.userPhoneNumber);
    }
    return this.inFlightContexts.get(target);
  }

  private userIdOf(target: Update | string): string {
    return target instanceof Update ? target.userPhoneNumber : target;
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
   * Get processing status.
   *
   * `size` is the number of updates currently being processed (in flight
   * across all phone-number chains); `isProcessing` is true while any update
   * is in flight.
   */
  getQueueStatus(): { size: number; isProcessing: boolean } {
    return {
      size: this.inFlight,
      isProcessing: this.inFlight > 0,
    };
  }
}
