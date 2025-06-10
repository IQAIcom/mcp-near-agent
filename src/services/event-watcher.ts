import { EventEmitter } from "node:events";
import type { FastMCPSession } from "fastmcp";
import type { AgentEvent } from "../types.js";
import { AuthManager } from "./auth-manager.js";
import { EventListener } from "./event-listener.js";
import { EventProcessor } from "./event-processor.js";
import {
	type EventSubscription,
	type SubscriptionConfig,
	subscriptionManager,
} from "./subscription-manager.js";

export interface EventWatcherConfig {
	networkId?: string;
	nodeUrl?: string;
	gasLimit?: string;
}

export interface WatchEventRequest {
	contractId: string;
	eventName: string;
	responseMethodName: string;
	cronExpression?: string;
	session: FastMCPSession;
}

// Type-safe event definitions
export interface EventWatcherEvents {
	"watcher:started": [subscriptionId: string];
	"watcher:stopped": [subscriptionId: string];
	"watcher:error": [data: { subscriptionId: string; error: unknown }];
	"event:detected": [
		data: { event: AgentEvent; subscription: EventSubscription },
	];
	"event:processed": [
		data: { requestId: string; response: string; processingTime: number },
	];
	"event:failed": [
		data: { requestId: string; error: string; processingTime: number },
	];
	"stats:updated": [stats: EventWatcherStats];
}

export interface EventWatcherStats {
	totalSubscriptions: number;
	activeSubscriptions: number;
	totalEventsDetected: number;
	totalEventsProcessed: number;
	totalEventsSuccessful: number;
	totalEventsFailed: number;
	successRate: number;
	averageProcessingTime: number;
	uptime: number;
}

export class EventWatcher extends EventEmitter<EventWatcherEvents> {
	private authManager: AuthManager;
	private eventListener: EventListener;
	private eventProcessor: EventProcessor;
	private isInitialized = false;
	private startTime = Date.now();

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
		this.eventListener = new EventListener({
			networkId: config.networkId,
			nodeUrl: config.nodeUrl,
			gasLimit: config.gasLimit,
		});

		this.eventProcessor = new EventProcessor();

		this.setupEventHandlers();
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

			// Initialize components
			await this.eventListener.initialize();
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
		// Initialize if not already done
		await this.initialize();

		const {
			contractId,
			eventName,
			responseMethodName,
			cronExpression,
			session,
		} = request;

		// Check if already watching this event
		if (subscriptionManager.hasSubscription(contractId, eventName)) {
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
				responseMethodName,
				cronExpression: cronExpression || "*/10 * * * * *",
				session,
			};

			const subscription = subscriptionManager.subscribe(subscriptionConfig);

			// Start listening with EventListener
			const cronJob = this.eventListener.startListening(subscription);

			// Update subscription with cron job reference
			subscriptionManager.updateCronJob(contractId, eventName, cronJob);

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

			// Clean up partial subscription if it was created
			subscriptionManager.unsubscribe(contractId, eventName);

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
		const subscription = subscriptionManager.getSubscription(
			contractId,
			eventName,
		);

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

			// Stop listening
			this.eventListener.stopListening(subscription.id);

			// Remove subscription
			const success = subscriptionManager.unsubscribe(contractId, eventName);

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

		const activeSubscriptions = subscriptionManager.getActiveSubscriptions();

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

	/**
	 * Get current watching status
	 */
	public getWatchingStatus() {
		const subscriptions = subscriptionManager.getActiveSubscriptions();
		const listenerStats = this.eventListener.getStats();
		const processorStats = this.eventProcessor.getStats();

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
			listener: listenerStats,
			processor: processorStats,
		};
	}

	/**
	 * Get comprehensive statistics
	 */
	public getStats(): EventWatcherStats {
		const subscriptionStats = subscriptionManager.getStats();

		return {
			totalSubscriptions: subscriptionStats.total,
			activeSubscriptions: subscriptionStats.active,
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

	/**
	 * Pause watching for a specific event
	 */
	public pauseWatching(contractId: string, eventName: string): boolean {
		return subscriptionManager.pauseSubscription(contractId, eventName);
	}

	/**
	 * Resume watching for a specific event
	 */
	public resumeWatching(contractId: string, eventName: string): boolean {
		const subscription = subscriptionManager.getSubscription(
			contractId,
			eventName,
		);
		if (!subscription) {
			return false;
		}

		const success = subscriptionManager.resumeSubscription(
			contractId,
			eventName,
		);

		if (success && subscription.cronJob) {
			// Restart the cron job
			subscription.cronJob.start();
		}

		return success;
	}

	/**
	 * Check if watching a specific event
	 */
	public isWatching(contractId: string, eventName: string): boolean {
		return subscriptionManager.hasSubscription(contractId, eventName);
	}

	/**
	 * Get list of all watched events
	 */
	public getWatchedEvents(): Array<{
		contractId: string;
		eventName: string;
		subscriptionId: string;
	}> {
		return subscriptionManager.getActiveSubscriptions().map((sub) => ({
			contractId: sub.contractId,
			eventName: sub.eventName,
			subscriptionId: sub.id,
		}));
	}

	/**
	 * Setup event handlers to connect EventListener and EventProcessor
	 */
	private setupEventHandlers(): void {
		// Handle events found by EventListener
		this.eventListener.on("event:found", async ({ event, subscription }) => {
			console.log(
				`🔔 Event detected: ${event.eventType} from ${subscription.contractId}`,
			);

			this.stats.totalEventsDetected++;
			subscriptionManager.markEventReceived(
				subscription.contractId,
				subscription.eventName,
			);

			this.emit("event:detected", { event, subscription });

			// Process the event
			const account = this.authManager.getAccount();
			if (account) {
				try {
					const result = await this.eventProcessor.processEvent({
						subscription,
						event,
						account,
					});

					this.updateProcessingStats(result.success, result.processingTime);

					if (result.success) {
						this.emit("event:processed", {
							requestId: result.requestId,
							response: result.response || "No Response",
							processingTime: result.processingTime,
						});
					} else {
						this.emit("event:failed", {
							requestId: result.requestId,
							error: result.error || "No error",
							processingTime: result.processingTime,
						});
					}
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

			this.emitStatsUpdate();
		});

		// Handle EventListener errors
		this.eventListener.on("event:error", ({ subscription, error }) => {
			console.error(
				`❌ EventListener error for subscription ${subscription.id}:`,
				error,
			);
			this.emit("watcher:error", { subscriptionId: subscription.id, error });
		});

		// Handle EventProcessor events (optional additional logging)
		this.eventProcessor.on("event:processed", (result) => {
			console.log(
				`✅ Event ${result.requestId} processed successfully in ${result.processingTime}ms`,
			);
		});

		this.eventProcessor.on("event:processing-error", (result) => {
			console.error(
				`❌ Event ${result.requestId} processing failed: ${result.error}`,
			);
		});
	}

	/**
	 * Update processing statistics
	 */
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

	/**
	 * Emit stats update event
	 */
	private emitStatsUpdate(): void {
		this.emit("stats:updated", this.getStats());
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
			this.eventListener.cleanup();
			this.eventProcessor.cleanup();
			subscriptionManager.cleanup();

			// Reset state
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
