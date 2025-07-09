#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodError, z } from "zod/v4";
import { env } from "./env.js";
import { eventWatcher } from "./services/event-watcher.js";
import { listWatchingTool } from "./tools/list-watching-tool.js";
import { stopWatchingTool } from "./tools/stop-watching-tool.js";
import { watchEventTool } from "./tools/watch-event-tool.js";
import { Tool } from "./types.js";

if (env.DEBUG) {
	import("mcps-logger/console");
}

class NearMCPServer {
	private server: Server;
	private tools = new Map<string, Tool<any, any>>();
	constructor() {
		this.server = new Server({
			name: "Near Agent MCP Server",
			version: "0.0.1",
		});

		this.setupHandlers();
		this.registerTools();
		this.setupEventWatcher();
	}

	private setupHandlers() {
		// Handle list tools request
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: Array.from(this.tools.values()).map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: zodToJsonSchema(tool.parameters),
				})),
			};
		});

		// Handle call tool request
		this.server.setRequestHandler(
			CallToolRequestSchema,
			async (request: any) => {
				const tool = this.tools.get(request.params.name);
				if (!tool) {
					throw new Error(`Tool '${request.params.name}' not found`);
				}

				try {
					const args = tool.parameters.parse(request.params.arguments);
					const result = await tool.execute(args, {
						server: this.server,
					});

					return {
						content: [
							{
								type: "text",
								text: result,
							},
						],
					};
				} catch (error) {
					throw new Error(
						`Tool execution failed: ${error instanceof ZodError ? z.prettifyError(error) : String(error)}`,
					);
				}
			},
		);
	}

	private registerTools() {
		// Register all tools
		this.tools.set(watchEventTool.name, watchEventTool);
		this.tools.set(stopWatchingTool.name, stopWatchingTool);
		this.tools.set(listWatchingTool.name, listWatchingTool);
	}

	private setupEventWatcher() {
		// Pass the server instance to the event watcher for MCP message creation
		eventWatcher.setServer(this.server);
	}

	async start() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.log("✅ Near Agent MCP Server started successfully over stdio.");
		console.log("You can now connect to it using an MCP client.");
	}
}

async function main() {
	console.log("ℹ️ Initializing MCP Near Server...");

	const server = new NearMCPServer();
	await server.start();
}

main().catch((error) => {
	console.error("❌ An unexpected error occurred:", error);
	process.exit(1);
});
