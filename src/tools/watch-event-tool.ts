import dedent from "dedent";
import z from "zod";
import { AuthManager } from "../services/auth-manager.js";
import { eventWatcher } from "../services/event-watcher.js";
import { Tool } from "../types.js";

const watchEventSchema = z.object({
	eventName: z.string().describe("Name of the NEAR event to watch for"),
	contractId: z.string().describe("NEAR contract ID to monitor"),
	responseMethodName: z
		.string()
		.default("agent_response")
		.describe(
			"Contract method to call with the response (defaults to agent_response)",
		),
	responseParameterName: z
		.string()
		.default("response")
		.describe(
			"Name of the parameter to pass to the response method (defaults to response)",
		),
	cronExpression: z
		.string()
		.default("*/10 * * * * *")
		.describe(
			"Cron expression for polling frequency (default: every 10 seconds)",
		),
});

// Get singleton instance of AuthManager for status reporting only
const authManager = AuthManager.getInstance();

export const watchEventTool: Tool<
	Record<string, unknown> | undefined,
	typeof watchEventSchema
> = {
	name: "watch_near_event",
	description:
		"Start watching for specific events on a NEAR contract and process them with AI responses",
	parameters: watchEventSchema,
	execute: async (params, { server }) => {
		try {
			const {
				eventName,
				contractId,
				responseMethodName,
				responseParameterName,
				cronExpression,
			} = params;

			console.log(
				`🎯 Starting to watch for '${eventName}' events on contract '${contractId}'}`,
			);

			// Check if already watching this event
			if (eventWatcher.isWatching(contractId, eventName)) {
				return `⚠️ Already watching event '${eventName}' on contract '${contractId}'. Use list_watched_near_events to see all active subscriptions.`;
			}

			// EventWatcher will handle all authentication internally
			const subscriptionId = await eventWatcher.watchEvent({
				contractId,
				eventName,
				responseMethodName,
				responseParameterName,
				cronExpression,
				server,
			});

			// Set up event listeners for this session
			setupEventListeners(subscriptionId);

			// Get auth status for response (AuthManager should be initialized by now)
			const authStatus = authManager.getStatus();

			return dedent`
			🎯 Successfully started watching for '${eventName}' events!

			📋 Subscription Details:
			• Contract: ${contractId}
			• Event: ${eventName}
			• Response Method: ${responseMethodName}
			• Response Parameter Name: ${responseParameterName}
			• Polling: ${cronExpression || "*/10 * * * * *"}
			• Subscription ID: ${subscriptionId}
			• Status: 🟢 Active

			🔐 Authentication Status:
			• Account: ${authStatus.accountId}
			• Network: ${authStatus.networkId}
			• Connection: ✅ Valid

			🔔 The system will now monitor the blockchain and automatically process events with AI responses.`;
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: "An unknown error occurred while setting up event watching.";

			console.error(`[WATCH_EVENT_TOOL] Error: ${message}`);

			// Get auth status for troubleshooting
			const authStatus = authManager.getStatus();

			return dedent`
			❌ Failed to start watching events: ${message}

			🔐 Authentication Status:
			• Initialized: ${authStatus.isInitialized ? "✅" : "❌"}
			• Account: ${authStatus.accountId || "Not available"}
			• Network: ${authStatus.networkId}

			💡 Troubleshooting tips:
			• Check if the contract ID is valid
			• Ensure the event name matches the contract's events
			• Verify your NEAR account has sufficient balance for gas fees
			• Check NEAR network connectivity
			• Validate environment variables (ACCOUNT_KEY, ACCOUNT_ID, etc.)`;
		}
	},
};

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

	// Listen for authentication issues
	eventWatcher.on("watcher:error", ({ subscriptionId: errorSubId, error }) => {
		if (errorSubId === subscriptionId) {
			// Check if it's an auth-related error
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			if (errorMessage.includes("account") || errorMessage.includes("auth")) {
				console.warn(
					"🔐 Authentication issue detected, attempting to reconnect...",
				);
				authManager.validateConnection().then((isValid) => {
					if (!isValid) {
						console.error("❌ Authentication validation failed");
					}
				});
			}
		}
	});
}
