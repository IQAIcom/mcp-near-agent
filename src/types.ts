import type { FastMCPSession } from "fastmcp";
import type * as cron from "node-cron";

export type AgentEvent = {
	eventType: string;
	requestId: string;
	payload: any;
	sender: string;
	timestamp: number;
};

// Event Subscription related types
export interface EventSubscription {
	id: string; // `${contractId}:${eventName}`
	contractId: string;
	eventName: string;
	responseMethodName: string;
	cronExpression: string;
	session: FastMCPSession;
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
	session: FastMCPSession;
}

export interface WatchEventRequest {
	contractId: string;
	eventName: string;
	responseMethodName: string;
	cronExpression?: string;
	session: FastMCPSession;
}

// Block processing related types
export interface BlockProcessingState {
	lastBlockHeight: number;
	isProcessing: boolean;
	processedTransactionIds: Set<string>;
}

// Configuration types
export interface EventWatcherConfig {
	networkId?: string;
	nodeUrl?: string;
	gasLimit?: string;
}

// Statistics types
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

// Event definitions for EventWatcher
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
	"block:processed": [
		data: { blockHeight: number; subscriptionId: string; eventsFound: number },
	];
	"block:error": [
		data: { blockHeight: number; subscriptionId: string; error: unknown },
	];
	"stats:updated": [stats: EventWatcherStats];
}

// Event Processor related types
export interface ProcessingResult {
	success: boolean;
	response?: string;
	error?: string;
	requestId: string;
	subscription: EventSubscription;
	event: AgentEvent;
	processingTime: number;
}

export interface EventContext {
	subscription: EventSubscription;
	event: AgentEvent;
	account: any; // NEAR Account type
}

export interface ProcessingStats {
	totalProcessed: number;
	successful: number;
	failed: number;
	averageProcessingTime: number;
	successRate: number;
	currentQueueSize: number;
}

export interface EventProcessorEvents {
	"event:processed": [result: ProcessingResult];
	"event:processing-error": [result: ProcessingResult];
	"event:mcp-request": [context: EventContext];
	"event:mcp-response": [context: EventContext, response: any];
	"event:blockchain-response": [context: EventContext, txHash: string];
	"queue:added": [requestId: string, context: EventContext];
	"queue:removed": [requestId: string];
	"stats:updated": [stats: ProcessingStats];
}
