import { EventEmitter } from "node:events";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import dedent from "dedent";
import type { Account } from "near-api-js";
import { env } from "../env.js";
import type { AgentEvent } from "../types.js";
import type { EventSubscription } from "./subscription-manager.js";

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
	account: Account;
}

// Type-safe event definitions
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

export interface ProcessingStats {
	totalProcessed: number;
	successful: number;
	failed: number;
	averageProcessingTime: number;
	successRate: number;
	currentQueueSize: number;
}

export class EventProcessor extends EventEmitter<EventProcessorEvents> {
	private static readonly DEFAULT_MAX_TOKENS = 1000;
	private static readonly DEFAULT_TIMEOUT = 2 * 60 * 1000; // 2 minutes

	private account: Account | null = null;
	private server: Server | null = null;
	private processingQueue = new Map<string, EventContext>();
	private processingStats = {
		totalProcessed: 0,
		successful: 0,
		failed: 0,
		averageProcessingTime: 0,
	};

	constructor(account?: Account, server?: Server) {
		super();
		this.account = account || null;
		this.server = server || null;
	}

	/**
	 * Set the NEAR account for blockchain interactions
	 */
	public setAccount(account: Account): void {
		this.account = account;
	}

	/**
	 * Set the MCP server for creating messages
	 */
	public setServer(server: Server): void {
		this.server = server;
	}

	/**
	 * Process an event by requesting sampling from MCP client and sending response to blockchain
	 */
	public async processEvent(context: EventContext): Promise<ProcessingResult> {
		const startTime = Date.now();
		const { event, subscription } = context;

		console.log(
			`🔄 Processing event '${event.eventType}' with request ID: ${event.requestId}`,
		);

		try {
			// Add to processing queue
			this.processingQueue.set(event.requestId, context);
			this.emit("queue:added", event.requestId, context);

			// Request sampling from MCP client
			this.emit("event:mcp-request", context);
			const mcpResponse = await this.requestMCPSampling(event, subscription);
			this.emit("event:mcp-response", context, mcpResponse);

			if (!mcpResponse || !mcpResponse.content?.text) {
				throw new Error("No valid response from MCP client");
			}

			// Send response back to blockchain
			const txHash = await this.sendBlockchainResponse(
				event.requestId,
				mcpResponse.content.text,
				subscription,
			);
			this.emit("event:blockchain-response", context, txHash);

			const processingTime = Date.now() - startTime;
			const result: ProcessingResult = {
				success: true,
				response: mcpResponse.content.text,
				requestId: event.requestId,
				subscription,
				event,
				processingTime,
			};

			this.updateStats(true, processingTime);
			this.emit("event:processed", result);

			console.log(
				`✅ Successfully processed event ${event.requestId} in ${processingTime}ms`,
			);

			return result;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";

			const result: ProcessingResult = {
				success: false,
				error: errorMessage,
				requestId: event.requestId,
				subscription,
				event,
				processingTime,
			};

			this.updateStats(false, processingTime);
			this.emit("event:processing-error", result);

			console.error(`❌ Failed to process event ${event.requestId}:`, error);

			return result;
		} finally {
			// Remove from processing queue
			this.processingQueue.delete(event.requestId);
			this.emit("queue:removed", event.requestId);
		}
	}

	/**
	 * Request sampling from MCP client using server.createMessage
	 */
	private async requestMCPSampling(
		event: AgentEvent,
		subscription: EventSubscription,
	): Promise<any> {
		if (!this.server) {
			throw new Error("MCP server not set. Call setServer() first.");
		}

		try {
			const eventContent = this.formatEventForSampling(event);

			console.log(`🤖 Requesting MCP sampling for event: ${event.eventType}`);

			const samplingRequest = {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: eventContent,
						},
					},
				],
				includeContext: "thisServer" as const,
				maxTokens: EventProcessor.DEFAULT_MAX_TOKENS,
			};

			// Set timeout for MCP request
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(
					() => reject(new Error("MCP sampling timeout")),
					EventProcessor.DEFAULT_TIMEOUT,
				);
			});

			const samplingPromise = this.server.createMessage(samplingRequest);

			const response = await Promise.race([samplingPromise, timeoutPromise]);

			console.log(`📝 Received MCP response for event: ${event.eventType}`);

			return response;
		} catch (error) {
			console.error("❌ Error requesting MCP sampling:", error);
			throw new Error(
				`MCP sampling failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	/**
	 * Format event data for MCP sampling
	 */
	private formatEventForSampling(event: AgentEvent): string {
		const eventInfo = {
			eventType: event.eventType,
			requestId: event.requestId,
			sender: event.sender,
			timestamp: new Date(event.timestamp).toISOString(),
			payload: event.payload,
		};

		return dedent`
			Please process the following NEAR blockchain event:

			Event Type: ${eventInfo.eventType}
			Request ID: ${eventInfo.requestId}
			Sender: ${eventInfo.sender}
			Timestamp: ${eventInfo.timestamp}

			Event Data:
			${JSON.stringify(eventInfo.payload, null, 2)}

			Please analyze this event and provide a concise response that can be sent back to the blockchain contract.`;
	}

	/**
	 * Send response back to the NEAR blockchain
	 */
	private async sendBlockchainResponse(
		requestId: string,
		response: string,
		subscription: EventSubscription,
	): Promise<string> {
		if (!this.account) {
			throw new Error("NEAR account not set. Call setAccount() first.");
		}

		try {
			console.log(
				`📤 Sending response to blockchain for request: ${requestId}`,
			);

			const result = await this.account.functionCall({
				contractId: subscription.contractId,
				methodName: subscription.responseMethodName,
				args: {
					data_id: requestId,
					response: response,
					timestamp: Date.now(),
				},
				gas: BigInt(env.NEAR_GAS_LIMIT || "300000000000000"),
			});

			const txHash = result.transaction.hash;
			console.log(
				`✅ Blockchain response sent successfully. Transaction: ${txHash}`,
			);

			return txHash;
		} catch (error) {
			console.error("❌ Error sending blockchain response:", error);
			throw new Error(
				`Blockchain response failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	/**
	 * Update processing statistics
	 */
	private updateStats(success: boolean, processingTime: number): void {
		this.processingStats.totalProcessed++;

		if (success) {
			this.processingStats.successful++;
		} else {
			this.processingStats.failed++;
		}

		// Update average processing time
		const totalTime =
			this.processingStats.averageProcessingTime *
				(this.processingStats.totalProcessed - 1) +
			processingTime;
		this.processingStats.averageProcessingTime =
			totalTime / this.processingStats.totalProcessed;

		// Emit stats update
		this.emit("stats:updated", this.getStats());
	}

	/**
	 * Get current processing queue status
	 */
	public getQueueStatus() {
		return {
			queueSize: this.processingQueue.size,
			processingItems: Array.from(this.processingQueue.entries()).map(
				([requestId, context]) => ({
					requestId,
					eventType: context.event.eventType,
					contractId: context.subscription.contractId,
					timestamp: context.event.timestamp,
				}),
			),
		};
	}

	/**
	 * Get processing statistics
	 */
	public getStats(): ProcessingStats {
		return {
			...this.processingStats,
			successRate:
				this.processingStats.totalProcessed > 0
					? (this.processingStats.successful /
							this.processingStats.totalProcessed) *
						100
					: 0,
			currentQueueSize: this.processingQueue.size,
		};
	}

	/**
	 * Check if a request is currently being processed
	 */
	public isProcessing(requestId: string): boolean {
		return this.processingQueue.has(requestId);
	}

	/**
	 * Get all currently processing request IDs
	 */
	public getProcessingRequestIds(): string[] {
		return Array.from(this.processingQueue.keys());
	}

	/**
	 * Cancel processing for a specific request (if still in queue)
	 */
	public cancelProcessing(requestId: string): boolean {
		if (this.processingQueue.has(requestId)) {
			this.processingQueue.delete(requestId);
			this.emit("queue:removed", requestId);
			console.log(`🚫 Cancelled processing for request: ${requestId}`);
			return true;
		}
		return false;
	}

	/**
	 * Reset statistics
	 */
	public resetStats(): void {
		this.processingStats = {
			totalProcessed: 0,
			successful: 0,
			failed: 0,
			averageProcessingTime: 0,
		};
		this.emit("stats:updated", this.getStats());
		console.log("📊 Processing statistics reset");
	}

	/**
	 * Cleanup resources
	 */
	public cleanup(): void {
		console.log("🧹 Cleaning up EventProcessor...");
		this.processingQueue.clear();
		this.removeAllListeners();
		this.account = null;
		this.server = null;
		console.log("✅ EventProcessor cleaned up");
	}

	// Type-safe event listener methods
	// Type-safe event listener methods
	public on<K extends keyof EventProcessorEvents>(
		event: K,
		listener: (...args: EventProcessorEvents[K]) => void,
	): this {
		return super.on(event, listener as any);
	}

	public emit<K extends keyof EventProcessorEvents>(
		event: K,
		...args: EventProcessorEvents[K]
	): boolean {
		return super.emit(event, ...(args as any));
	}

	public off<K extends keyof EventProcessorEvents>(
		event: K,
		listener: (...args: EventProcessorEvents[K]) => void,
	): this {
		return super.off(event, listener as any);
	}

	public once<K extends keyof EventProcessorEvents>(
		event: K,
		listener: (...args: EventProcessorEvents[K]) => void,
	): this {
		return super.once(event, listener as any);
	}
}
