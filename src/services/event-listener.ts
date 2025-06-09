import { EventEmitter } from "node:events";
import {
	type Account,
	type ConnectConfig,
	KeyPair,
	connect,
	keyStores,
} from "near-api-js";
import * as cron from "node-cron";
import { env } from "../env.js";
import type { AgentEvent } from "../types.js";
import type { EventSubscription } from "./subscription-manager.js";

export interface BlockProcessingState {
	lastBlockHeight: number;
	isProcessing: boolean;
	processedTransactionIds: Set<string>;
}

export interface EventListenerConfig {
	networkId?: string;
	nodeUrl?: string;
	gasLimit?: string;
}

// Type-safe event definitions
export interface EventListenerEvents {
	"event:found": [data: { event: AgentEvent; subscription: EventSubscription }];
	"event:error": [data: { subscription: EventSubscription; error: unknown }];
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
	"state:initialized": [subscriptionId: string];
}

export class EventListener extends EventEmitter<EventListenerEvents> {
	private static readonly BATCH_SIZE = 5;
	private static readonly POLL_DELAY = 500; // ms between batches

	private account: Account | null = null;
	private isInitialized = false;
	private processingStates = new Map<string, BlockProcessingState>();

	constructor(config: EventListenerConfig = {}) {
		super();
	}

	/**
	 * Initialize the NEAR connection
	 */
	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		console.log("🔑 Setting up NEAR connection for EventListener...");

		try {
			const keyStore = new keyStores.InMemoryKeyStore();
			const keyPair = KeyPair.fromString(env.ACCOUNT_KEY);

			await keyStore.setKey(env.NEAR_NETWORK_ID, env.ACCOUNT_ID, keyPair);

			const connectConfig: ConnectConfig = {
				networkId: env.NEAR_NETWORK_ID,
				nodeUrl: env.NEAR_NODE_URL,
				keyStore,
			};

			const near = await connect(connectConfig);
			this.account = await near.account(env.ACCOUNT_ID);
			this.isInitialized = true;

			console.log("✅ EventListener initialized successfully");
		} catch (error) {
			console.error("❌ Failed to initialize EventListener:", error);
			throw new Error(
				`EventListener initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	/**
	 * Start listening for events for a specific subscription
	 */
	public startListening(subscription: EventSubscription): cron.ScheduledTask {
		if (!this.isInitialized || !this.account) {
			throw new Error(
				"EventListener not initialized. Call initialize() first.",
			);
		}

		const subscriptionId = subscription.id;

		// Initialize processing state for this subscription
		if (!this.processingStates.has(subscriptionId)) {
			this.processingStates.set(subscriptionId, {
				lastBlockHeight: 0,
				isProcessing: false,
				processedTransactionIds: new Set<string>(),
			});
			this.emit("state:initialized", subscriptionId);
		}

		console.log(
			`🎯 Starting to listen for '${subscription.eventName}' events on contract '${subscription.contractId}'`,
		);

		const cronJob = cron.schedule(subscription.cronExpression, async () => {
			const state = this.processingStates.get(subscriptionId);
			if (!state || state.isProcessing) {
				return; // Skip if already processing
			}

			try {
				this.emit("polling:started", subscriptionId);
				const result = await this.pollEventsForSubscription(
					subscription,
					state,
				);
				this.emit("polling:completed", {
					subscriptionId,
					blocksProcessed: result.blocksProcessed,
					eventsFound: result.eventsFound,
				});
			} catch (error) {
				console.error(
					`❌ Error polling events for subscription ${subscriptionId}:`,
					error,
				);
				this.emit("event:error", { subscription, error });
			}
		});

		cronJob.start();
		return cronJob;
	}

	/**
	 * Stop listening for a specific subscription
	 */
	public stopListening(subscriptionId: string): void {
		this.processingStates.delete(subscriptionId);
		console.log(`🛑 Stopped listening for subscription: ${subscriptionId}`);
	}

	/**
	 * Poll for events for a specific subscription
	 */
	private async pollEventsForSubscription(
		subscription: EventSubscription,
		state: BlockProcessingState,
	): Promise<{ blocksProcessed: number; eventsFound: number }> {
		state.isProcessing = true;
		let blocksProcessed = 0;
		let eventsFound = 0;

		try {
			const currentBlock = await this.getCurrentBlock(state);
			if (!currentBlock) {
				return { blocksProcessed, eventsFound };
			}

			const currentHeight = currentBlock.header.height;
			const startHeight = state.lastBlockHeight + 1;

			if (startHeight > currentHeight) {
				return { blocksProcessed, eventsFound }; // No new blocks to process
			}

			console.log(
				`🔍 Processing blocks ${startHeight} to ${currentHeight} for ${subscription.eventName}`,
			);

			// Process blocks in batches
			for (
				let blockHeight = startHeight;
				blockHeight <= currentHeight;
				blockHeight += EventListener.BATCH_SIZE
			) {
				const endBatch = Math.min(
					blockHeight + EventListener.BATCH_SIZE - 1,
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
						setTimeout(resolve, EventListener.POLL_DELAY),
					);
				}
			}

			return { blocksProcessed, eventsFound };
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
				throw new Error("Account not initialized");
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
			throw new Error("Account not initialized");
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
			throw new Error("Account not initialized");
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
					// Skip this chunk if there's an error
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
						throw Error("Account not initialized");
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
	 * Get processing statistics
	 */
	public getStats() {
		const states = Array.from(this.processingStates.entries());
		return {
			isInitialized: this.isInitialized,
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
	 * Cleanup resources
	 */
	public cleanup(): void {
		console.log("🧹 Cleaning up EventListener...");
		this.processingStates.clear();
		this.removeAllListeners();
		this.isInitialized = false;
		this.account = null;
		console.log("✅ EventListener cleaned up");
	}
}
