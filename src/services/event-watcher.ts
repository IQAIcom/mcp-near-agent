import { EventEmitter } from "node:events";
import * as cron from "node-cron";
import type {
	AgentEvent,
	EventSubscription,
	EventWatcherConfig,
	EventWatcherEvents,
	EventWatcherStats,
	SubscriptionConfig,
	WatchEventRequest,
} from "../types.js";
import { AuthManager } from "./auth-manager.js";
import { BlockPoller } from "./block-poller.js";
import { EventProcessor } from "./event-processor.js";

/**
 * Orchestrates event watching by managing subscriptions and coordinating BlockPoller + EventProcessor.
 * Single responsibility: Subscription CRUD + Component coordination + Lifecycle management.
 * Does not handle block polling or event processing directly.
 */
export class EventWatcher extends EventEmitter<EventWatcherEvents> {
	private static readonly DEFAULT_CRON_EXPRESSION = "*/10 * * * * *";
	private static readonly DEFAULT_RESPONSE_METHOD = "agent_response";

	private authManager: AuthManager;
	private blockPoller: BlockPoller;
	private eventProcessor: EventProcessor;
	private isInitialized = false;
	private startTime = Date.now();

	// Subscription management (simple CRUD)
	private subscriptions = new Map<string, EventSubscription>();

	// Statistics tracking
	private stats = {
		totalEventsDetected: 0,
		totalEventsProcessed: 0,
		totalEventsSuccessful: 0,
		totalEventsFailed: 0,
		totalProcessingTime: 0,
	};

	constructor(config: EventWatcherConfig = {}) {
		super();

		this.authManager = AuthManager.getInstance();
		this.blockPoller = new BlockPoller();
		this.eventProcessor = new EventProcessor();

		this.setupComponentHandlers();
	}

	/**
	 * Initialize the EventWatcher - handles all authentication internally
	 */
	private async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		console.log("🚀 Initializing EventWatcher...");

		try {
			// Initialize AuthManager if not already done
			if (!this.authManager.isReady()) {
				console.log("🔄 Initializing NEAR account via AuthManager...");
				await this.authManager.initialize();
			}

			// Validate connection
			const isValid = await this.authManager.validateConnection();
			if (!isValid) {
				throw new Error("NEAR account connection is not valid");
			}

			const account = this.authManager.getAccount();
			if (!account) {
				throw new Error("Failed to get NEAR account from AuthManager");
			}

			// Initialize components with account
			this.blockPoller.setAccount(account);
			this.eventProcessor.setAccount(account);

			this.isInitialized = true;
			console.log("✅ EventWatcher initialized successfully");
		} catch (error) {
			console.error("❌ Failed to initialize EventWatcher:", error);
			throw new Error(
				`EventWatcher initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	/**
	 * Start watching for a specific event
	 */
	public async watchEvent(request: WatchEventRequest): Promise<string> {
		await this.initialize();

		const {
			contractId,
			eventName,
			responseMethodName,
			cronExpression,
			session,
		} = request;

		if (this.hasSubscription(contractId, eventName)) {
			throw new Error(
				`Already watching event '${eventName}' on contract '${contractId}'`,
			);
		}

		try {
			console.log(
				`🎯 Starting to watch event '${eventName}' on contract '${contractId}'`,
			);

			// Create subscription
			const subscriptionConfig: SubscriptionConfig = {
				contractId,
				eventName,
				responseMethodName:
					responseMethodName || EventWatcher.DEFAULT_RESPONSE_METHOD,
				cronExpression: cronExpression || EventWatcher.DEFAULT_CRON_EXPRESSION,
				session,
			};

			const subscription = this.createSubscription(subscriptionConfig);

			// Initialize BlockPoller state for this subscription
			this.blockPoller.initializeSubscription(subscription.id);

			// Start cron job for polling
			const cronJob = this.startPolling(subscription);
			subscription.cronJob = cronJob;

			this.emit("watcher:started", subscription.id);
			this.emitStatsUpdate();

			console.log(
				`✅ Successfully started watching event '${eventName}' on contract '${contractId}'`,
			);

			return subscription.id;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			console.error("❌ Failed to start watching event:", error);

			// Clean up partial subscription
			this.removeSubscription(contractId, eventName);

			throw new Error(`Failed to watch event: ${errorMessage}`);
		}
	}

	/**
	 * Stop watching a specific event
	 */
	public async stopWatching(
		contractId: string,
		eventName: string,
	): Promise<boolean> {
		const subscription = this.getSubscription(contractId, eventName);

		if (!subscription) {
			console.warn(
				`⚠️ No active subscription found for event '${eventName}' on contract '${contractId}'`,
			);
			return false;
		}

		try {
			console.log(
				`🛑 Stopping watch for event '${eventName}' on contract '${contractId}'`,
			);

			// Stop cron job
			if (subscription.cronJob) {
				subscription.cronJob.stop();
				subscription.cronJob.destroy();
			}

			// Clean up BlockPoller state
			this.blockPoller.removeSubscription(subscription.id);

			// Remove subscription
			const success = this.removeSubscription(contractId, eventName);

			if (success) {
				this.emit("watcher:stopped", subscription.id);
				this.emitStatsUpdate();
				console.log(
					`✅ Successfully stopped watching event '${eventName}' on contract '${contractId}'`,
				);
			}

			return success;
		} catch (error) {
			console.error("❌ Error stopping watch for event:", error);
			this.emit("watcher:error", { subscriptionId: subscription.id, error });
			return false;
		}
	}

	/**
	 * Stop watching all events
	 */
	public async stopAllWatching(): Promise<void> {
		console.log("🛑 Stopping all event watching...");

		const activeSubscriptions = this.getActiveSubscriptions();
		for (const subscription of activeSubscriptions) {
			try {
				await this.stopWatching(
					subscription.contractId,
					subscription.eventName,
				);
			} catch (error) {
				console.error(
					`❌ Error stopping subscription ${subscription.id}:`,
					error,
				);
			}
		}

		console.log("✅ All event watching stopped");
	}

	// =============================================================================
	// SUBSCRIPTION MANAGEMENT (Simple CRUD)
	// =============================================================================

	private createSubscription(config: SubscriptionConfig): EventSubscription {
		const subscriptionId = this.generateSubscriptionId(
			config.contractId,
			config.eventName,
		);

		if (this.subscriptions.has(subscriptionId)) {
			throw new Error(
				`Already subscribed to event '${config.eventName}' on contract '${config.contractId}'`,
			);
		}

		const subscription: EventSubscription = {
			id: subscriptionId,
			contractId: config.contractId,
			eventName: config.eventName,
			responseMethodName: config.responseMethodName,
			cronExpression: config.cronExpression,
			session: config.session,
			isActive: true,
			createdAt: Date.now(),
		};

		this.subscriptions.set(subscriptionId, subscription);
		console.log(
			`📝 Created subscription for event '${config.eventName}' on contract '${config.contractId}'`,
		);

		return subscription;
	}

	private removeSubscription(contractId: string, eventName: string): boolean {
		const subscriptionId = this.generateSubscriptionId(contractId, eventName);
		const subscription = this.subscriptions.get(subscriptionId);

		if (!subscription) {
			return false;
		}

		// Stop cron job if exists
		if (subscription.cronJob) {
			subscription.cronJob.stop();
			subscription.cronJob.destroy();
		}

		this.subscriptions.delete(subscriptionId);
		console.log(
			`🗑️ Removed subscription for event '${eventName}' on contract '${contractId}'`,
		);

		return true;
	}

	private hasSubscription(contractId: string, eventName: string): boolean {
		const subscriptionId = this.generateSubscriptionId(contractId, eventName);
		return this.subscriptions.has(subscriptionId);
	}

	private getSubscription(
		contractId: string,
		eventName: string,
	): EventSubscription | undefined {
		const subscriptionId = this.generateSubscriptionId(contractId, eventName);
		return this.subscriptions.get(subscriptionId);
	}

	private getActiveSubscriptions(): EventSubscription[] {
		return Array.from(this.subscriptions.values()).filter(
			(sub) => sub.isActive,
		);
	}

	private generateSubscriptionId(
		contractId: string,
		eventName: string,
	): string {
		return `${contractId}:${eventName}`;
	}

	private markEventReceived(contractId: string, eventName: string): void {
		const subscription = this.getSubscription(contractId, eventName);
		if (subscription) {
			subscription.lastEventAt = Date.now();
		}
	}

	// =============================================================================
	// POLLING COORDINATION
	// =============================================================================

	private startPolling(subscription: EventSubscription): cron.ScheduledTask {
		console.log(
			`⏰ Starting cron job for '${subscription.eventName}' with expression: ${subscription.cronExpression}`,
		);

		const cronJob = cron.schedule(subscription.cronExpression, async () => {
			// Skip if BlockPoller is already processing this subscription
			if (this.blockPoller.isProcessing(subscription.id)) {
				console.log(
					`⏳ Subscription ${subscription.id} already processing, skipping...`,
				);
				return;
			}

			try {
				await this.blockPoller.pollForEvents(subscription);
			} catch (error) {
				console.error(
					`❌ Error during polling for subscription ${subscription.id}:`,
					error,
				);
				this.emit("watcher:error", { subscriptionId: subscription.id, error });
			}
		});

		cronJob.start();
		return cronJob;
	}

	// =============================================================================
	// COMPONENT EVENT HANDLERS
	// =============================================================================

	private setupComponentHandlers(): void {
		// Handle events found by BlockPoller
		this.blockPoller.on("event:found", async ({ event, subscription }) => {
			console.log(
				`🔔 Event detected: ${event.eventType} from ${subscription.contractId}`,
			);

			// Update statistics
			this.stats.totalEventsDetected++;
			this.markEventReceived(subscription.contractId, subscription.eventName);

			// Emit event detected
			this.emit("event:detected", { event, subscription });

			// Process the event
			await this.processDetectedEvent(event, subscription);
			this.emitStatsUpdate();
		});

		// Handle BlockPoller errors
		this.blockPoller.on("block:error", ({ subscriptionId, error }) => {
			console.error(
				`❌ BlockPoller error for subscription ${subscriptionId}:`,
				error,
			);
			this.emit("watcher:error", { subscriptionId, error });
		});

		// Handle EventProcessor results
		this.eventProcessor.on("event:processed", (result) => {
			console.log(
				`✅ Event ${result.requestId} processed successfully in ${result.processingTime}ms`,
			);

			this.updateProcessingStats(true, result.processingTime);
			this.emit("event:processed", {
				requestId: result.requestId,
				response: result.response || "No Response",
				processingTime: result.processingTime,
			});
		});

		this.eventProcessor.on("event:processing-error", (result) => {
			console.error(
				`❌ Event ${result.requestId} processing failed: ${result.error}`,
			);

			this.updateProcessingStats(false, result.processingTime);
			this.emit("event:failed", {
				requestId: result.requestId,
				error: result.error || "No error",
				processingTime: result.processingTime,
			});
		});
	}

	private async processDetectedEvent(
		event: AgentEvent,
		subscription: EventSubscription,
	): Promise<void> {
		const account = this.authManager.getAccount();
		if (!account) {
			throw new Error("NEAR account not available");
		}

		try {
			await this.eventProcessor.processEvent({
				subscription,
				event,
				account,
			});
		} catch (error) {
			console.error("❌ Unexpected error processing event:", error);
			this.stats.totalEventsFailed++;
			this.emit("event:failed", {
				requestId: event.requestId,
				error: error instanceof Error ? error.message : "Unknown error",
				processingTime: 0,
			});
		}
	}

	private updateProcessingStats(
		success: boolean,
		processingTime: number,
	): void {
		this.stats.totalEventsProcessed++;
		this.stats.totalProcessingTime += processingTime;

		if (success) {
			this.stats.totalEventsSuccessful++;
		} else {
			this.stats.totalEventsFailed++;
		}
	}

	private emitStatsUpdate(): void {
		this.emit("stats:updated", this.getStats());
	}

	// =============================================================================
	// PUBLIC API METHODS
	// =============================================================================

	public getWatchingStatus() {
		const subscriptions = this.getActiveSubscriptions();

		return {
			isInitialized: this.isInitialized,
			totalSubscriptions: subscriptions.length,
			subscriptions: subscriptions.map((sub) => ({
				id: sub.id,
				contractId: sub.contractId,
				eventName: sub.eventName,
				responseMethodName: sub.responseMethodName,
				cronExpression: sub.cronExpression,
				isActive: sub.isActive,
				createdAt: sub.createdAt,
				lastEventAt: sub.lastEventAt,
			})),
			authManager: this.authManager.getStatus(),
			blockPoller: this.blockPoller.getStats(),
			eventProcessor: this.eventProcessor.getStats(),
		};
	}

	public getStats(): EventWatcherStats {
		const subscriptions = this.getActiveSubscriptions();

		return {
			totalSubscriptions: subscriptions.length,
			activeSubscriptions: subscriptions.filter((sub) => sub.isActive).length,
			totalEventsDetected: this.stats.totalEventsDetected,
			totalEventsProcessed: this.stats.totalEventsProcessed,
			totalEventsSuccessful: this.stats.totalEventsSuccessful,
			totalEventsFailed: this.stats.totalEventsFailed,
			successRate:
				this.stats.totalEventsProcessed > 0
					? (this.stats.totalEventsSuccessful /
							this.stats.totalEventsProcessed) *
						100
					: 0,
			averageProcessingTime:
				this.stats.totalEventsProcessed > 0
					? this.stats.totalProcessingTime / this.stats.totalEventsProcessed
					: 0,
			uptime: Date.now() - this.startTime,
		};
	}

	public pauseWatching(contractId: string, eventName: string): boolean {
		const subscription = this.getSubscription(contractId, eventName);
		if (!subscription) {
			return false;
		}

		subscription.isActive = false;

		// Stop the cron job but don't destroy the subscription
		if (subscription.cronJob) {
			subscription.cronJob.stop();
		}

		console.log(
			`⏸️ Paused subscription for event '${eventName}' on contract '${contractId}'`,
		);
		return true;
	}

	public resumeWatching(contractId: string, eventName: string): boolean {
		const subscription = this.getSubscription(contractId, eventName);
		if (!subscription) {
			return false;
		}

		subscription.isActive = true;

		// Restart the cron job if it exists
		if (subscription.cronJob) {
			subscription.cronJob.start();
		}

		console.log(
			`▶️ Resumed subscription for event '${eventName}' on contract '${contractId}'`,
		);
		return true;
	}

	public isWatching(contractId: string, eventName: string): boolean {
		return this.hasSubscription(contractId, eventName);
	}

	public getWatchedEvents(): Array<{
		contractId: string;
		eventName: string;
		subscriptionId: string;
	}> {
		return this.getActiveSubscriptions().map((sub) => ({
			contractId: sub.contractId,
			eventName: sub.eventName,
			subscriptionId: sub.id,
		}));
	}

	/**
	 * Cleanup all resources
	 */
	public async cleanup(): Promise<void> {
		console.log("🧹 Cleaning up EventWatcher...");

		try {
			// Stop all watching
			await this.stopAllWatching();

			// Cleanup components
			this.blockPoller.cleanup();
			this.eventProcessor.cleanup();

			// Reset state
			this.subscriptions.clear();
			this.isInitialized = false;
			this.removeAllListeners();

			console.log("✅ EventWatcher cleaned up successfully");
		} catch (error) {
			console.error("❌ Error during EventWatcher cleanup:", error);
			throw error;
		}
	}

	// Type-safe event listener methods
	public on<K extends keyof EventWatcherEvents>(
		event: K,
		listener: (...args: EventWatcherEvents[K]) => void,
	): this {
		return super.on(event, listener as any);
	}

	public emit<K extends keyof EventWatcherEvents>(
		event: K,
		...args: EventWatcherEvents[K]
	): boolean {
		return super.emit(event, ...(args as any));
	}

	public off<K extends keyof EventWatcherEvents>(
		event: K,
		listener: (...args: EventWatcherEvents[K]) => void,
	): this {
		return super.off(event, listener as any);
	}

	public once<K extends keyof EventWatcherEvents>(
		event: K,
		listener: (...args: EventWatcherEvents[K]) => void,
	): this {
		return super.once(event, listener as any);
	}
}

// Export singleton instance
export const eventWatcher = new EventWatcher();
