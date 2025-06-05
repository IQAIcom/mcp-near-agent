import { NearAgent } from "../services/near-agent.js";
import type { NearAgentConfig } from "../types.js";

export const nearAgentTool: any = {
	name: "Near Agent",
	description:
		"Near Agent is a tool that allows you to interact with the Near network.",
	execute: async (opts: NearAgentConfig) => {
		try {
			const nearAgent = new NearAgent(opts);
			await nearAgent.initialize();
			return nearAgent;
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: "An unknown error occurred while fetching user's agent positions.";
			console.error(`[NEAR_AGENT] Error: ${message}`);
			throw new Error(message);
		}
	},
};
