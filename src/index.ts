import { FastMCP } from "fastmcp";
import { nearAgentTool } from "./tools/near-tool.js";

async function main() {
	console.log("Initializing MCP Near Server...");

	const server = new FastMCP({
		name: "IQAI Near MCP Server",
		version: "0.0.1",
	});

	server.addTool(nearAgentTool);

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
