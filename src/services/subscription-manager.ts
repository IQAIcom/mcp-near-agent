import type * as cron from "node-cron";
import type { MCPSession } from "../tools/watch-event-tool.js";

export interface EventSubscription {
	id: string; // `${contractId}:${eventName}`
	contractId: string;
	eventName: string;
	responseMethodName: string;
	cronExpression: string;
	session: MCPSession;
	cronJob?: cron.ScheduledTask;
	isActive: boolean;
	createdAt: number;
	lastEventAt?: number;
}

export interface SubscriptionConfig {
	contractId: string;
	eventName: string;
	responseMethodName: string;
	cronExpression: string;
	session: MCPSession;
}

export class SubscriptionManager {
	private static instance: SubscriptionManager;
	private subscriptions = new Map<string, EventSubscription>();
	private readonly DEFAULT_CRON_EXPRESSION = "*/10 * * * * *";
	private readonly DEFAULT_RESPONSE_METHOD = "agent_response";

	private constructor() {}

	/**
	 * Get singleton instance of SubscriptionManager
	 */
	public static getInstance(): SubscriptionManager {
		if (!SubscriptionManager.instance) {
			SubscriptionManager.instance = new SubscriptionManager();
		}
		return SubscriptionManager.instance;
	}

	/**
	 * Subscribe to a new event
	 */
	public subscribe(config: SubscriptionConfig): EventSubscription {
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
			responseMethodName:
				config.responseMethodName || this.DEFAULT_RESPONSE_METHOD,
			cronExpression: config.cronExpression || this.DEFAULT_CRON_EXPRESSION,
			session: config.session,
			isActive: true,
			createdAt: Date.now(),
		};

		this.subscriptions.set(subscriptionId, subscription);

		console.log(
			`📝 Subscribed to event '${config.eventName}' on contract '${config.contractId}'`,
		);

		return subscription;
	}

	/**
	 * Unsubscribe from an event
	 */
	public unsubscribe(contractId: string, eventName: string): boolean {
		const subscriptionId = this.generateSubscriptionId(contractId, eventName);
		const subscription = this.subscriptions.get(subscriptionId);

		if (!subscription) {
			return false;
		}

		// Stop the cron job if it exists
		if (subscription.cronJob) {
			subscription.cronJob.stop();
			subscription.cronJob.destroy();
		}

		this.subscriptions.delete(subscriptionId);

		console.log(
			`🗑️ Unsubscribed from event '${eventName}' on contract '${contractId}'`,
		);

		return true;
	}

	/**
	 * Check if a subscription exists
	 */
	public hasSubscription(contractId: string, eventName: string): boolean {
		const subscriptionId = this.generateSubscriptionId(contractId, eventName);
		return this.subscriptions.has(subscriptionId);
	}

	/**
	 * Get a specific subscription
	 */
	public getSubscription(
		contractId: string,
		eventName: string,
	): EventSubscription | undefined {
		const subscriptionId = this.generateSubscriptionId(contractId, eventName);
		return this.subscriptions.get(subscriptionId);
	}

	/**
	 * Get all active subscriptions
	 */
	public getActiveSubscriptions(): EventSubscription[] {
		return Array.from(this.subscriptions.values()).filter(
			(sub) => sub.isActive,
		);
	}

	/**
	 * Get all subscriptions for a specific contract
	 */
	public getSubscriptionsByContract(contractId: string): EventSubscription[] {
		return Array.from(this.subscriptions.values()).filter(
			(sub) => sub.contractId === contractId && sub.isActive,
		);
	}

	/**
	 * Update subscription's cron job
	 */
	public updateCronJob(
		contractId: string,
		eventName: string,
		cronJob: cron.ScheduledTask,
	): boolean {
		const subscription = this.getSubscription(contractId, eventName);
		if (!subscription) {
			return false;
		}

		// Stop existing cron job if it exists
		if (subscription.cronJob) {
			subscription.cronJob.stop();
			subscription.cronJob.destroy();
		}

		subscription.cronJob = cronJob;
		return true;
	}

	/**
	 * Mark subscription as having received an event
	 */
	public markEventReceived(contractId: string, eventName: string): void {
		const subscription = this.getSubscription(contractId, eventName);
		if (subscription) {
			subscription.lastEventAt = Date.now();
		}
	}

	/**
	 * Pause a subscription (keeps it in memory but marks as inactive)
	 */
	public pauseSubscription(contractId: string, eventName: string): boolean {
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

	/**
	 * Resume a paused subscription
	 */
	public resumeSubscription(contractId: string, eventName: string): boolean {
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

	/**
	 * Get subscription statistics
	 */
	public getStats() {
		const allSubs = Array.from(this.subscriptions.values());
		const activeSubs = allSubs.filter((sub) => sub.isActive);
		const contractCounts = new Map<string, number>();

		for (const sub of allSubs) {
			contractCounts.set(
				sub.contractId,
				(contractCounts.get(sub.contractId) || 0) + 1,
			);
		}

		return {
			total: allSubs.length,
			active: activeSubs.length,
			paused: allSubs.length - activeSubs.length,
			contractCounts: Object.fromEntries(contractCounts),
			oldestSubscription:
				allSubs.length > 0
					? Math.min(...allSubs.map((s) => s.createdAt))
					: null,
		};
	}
	/**
	 * Clean up all subscriptions (useful for shutdown)
	 */
	public cleanup(): void {
		console.log(`🧹 Cleaning up ${this.subscriptions.size} subscriptions...`);

		for (const subscription of this.subscriptions.values()) {
			if (subscription.cronJob) {
				subscription.cronJob.stop();
				subscription.cronJob.destroy();
			}
		}

		this.subscriptions.clear();
		console.log("✅ All subscriptions cleaned up");
	}

	/**
	 * Generate a unique subscription ID
	 */
	private generateSubscriptionId(
		contractId: string,
		eventName: string,
	): string {
		return `${contractId}:${eventName}`;
	}

	/**
	 * Get all subscription IDs (useful for debugging)
	 */
	public getSubscriptionIds(): string[] {
		return Array.from(this.subscriptions.keys());
	}
}

// Export singleton instance
export const subscriptionManager = SubscriptionManager.getInstance();
