import { FastMCP } from "fastmcp";
import { listWatchingTool } from "./tools/list-watching-tool.js";
import { stopWatchingTool } from "./tools/stop-watching-tool.js";
import { watchEventTool } from "./tools/watch-event-tool.js";

async function main() {
	console.log("Initializing MCP Near Server...");

	const server = new FastMCP({
		name: "IQAI Near MCP Server",
		version: "0.0.1",
	});

	// Add all tools
	server.addTool(watchEventTool);
	server.addTool(stopWatchingTool);
	server.addTool(listWatchingTool);

	try {
		await server.start({
			transportType: "stdio",
		});
		console.log("✅ IQ Near MCP Server started successfully over stdio.");
		console.log("You can now connect to it using an MCP client.");
	} catch (error) {
		console.error("❌ Failed to start IQ Near MCP Server:", error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("❌ An unexpected error occurred:", error);
	process.exit(1);
});
