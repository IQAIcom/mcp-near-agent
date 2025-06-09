import dedent from "dedent";
import type { FastMCPSession, Tool } from "fastmcp";
import z from "zod";
import { eventWatcher } from "../services/event-watcher.js";

const stopWatchingSchema = z.object({
	contractId: z.string().describe("NEAR contract ID to stop monitoring"),
	eventName: z.string().describe("Name of the event to stop watching"),
});

export const stopWatchingTool: Tool<
	Record<string, unknown> | undefined,
	typeof stopWatchingSchema
> = {
	name: "stop_watching_near_event",
	description: "Stop watching for specific events on a NEAR contract",
	execute: async (params) => {
		try {
			const { contractId, eventName } = params;

			console.log(
				`🛑 Stopping watch for '${eventName}' events on contract '${contractId}'`,
			);

			const success = await eventWatcher.stopWatching(contractId, eventName);

			if (success) {
				return dedent`
					🛑 Successfully stopped watching '${eventName}' events on contract '${contractId}'

					✅ The subscription has been terminated and no more events will be processed.
					📊 Use list_watched_near_events to see remaining active subscriptions.
				`;
			}

			return dedent`
				⚠️ No active subscription found for '${eventName}' on contract '${contractId}'

				💡 This could mean:
				• The event was never being watched
				• The subscription was already stopped
				• There might be a typo in the contract ID or event name

				📋 Use list_watched_near_events to see all active subscriptions.
			`;
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: "An unknown error occurred while stopping event watching.";

			console.error(`[STOP_WATCHING_TOOL] Error: ${message}`);

			return dedent`
				❌ Failed to stop watching events: ${message}

				🔧 Please try again or check the system logs for more details.
			`;
		}
	},
};
