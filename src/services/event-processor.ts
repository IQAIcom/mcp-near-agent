import { EventEmitter } from "node:events";
import dedent from "dedent";
import type { Account } from "near-api-js";
import { env } from "../env.js";
import type {
	AgentEvent,
	EventContext,
	EventProcessorEvents,
	EventSubscription,
	ProcessingResult,
	ProcessingStats,
} from "../types.js";

/**
 * Handles event processing through MCP and blockchain responses.
 * Single responsibility: Process detected events by communicating with MCP and sending responses to blockchain.
 * No queue management, no orchestration - just pure event processing.
 */
export class EventProcessor extends EventEmitter<EventProcessorEvents> {
	private static readonly DEFAULT_MAX_TOKENS = 1000;
	private static readonly DEFAULT_TIMEOUT = 2 * 60 * 1000; // 2 minutes
	private static readonly DEFAULT_SYSTEM_PROMPT =
		"You are a helpful NEAR blockchain assistant. Process the following event data and provide a concise response.";

	private account: Account | null = null;
	private processingStats = {
		totalProcessed: 0,
		successful: 0,
		failed: 0,
		totalProcessingTime: 0,
	};

	/**
	 * Set the NEAR account for blockchain interactions
	 */
	public setAccount(account: Account): void {
		this.account = account;
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
		}
	}

	/**
	 * Request sampling from MCP client
	 */
	private async requestMCPSampling(
		event: AgentEvent,
		subscription: EventSubscription,
	): Promise<any> {
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
				systemPrompt: this.generateSystemPrompt(event, subscription),
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

			const samplingPromise =
				subscription.session.requestSampling(samplingRequest);

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
	 * Generate system prompt based on event and subscription
	 */
	private generateSystemPrompt(
		event: AgentEvent,
		subscription: EventSubscription,
	): string {
		return dedent`
			${EventProcessor.DEFAULT_SYSTEM_PROMPT}

			You are processing a '${event.eventType}' event from contract '${subscription.contractId}'.
			The response will be sent to the blockchain method '${subscription.responseMethodName}'.

			Guidelines:
			- Provide a clear, concise response
			- Focus on the key information from the event
			- Ensure the response is appropriate for blockchain storage
			- Keep responses under 500 characters when possible`;
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
		this.processingStats.totalProcessingTime += processingTime;

		if (success) {
			this.processingStats.successful++;
		} else {
			this.processingStats.failed++;
		}

		// Emit stats update
		this.emit("stats:updated", this.getStats());
	}

	/**
	 * Get processing statistics
	 */
	public getStats(): ProcessingStats {
		return {
			totalProcessed: this.processingStats.totalProcessed,
			successful: this.processingStats.successful,
			failed: this.processingStats.failed,
			averageProcessingTime:
				this.processingStats.totalProcessed > 0
					? this.processingStats.totalProcessingTime /
						this.processingStats.totalProcessed
					: 0,
			successRate:
				this.processingStats.totalProcessed > 0
					? (this.processingStats.successful /
							this.processingStats.totalProcessed) *
						100
					: 0,
			currentQueueSize: 0, // No queue in simplified version
		};
	}

	/**
	 * Reset statistics
	 */
	public resetStats(): void {
		this.processingStats = {
			totalProcessed: 0,
			successful: 0,
			failed: 0,
			totalProcessingTime: 0,
		};
		this.emit("stats:updated", this.getStats());
		console.log("📊 Processing statistics reset");
	}

	/**
	 * Cleanup resources
	 */
	public cleanup(): void {
		console.log("🧹 Cleaning up EventProcessor...");
		this.removeAllListeners();
		this.account = null;
		console.log("✅ EventProcessor cleaned up");
	}

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
