import dedent from "dedent";
import z from "zod";
import { eventWatcher } from "../services/event-watcher.js";
import { Tool } from "../types.js";

const listWatchingSchema = z.object({
	includeStats: z.boolean().optional().describe("Include detailed statistics"),
});

export const listWatchingTool: Tool<
	Record<string, unknown> | undefined,
	typeof listWatchingSchema
> = {
	name: "list_watched_near_events",
	description: "List all currently watched NEAR events and their status",
	parameters: listWatchingSchema,
	execute: async (params) => {
		try {
			const { includeStats = false } = params;

			const status = eventWatcher.getWatchingStatus();
			const stats = includeStats ? eventWatcher.getStats() : null;

			if (!status.isInitialized) {
				return "⚠️ EventWatcher not initialized yet. Start watching an event first using watch_near_event.";
			}

			if (status.totalSubscriptions === 0) {
				return dedent`
					📭 No events are currently being watched.

					🚀 To start watching events, use the watch_near_event tool with:
					• contractId: The NEAR contract to monitor
					• eventName: The specific event to watch for
					• responseMethodName: The contract method to call with responses`;
			}

			let output = dedent`
				📊 NEAR Event Watching Status

				🔧 System Status: ${status.isInitialized ? "🟢 Initialized" : "🔴 Not Initialized"}
				📈 Total Subscriptions: ${status.totalSubscriptions}

				📋 Active Subscriptions:`;

			status.subscriptions.forEach((sub, index) => {
				const statusIcon = sub.isActive ? "🟢" : "🔴";
				const lastEvent = sub.lastEventAt
					? new Date(sub.lastEventAt).toLocaleString()
					: "Never";

				output += `\n\n${index + 1}. ${statusIcon} ${sub.eventName} on ${sub.contractId}
   • Response Method: ${sub.responseMethodName}
   • Polling: ${sub.cronExpression}
   • Created: ${new Date(sub.createdAt).toLocaleString()}
   • Last Event: ${lastEvent}
   • ID: ${sub.id}`;
			});

			if (includeStats && stats) {
				output += `\n\n📊 Performance Statistics:
🎯 Events Detected: ${stats.totalEventsDetected}
⚡ Events Processed: ${stats.totalEventsProcessed}
✅ Success Rate: ${stats.successRate.toFixed(1)}%
⏱️ Avg Processing Time: ${stats.averageProcessingTime.toFixed(0)}ms
🕐 Uptime: ${Math.floor(stats.uptime / 1000 / 60)} minutes`;
			}

			output += `\n\n💡 Management Commands:
• Use stop_watching_near_event to stop specific subscriptions
• Use watch_near_event to add new event monitoring`;

			return output;
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: "An unknown error occurred while listing watched events.";

			console.error(`[LIST_WATCHING_TOOL] Error: ${message}`);

			return dedent`
				❌ Failed to list watched events: ${message}

				🔧 This might be a temporary issue. Please try again.`;
		}
	},
};
