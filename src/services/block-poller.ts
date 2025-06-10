import { EventEmitter } from "node:events";
import type { Account } from "near-api-js";
import { env } from "../env.js";
import type {
	AgentEvent,
	BlockProcessingState,
	EventSubscription,
} from "../types.js";

// Type-safe event definitions for BlockPoller
export interface BlockPollerEvents {
	"event:found": [data: { event: AgentEvent; subscription: EventSubscription }];
	"block:processed": [
		data: { blockHeight: number; subscriptionId: string; eventsFound: number },
	];
	"block:error": [
		data: { blockHeight: number; subscriptionId: string; error: unknown },
	];
	"polling:started": [subscriptionId: string];
	"polling:completed": [
		data: {
			subscriptionId: string;
			blocksProcessed: number;
			eventsFound: number;
		},
	];
}

/**
 * Handles blockchain polling and event detection.
 * Single responsibility: Poll NEAR blocks and extract matching events.
 * Emits events when found, manages block processing state per subscription.
 */
export class BlockPoller extends EventEmitter<BlockPollerEvents> {
	private static readonly BATCH_SIZE = 5;
	private static readonly POLL_DELAY = 500; // ms between batches

	private account: Account | null = null;
	private processingStates = new Map<string, BlockProcessingState>();

	/**
	 * Set the NEAR account for blockchain interactions
	 */
	public setAccount(account: Account): void {
		this.account = account;
	}

	/**
	 * Initialize processing state for a subscription
	 */
	public initializeSubscription(subscriptionId: string): void {
		if (!this.processingStates.has(subscriptionId)) {
			this.processingStates.set(subscriptionId, {
				lastBlockHeight: 0,
				isProcessing: false,
				processedTransactionIds: new Set<string>(),
			});
			console.log(
				`📍 Initialized processing state for subscription: ${subscriptionId}`,
			);
		}
	}

	/**
	 * Poll for events for a specific subscription
	 */
	public async pollForEvents(subscription: EventSubscription): Promise<{
		blocksProcessed: number;
		eventsFound: number;
	}> {
		if (!this.account) {
			throw new Error("BlockPoller account not set. Call setAccount() first.");
		}

		const state = this.processingStates.get(subscription.id);
		if (!state) {
			throw new Error(
				`Subscription ${subscription.id} not initialized. Call initializeSubscription() first.`,
			);
		}

		if (state.isProcessing) {
			console.log(
				`⏳ Subscription ${subscription.id} already processing, skipping...`,
			);
			return { blocksProcessed: 0, eventsFound: 0 };
		}

		state.isProcessing = true;
		let blocksProcessed = 0;
		let eventsFound = 0;

		try {
			this.emit("polling:started", subscription.id);

			const currentBlock = await this.getCurrentBlock(state);
			if (!currentBlock) {
				return { blocksProcessed, eventsFound };
			}

			const currentHeight = currentBlock.header.height;
			const startHeight = state.lastBlockHeight + 1;

			if (startHeight > currentHeight) {
				return { blocksProcessed, eventsFound }; // No new blocks
			}

			console.log(
				`🔍 Processing blocks ${startHeight} to ${currentHeight} for ${subscription.eventName}`,
			);

			// Process blocks in batches
			for (
				let blockHeight = startHeight;
				blockHeight <= currentHeight;
				blockHeight += BlockPoller.BATCH_SIZE
			) {
				const endBatch = Math.min(
					blockHeight + BlockPoller.BATCH_SIZE - 1,
					currentHeight,
				);

				const promises = [];
				for (let height = blockHeight; height <= endBatch; height++) {
					promises.push(this.processBlock(height, subscription, state));
				}

				const results = await Promise.all(promises);
				const batchEventsFound = results.reduce(
					(sum, result) => sum + result.eventsFound,
					0,
				);

				blocksProcessed += endBatch - blockHeight + 1;
				eventsFound += batchEventsFound;
				state.lastBlockHeight = endBatch;

				// Add delay between batches to avoid overwhelming the RPC
				if (endBatch < currentHeight) {
					await new Promise((resolve) =>
						setTimeout(resolve, BlockPoller.POLL_DELAY),
					);
				}
			}

			this.emit("polling:completed", {
				subscriptionId: subscription.id,
				blocksProcessed,
				eventsFound,
			});

			return { blocksProcessed, eventsFound };
		} catch (error) {
			console.error(
				`❌ Error polling for subscription ${subscription.id}:`,
				error,
			);
			throw error;
		} finally {
			state.isProcessing = false;
		}
	}

	/**
	 * Process a single block for events
	 */
	private async processBlock(
		blockHeight: number,
		subscription: EventSubscription,
		state: BlockProcessingState,
	): Promise<{ eventsFound: number }> {
		let eventsFound = 0;

		try {
			if (!this.account) {
				throw new Error("Account not available");
			}

			const block = await this.account.provider.viewBlock({
				blockId: blockHeight,
			});

			const relevantReceipts = await this.getRelevantReceipts(
				block,
				subscription.contractId,
			);

			if (relevantReceipts.length > 0) {
				eventsFound = await this.processReceipts(
					relevantReceipts,
					subscription,
					state,
				);
			}

			this.emit("block:processed", {
				blockHeight,
				subscriptionId: subscription.id,
				eventsFound,
			});

			return { eventsFound };
		} catch (error) {
			console.error(`❌ Error processing block ${blockHeight}:`, error);
			this.emit("block:error", {
				blockHeight,
				subscriptionId: subscription.id,
				error,
			});
			return { eventsFound: 0 };
		}
	}

	/**
	 * Get the current block and initialize lastBlockHeight if needed
	 */
	private async getCurrentBlock(state: BlockProcessingState): Promise<any> {
		if (!this.account) {
			throw new Error("Account not available");
		}

		const currentBlock = await this.account.provider.viewBlock({
			finality: "final",
		});

		// Initialize lastBlockHeight to previous block on first run
		if (state.lastBlockHeight === 0) {
			state.lastBlockHeight = currentBlock.header.height - 1;
			console.log(`📍 Initialized block height to ${state.lastBlockHeight}`);
		}

		return currentBlock;
	}

	/**
	 * Get relevant receipts for a contract from a block
	 */
	private async getRelevantReceipts(
		block: any,
		contractId: string,
	): Promise<any[]> {
		if (!this.account) {
			throw new Error("Account not available");
		}

		const relevantReceipts = [];

		try {
			const blockDetails = await this.account.provider.viewBlock({
				blockId: block.header.height,
			});

			for (const chunk of blockDetails.chunks) {
				try {
					const chunkDetails = await this.account.provider.viewChunk(
						chunk.chunk_hash,
					);

					for (const receipt of chunkDetails.receipts) {
						if (receipt.receiver_id === contractId) {
							relevantReceipts.push({
								data: receipt,
								receiver_id: receipt.receiver_id,
								receipt_id: receipt.receipt_id,
								predecessor_id: receipt.predecessor_id,
								block_height: block.header.height,
							});
						}
					}
				} catch (chunkError) {
					console.warn(
						`⚠️ Error processing chunk ${chunk.chunk_hash}:`,
						chunkError,
					);
				}
			}
		} catch (error) {
			console.error(
				`❌ Error getting receipts for block ${block.header.height}:`,
				error,
			);
		}

		return relevantReceipts;
	}

	/**
	 * Process receipts and extract events
	 */
	private async processReceipts(
		receipts: any[],
		subscription: EventSubscription,
		state: BlockProcessingState,
	): Promise<number> {
		let eventsFound = 0;

		for (const receipt of receipts) {
			try {
				const events = await this.extractEventsFromReceipt(
					receipt.data,
					subscription,
					state,
				);

				for (const event of events) {
					console.log(
						`🎉 Found event '${event.eventType}' for subscription ${subscription.id}`,
					);
					this.emit("event:found", { event, subscription });
					eventsFound++;
				}
			} catch (error) {
				console.error(
					`❌ Error processing receipt ${receipt.receipt_id}:`,
					error,
				);
			}
		}

		return eventsFound;
	}

	/**
	 * Extract events from a receipt using NearBlocks API
	 */
	private async extractEventsFromReceipt(
		receipt: any,
		subscription: EventSubscription,
		state: BlockProcessingState,
	): Promise<AgentEvent[]> {
		const events: AgentEvent[] = [];

		try {
			const apiUrl =
				env.NEAR_NETWORK_ID === "mainnet"
					? "https://api.nearblocks.io/v1/search"
					: "https://api-testnet.nearblocks.io/v1/search";

			const response = await fetch(`${apiUrl}?keyword=${receipt.receipt_id}`);

			if (!response.ok) {
				throw new Error(`NearBlocks API error: ${response.status}`);
			}

			const data = (await response.json()) as any;

			if (data.receipts && data.receipts.length > 0) {
				const txHash = data.receipts[0].originated_from_transaction_hash;

				if (txHash && !state.processedTransactionIds.has(txHash)) {
					state.processedTransactionIds.add(txHash);

					// Clean up old transaction IDs to prevent memory leaks
					if (state.processedTransactionIds.size > 10000) {
						const idsArray = Array.from(state.processedTransactionIds);
						const keepIds = idsArray.slice(-5000); // Keep last 5000
						state.processedTransactionIds = new Set(keepIds);
					}

					if (!this.account) {
						throw new Error("Account not available");
					}

					const txStatus = await this.account.provider.viewTransactionStatus(
						txHash,
						subscription.contractId,
						"INCLUDED",
					);

					for (const { outcome } of txStatus.receipts_outcome) {
						for (const log of outcome.logs) {
							const event = this.parseEventLog(
								log,
								subscription.eventName,
								receipt.predecessor_id,
							);
							if (event) {
								events.push(event);
							}
						}
					}
				}
			}
		} catch (error) {
			console.error("❌ Error extracting events from receipt:", error);
		}

		return events;
	}

	/**
	 * Parse an event log and return an AgentEvent if it matches
	 */
	private parseEventLog(
		log: string,
		eventName: string,
		signerId: string,
	): AgentEvent | null {
		try {
			if (log.startsWith("EVENT_JSON:")) {
				const jsonStr = log.slice("EVENT_JSON:".length);
				const eventData = JSON.parse(jsonStr);

				if (
					eventData.event === eventName &&
					Array.isArray(eventData.data) &&
					eventData.data.length > 0
				) {
					return {
						eventType: eventData.event,
						requestId: eventData.data[0].request_id,
						payload: eventData.data[0],
						sender: signerId,
						timestamp: Date.now(),
					};
				}
			}
		} catch (error) {
			console.error("❌ Error parsing event log:", error);
		}
		return null;
	}

	/**
	 * Remove processing state for a subscription
	 */
	public removeSubscription(subscriptionId: string): void {
		this.processingStates.delete(subscriptionId);
		console.log(
			`🗑️ Removed processing state for subscription: ${subscriptionId}`,
		);
	}

	/**
	 * Get processing statistics
	 */
	public getStats() {
		const states = Array.from(this.processingStates.entries());
		return {
			activeSubscriptions: states.length,
			processingStates: states.map(([id, state]) => ({
				subscriptionId: id,
				lastBlockHeight: state.lastBlockHeight,
				isProcessing: state.isProcessing,
				processedTransactionCount: state.processedTransactionIds.size,
			})),
		};
	}

	/**
	 * Check if a subscription is currently processing
	 */
	public isProcessing(subscriptionId: string): boolean {
		const state = this.processingStates.get(subscriptionId);
		return state ? state.isProcessing : false;
	}

	/**
	 * Cleanup resources
	 */
	public cleanup(): void {
		console.log("🧹 Cleaning up BlockPoller...");
		this.processingStates.clear();
		this.removeAllListeners();
		this.account = null;
		console.log("✅ BlockPoller cleaned up");
	}

	// Type-safe event listener methods
	public on<K extends keyof BlockPollerEvents>(
		event: K,
		listener: (...args: BlockPollerEvents[K]) => void,
	): this {
		return super.on(event, listener as any);
	}

	public emit<K extends keyof BlockPollerEvents>(
		event: K,
		...args: BlockPollerEvents[K]
	): boolean {
		return super.emit(event, ...(args as any));
	}

	public off<K extends keyof BlockPollerEvents>(
		event: K,
		listener: (...args: BlockPollerEvents[K]) => void,
	): this {
		return super.off(event, listener as any);
	}

	public once<K extends keyof BlockPollerEvents>(
		event: K,
		listener: (...args: BlockPollerEvents[K]) => void,
	): this {
		return super.once(event, listener as any);
	}
}
