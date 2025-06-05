import {
	type Account,
	type ConnectConfig,
	KeyPair,
	connect,
	keyStores,
} from "near-api-js";
import * as cron from "node-cron";
import type {
	AgentEvent,
	NearAgentConfig,
	NearEventListener,
} from "../types.js";

export class NearAgent {
	static serviceType = "transcription";
	private static readonly DEFAULT_NETWORK_ID = "mainnet";
	private static readonly DEFAULT_NODE_URL =
		"https://rpc.web4.near.page/account/near";
	private static readonly DEFAULT_GAS_LIMIT = "300000000000000";
	private static readonly DEFAULT_CRON_EXPRESSION = "*/10 * * * * *";
	private static readonly DEFAULT_RESPONSE_METHOD = "agent_response";
	private static readonly BATCH_SIZE = 5;

	private account: Account;
	private lastBlockHeight = 0;
	private isProcessing = false;
	private processedTransactionIds = new Set<string>();

	constructor(private readonly opts: NearAgentConfig) {}

	/**
	 * Initializes the NEAR Agent service by setting up the key store, connecting to the NEAR network, and scheduling event listeners with cron jobs.
	 *
	 * This method is called during the initialization of the NearAgent service. It performs the following steps:
	 * 1. Sets up an in-memory key store and adds the account key provided in the configuration.
	 * 2. Establishes a connection to the NEAR network using the provided network configuration or default values.
	 * 3. Retrieves the account object for the configured account ID.
	 * 4. Schedules event listeners with cron jobs using the configured listeners or default cron expression.
	 * 5. Logs information about the initialization process.
	 */
	async initialize() {
		console.log("🔑 Setting up key store and connecting to NEAR network");
		const keyStore = new keyStores.InMemoryKeyStore();
		const keyPair = KeyPair.fromString(this.opts.accountKey);
		await keyStore.setKey(
			this.opts.networkConfig?.networkId || NearAgent.DEFAULT_NETWORK_ID,
			this.opts.accountId,
			keyPair,
		);

		const config: ConnectConfig = {
			networkId:
				this.opts.networkConfig?.networkId || NearAgent.DEFAULT_NETWORK_ID,
			nodeUrl: this.opts.networkConfig?.nodeUrl || NearAgent.DEFAULT_NODE_URL,
			keyStore,
		};

		const near = await connect(config);

		this.account = await near.account(this.opts.accountId);

		for (const listener of this.opts.listeners) {
			cron.schedule(
				listener.cronExpression || NearAgent.DEFAULT_CRON_EXPRESSION,
				() => {
					if (!this.isProcessing) {
						this.pollEvents(listener);
					} else {
					}
				},
			);
		}
	}

	/**
	 * Polls for events from the NEAR network and processes them in batches.
	 * This method is responsible for the following:
	 * 1. Retrieving the current block height from the NEAR network.
	 * 2. Iterating through the blocks from the last processed block to the current block.
	 * 3. Processing each block in batches, calling `processBlock` for each batch.
	 * 4. Updating the `lastBlockHeight` to the last processed block.
	 * 5. Handling errors and logging the polling cycle status.
	 *
	 * @param listener - The `NearEventListener` instance to use for processing the events.
	 */
	private async pollEvents(listener: NearEventListener) {
		this.isProcessing = true;

		const currentBlock = await this.getCurrentBlock();
		if (!currentBlock) return;

		const currentHeight = currentBlock.header.height;
		const startHeight = this.lastBlockHeight + 1;

		for (
			let blockHeight = startHeight;
			blockHeight <= currentHeight;
			blockHeight += NearAgent.BATCH_SIZE
		) {
			const endBatch = Math.min(
				blockHeight + NearAgent.BATCH_SIZE - 1,
				currentHeight,
			);

			const promises = [];
			for (let height = blockHeight; height <= endBatch; height++) {
				promises.push(this.processBlock(height, listener));
			}

			await Promise.all(promises);

			this.lastBlockHeight = endBatch;

			if (endBatch < currentHeight) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}
		this.isProcessing = false;
	}

	/**
	 * Processes a block of NEAR network data, retrieving relevant receipts and processing them.
	 * @param blockHeight - The height of the block to process.
	 * @param listener - The NearEventListener instance to use for processing the receipts.
	 * @returns `true` if the block was processed successfully, `false` otherwise.
	 */

	private async processBlock(blockHeight: number, listener: NearEventListener) {
		try {
			const block = await this.account.provider.viewBlock({
				blockId: blockHeight,
			});

			const relevantItems = await this.getRelevantReceipts(
				block,
				listener.contractId,
			);

			if (relevantItems.length > 0) {
				await this.processItems(relevantItems, listener);
			}
			return true;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Retrieves the current block from the NEAR network.
	 * If this is the first time calling this method, it sets the `lastBlockHeight` to the previous block height.
	 * @returns The current block object.
	 */
	private async getCurrentBlock() {
		const currentBlock = await this.account.provider.viewBlock({
			finality: "final",
		});
		if (this.lastBlockHeight === 0) {
			this.lastBlockHeight = currentBlock.header.height - 1;
		}
		return currentBlock;
	}

	/**
	 * Retrieves the relevant receipts for a given block and contract ID.
	 * @param block - The block object to search for relevant receipts.
	 * @param contractId - The contract ID to filter the receipts by.
	 * @returns An array of relevant receipt objects.
	 */
	private async getRelevantReceipts(block: any, contractId: string) {
		const relevantReceipts = [];
		const blockDetails = await this.account.provider.viewBlock({
			blockId: block.header.height,
		});

		for (const chunk of blockDetails.chunks) {
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
					});
				}
			}
		}

		return relevantReceipts;
	}

	private async processItems(items: any[], listener: NearEventListener) {
		for (const item of items) {
			// Process all items or check for a different property
			const events = await this.extractEventsFromReceipt(item.data, listener);
			for (const event of events) {
				await this.handleEvent(event, listener);
			}
		}
	}

	/**
	 * Extracts events from a receipt using NearBlocks API to get the transaction hash
	 * @param receipt - The receipt object.
	 * @param listener - The listener object.
	 * @returns An array of events.
	 */
	private async extractEventsFromReceipt(
		receipt: any,
		listener: NearEventListener,
	) {
		const events = [];

		try {
			const networkId =
				this.opts.networkConfig?.networkId || NearAgent.DEFAULT_NETWORK_ID;
			const apiUrl =
				networkId === "mainnet"
					? "https://api.nearblocks.io/v1/search"
					: "https://api-testnet.nearblocks.io/v1/search";

			const response = await fetch(`${apiUrl}?keyword=${receipt.receipt_id}`);
			const data = (await response.json()) as any;

			if (data.receipts && data.receipts.length > 0) {
				const txHash = data.receipts[0].originated_from_transaction_hash;

				if (txHash && !this.processedTransactionIds.has(txHash)) {
					this.processedTransactionIds.add(txHash);
					// Get transaction details and extract logs
					const txStatus = await this.account.provider.viewTransactionStatus(
						txHash,
						listener.contractId,
						"INCLUDED",
					);

					for (const { outcome } of txStatus.receipts_outcome) {
						for (const log of outcome.logs) {
							const event = this.parseEventLog(
								log,
								listener.eventName,
								receipt.predecessor_id,
							);
							if (event) events.push(event);
						}
					}
				}
			}
		} catch (error) {}

		return events;
	}

	/**
	 * Parses an event log and returns an `AgentEvent` object if the log matches the specified event name.
	 *
	 * @param log - The log string to parse.
	 * @param eventName - The name of the event to look for.
	 * @param signerId - The ID of the signer of the event.
	 * @returns An `AgentEvent` object if the log matches the event name, or `null` if it does not.
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
		} catch (error) {}
		return null;
	}

	/**
	 * Handles an event received from the NEAR blockchain, processes it, and sends a response back to the contract.
	 *
	 * @param event - The `AgentEvent` object containing the event details.
	 * @param listener - The `NearEventListener` object that contains the event handler and other configuration.
	 * @returns - A Promise that resolves when the event has been processed and the response has been sent.
	 */
	private async handleEvent(event: AgentEvent, listener: NearEventListener) {
		try {
			const result = await listener.handler(event.payload, {
				account: this.account,
			});

			await this.sendResponse(event.requestId, result, listener);
		} catch (error) {}
	}

	/**
	 * Sends a response back to the NEAR contract after processing an event.
	 *
	 * @param requestId - The ID of the request that triggered the event.
	 * @param result - The result of processing the event.
	 * @param listener - The `NearEventListener` object that contains the event handler and other configuration.
	 * @returns - A Promise that resolves when the response has been sent.
	 */
	private async sendResponse(
		requestId: any,
		result: string,
		listener: NearEventListener,
	) {
		await this.account.functionCall({
			contractId: listener.contractId,
			methodName:
				listener.responseMethodName || NearAgent.DEFAULT_RESPONSE_METHOD,
			args: {
				data_id: requestId,
				amount_out: result,
			},
			gas: BigInt(this.opts.gasLimit || NearAgent.DEFAULT_GAS_LIMIT),
		});
	}
}
