import { Server } from "@modelcontextprotocol/sdk/dist/server/index.js";
import type { z } from "zod";

export type AgentEvent = {
	eventType: string;
	requestId: string;
	payload: any;
	sender: string;
	timestamp: number;
};

// Define a local Tool type compatible with the MCP server
export interface Tool<P = any, S extends z.ZodTypeAny = z.ZodTypeAny> {
	name: string;
	description: string;
	parameters: S;
	execute: (params: z.infer<S>, context: { server: Server }) => Promise<string>;
}
