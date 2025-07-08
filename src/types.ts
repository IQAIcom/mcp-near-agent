import type { z } from "zod";

export type AgentEvent = {
	eventType: string;
	requestId: string;
	payload: any;
	sender: string;
	timestamp: number;
};

// Define a generic MCP session type (opaque, but must have requestSampling for event-processor)
export type MCPSession = {
	id?: string;
	requestSampling?: (...args: any[]) => Promise<any>;
	[key: string]: any;
};

// Define a local Tool type compatible with the MCP server
export interface Tool<P = any, S extends z.ZodTypeAny = z.ZodTypeAny> {
	name: string;
	description: string;
	parameters: S;
	execute: (
		params: z.infer<S>,
		context: { session?: MCPSession },
	) => Promise<string>;
}
