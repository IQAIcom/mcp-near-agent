# 🌊 NEAR MCP Server

[![npm version](https://img.shields.io/npm/v/@iqai/mcp-near.svg)](https://www.npmjs.com/package/@iqai/mcp-near)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## 📖 Overview

The NEAR MCP Server enables AI agents to interact with the [NEAR Protocol](https://near.org) blockchain. This server provides smart contract interaction, transaction handling, and event listening capabilities with AI-driven processing.

By implementing the Model Context Protocol (MCP), this server allows Large Language Models (LLMs) to monitor blockchain events, process them with AI intelligence, and respond back to smart contracts, bridging the gap between AI and decentralized applications.

## ✨ Features

*   **Event Watching**: Monitor NEAR smart contracts for specific events in real-time.
*   **AI-Driven Processing**: Automatically process blockchain events with AI and send responses back to contracts.
*   **Subscription Management**: Manage multiple event subscriptions with detailed statistics.
*   **Flexible Configuration**: Customizable polling intervals, response methods, and network settings.

## 📦 Installation

### 🚀 Using npx (Recommended)

To use this server without installing it globally:

```bash
npx @iqai/mcp-near
```

### 🔧 Build from Source

```bash
git clone https://github.com/IQOfficial/mcp-near.git
cd mcp-near
pnpm install
pnpm run build
```

## ⚡ Running with an MCP Client

Add the following configuration to your MCP client settings (e.g., `claude_desktop_config.json`).

### 📋 Minimal Configuration

```json
{
  "mcpServers": {
    "near": {
      "command": "npx",
      "args": ["-y", "@iqai/mcp-near"],
      "env": {
        "ACCOUNT_ID": "your-account.near",
        "ACCOUNT_KEY": "ed25519:your_private_key_here"
      }
    }
  }
}
```

### ⚙️ Advanced Configuration (Local Build)

```json
{
  "mcpServers": {
    "near": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-near/dist/index.js"],
      "env": {
        "ACCOUNT_ID": "your-account.near",
        "ACCOUNT_KEY": "ed25519:your_private_key_here",
        "NEAR_NETWORK_ID": "mainnet",
        "NEAR_NODE_URL": "https://rpc.mainnet.near.org"
      }
    }
  }
}
```

## 🔐 Configuration (Environment Variables)

| Variable | Required | Description | Default |
| :--- | :--- | :--- | :--- |
| `ACCOUNT_ID` | Yes | Your NEAR account ID for authentication | - |
| `ACCOUNT_KEY` | Yes | Private key for your NEAR account (ed25519: or secp256k1: format) | - |
| `NEAR_NETWORK_ID` | No | NEAR network ("mainnet", "testnet", "betanet") | `mainnet` |
| `NEAR_NODE_URL` | No | Custom NEAR RPC endpoint | - |
| `NEAR_GAS_LIMIT` | No | Gas limit for transactions | - |

## 💡 Usage Examples

### 🔔 Event Watching
*   "Watch for 'run_agent' events on contract oracle.near"
*   "Start monitoring price_request events on my-contract.testnet"
*   "Set up a listener for transfer events with 5-second polling"

### 📊 Subscription Management
*   "List all my active event subscriptions"
*   "Show statistics for my event watchers"
*   "Stop watching events on contract oracle.near"

### 🤖 AI-Driven Workflows
*   "Process incoming oracle requests and respond with AI analysis"
*   "Monitor for user queries and provide intelligent responses"

## 🛠️ MCP Tools

<!-- AUTO-GENERATED TOOLS START -->

### `list_watched_near_events`
List all currently watched NEAR events and their status

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `includeStats` | boolean | No | Include detailed statistics |

### `stop_watching_near_event`
Stop watching for specific events on a NEAR contract

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `contractId` | string | Yes | NEAR contract ID to stop monitoring |
| `eventName` | string | Yes | Name of the event to stop watching |

### `watch_near_event`
Start watching for specific events on a NEAR contract and process them with AI responses

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `eventName` | string | Yes |  | Name of the NEAR event to watch for |
| `contractId` | string | Yes |  | NEAR contract ID to monitor |
| `responseMethodName` | string | No | "agent_response" | Contract method to call with the response (defaults to agent_response) |
| `responseParameterName` | string | No | "response" | Name of the parameter to pass to the response method (defaults to response) |
| `cronExpression` | string | No | "*/10 * * * * *" | Cron expression for polling frequency (default: every 10 seconds) |

<!-- AUTO-GENERATED TOOLS END -->

## 👨‍💻 Development

### 🏗️ Build Project
```bash
pnpm run build
```

### 👁️ Development Mode (Watch)
```bash
pnpm run watch
```

### ✅ Linting & Formatting
```bash
pnpm run lint
pnpm run format
```

### 🧪 Running Tests
```bash
pnpm test
```

### 📁 Project Structure
*   `src/tools/`: Individual tool definitions
*   `src/services/`: Event watcher, auth manager, and business logic
*   `src/types.ts`: TypeScript type definitions
*   `src/index.ts`: Server entry point

## 🔄 AI-Driven Event Processing Workflow

The server enables an "AI in the loop" workflow:

1. 🔗 Smart contract transaction triggers an event and pauses execution
2. 🤖 MCP server detects the event and requests AI processing from the client
3. 🧠 AI client processes the event data and provides intelligent response
4. ↩️ Server sends AI response back to blockchain via transaction
5. ✅ Original smart contract resumes with the AI-provided data

## 📚 Resources

*   [NEAR Protocol Documentation](https://docs.near.org)
*   [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
*   [NEAR JavaScript API](https://github.com/near/near-api-js)

## ⚠️ Disclaimer

This project interacts with the NEAR blockchain and requires private keys for transaction signing. Users should exercise caution, secure their credentials, and verify all transactions independently. Blockchain operations involve risk and may incur gas fees.

## 📄 License

[ISC](LICENSE)
