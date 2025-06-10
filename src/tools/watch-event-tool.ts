import dedent from "dedent";
import type { FastMCPSession, Tool } from "fastmcp";
import {
	type Account,
	type ConnectConfig,
	KeyPair,
	connect,
	keyStores,
} from "near-api-js";
import z from "zod";
import { env } from "../env.js";
import { eventWatcher } from "../services/event-watcher.js";

const watchEventSchema = z.object({
	eventName: z.string().describe("Name of the NEAR event to watch for"),
	contractId: z.string().describe("NEAR contract ID to monitor"),
	responseMethodName: z
		.string()
		.describe("Contract method to call with the response"),
	cronExpression: z
		.string()
		.optional()
		.describe(
			"Cron expression for polling frequency (default: every 10 seconds)",
		),
});

export const watchEventTool: Tool<
	Record<string, unknown> | undefined,
	typeof watchEventSchema
> = {
	name: "watch_near_event",
	description:
		"Start watching for specific events on a NEAR contract and process them with AI responses",
	parameters: watchEventSchema,
	execute: async (params, { session }) => {
		try {
			const { eventName, contractId, responseMethodName, cronExpression } =
				params;

			console.log(
				`🎯 Starting to watch for '${eventName}' events on contract '${contractId}'`,
			);

			// Initialize EventWatcher if not already done
			if (!eventWatcher.getWatchingStatus().isInitialized) {
				const account = await initializeNearAccount();
				await eventWatcher.initialize(account);
			}

			// Check if already watching this event
			if (eventWatcher.isWatching(contractId, eventName)) {
				return `⚠️ Already watching event '${eventName}' on contract '${contractId}'. Use list_watched_near_events to see all active subscriptions.`;
			}

			// Start watching the event
			const subscriptionId = await eventWatcher.watchEvent({
				contractId,
				eventName,
				responseMethodName,
				cronExpression,
				session: session as unknown as FastMCPSession,
			});

			// Set up event listeners for this session
			setupEventListeners(subscriptionId);

			return dedent`
			🎯 Successfully started watching for '${eventName}' events!

			📋 Subscription Details:
			• Contract: ${contractId}
			• Event: ${eventName}
			• Response Method: ${responseMethodName}
			• Polling: ${cronExpression || "*/10 * * * * *"}
			• Subscription ID: ${subscriptionId}
			• Status: 🟢 Active

			🔔 The system will now monitor the blockchain and automatically process events with AI responses.`;
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: "An unknown error occurred while setting up event watching.";

			console.error(`[WATCH_EVENT_TOOL] Error: ${message}`);

			return dedent`
			❌ Failed to start watching events: ${message}

			💡 Troubleshooting tips:
			• Check if the contract ID is valid
			• Ensure the event name matches the contract's events
			• Verify your NEAR account has sufficient balance for gas fees`;
		}
	},
};

/**
 * Initialize NEAR account connection
 */
async function initializeNearAccount(): Promise<Account> {
	console.log("🔑 Initializing NEAR account connection...");

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
		const account = await near.account(env.ACCOUNT_ID);

		console.log(`✅ NEAR account initialized: ${env.ACCOUNT_ID}`);
		return account;
	} catch (error) {
		console.error("❌ Failed to initialize NEAR account:", error);
		throw new Error(
			`NEAR account initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Set up event listeners for real-time updates
 */
function setupEventListeners(subscriptionId: string): void {
	// Listen for events detected
	eventWatcher.on("event:detected", ({ event, subscription }) => {
		if (subscription.id === subscriptionId) {
			console.log(
				`🔔 Event detected for subscription ${subscriptionId}: ${event.eventType}`,
			);
			console.log(
				`📋 Request ID: ${event.requestId}, Contract: ${subscription.contractId}`,
			);
		}
	});

	// Listen for successful processing
	eventWatcher.on(
		"event:processed",
		({ requestId, response, processingTime }) => {
			console.log(
				`✅ Event ${requestId} processed successfully in ${processingTime}ms`,
			);
			console.log(
				`📝 Response: ${response.substring(0, 100)}${response.length > 100 ? "..." : ""}`,
			);
		},
	);

	// Listen for processing failures
	eventWatcher.on("event:failed", ({ requestId, error, processingTime }) => {
		console.error(
			`❌ Event ${requestId} processing failed after ${processingTime}ms: ${error}`,
		);
	});

	// Listen for watcher errors
	eventWatcher.on("watcher:error", ({ subscriptionId: errorSubId, error }) => {
		if (errorSubId === subscriptionId) {
			console.error(
				`❌ Watcher error for subscription ${subscriptionId}:`,
				error,
			);
		}
	});

	// Listen for watcher lifecycle events
	eventWatcher.on("watcher:started", (startedSubId) => {
		if (startedSubId === subscriptionId) {
			console.log(`🚀 Watcher started for subscription ${subscriptionId}`);
		}
	});

	eventWatcher.on("watcher:stopped", (stoppedSubId) => {
		if (stoppedSubId === subscriptionId) {
			console.log(`🛑 Watcher stopped for subscription ${subscriptionId}`);
		}
	});
}
