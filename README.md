# MCP-Near: Model Context Protocol Server for NEAR Blockchain

This project implements a Model Context Protocol (MCP) server to interact with the NEAR blockchain. It allows MCP-compatible clients (like AI assistants, IDE extensions, or custom applications) to access NEAR functionalities such as viewing account information, sending transactions, and querying the blockchain state.

This server is built using TypeScript and `fastmcp`.

## Features (MCP Tools)

The server exposes the following tools that MCP clients can utilize:

- **`NEAR_GET_ACCOUNT_INFO`**: Fetch information for a specific NEAR account.
  - Parameters: `accountId` (string)
- **`NEAR_SEND_TRANSACTION`**: Send a transaction to the NEAR blockchain.
  - Parameters: `receiverId` (string), `actions` (string, JSON array of actions)
  - Requires `WALLET_PRIVATE_KEY` and `NEAR_ACCOUNT_ID` in the environment.
- **`NEAR_QUERY_STATE`**: Query the state of a NEAR contract.
  - Parameters: `contractId` (string), `methodName` (string), `args` (string, JSON object)
- **`NEAR_GET_BLOCK_HEIGHT`**: Get the current block height of the NEAR blockchain.
- **`NEAR_GET_BLOCK`**: Get a specific block from the NEAR blockchain.
  - Parameters: `blockId` (string or number)

## Prerequisites

- Node.js (v18 or newer recommended)
- pnpm (See <https://pnpm.io/installation>)

## Installation

There are a few ways to use `mcp-near`:

**1. Using `pnpm dlx` (Recommended for most MCP client setups):**

You can run the server directly using `pnpm dlx` without needing a global installation. This is often the easiest way to integrate with MCP clients. See the "Running the Server with an MCP Client" section for examples.
(`pnpm dlx` is pnpm's equivalent of `npx`)

**2. Global Installation from npm (via pnpm):**

Install the package globally to make the `mcp-near` command available system-wide:

```bash
pnpm add -g mcp-near
```

**3. Building from Source (for development or custom modifications):**

1.  **Clone the repository:**

    ```bash
    git clone <repository_url>
    cd mcp-near
    ```

2.  **Install dependencies:**

    ```bash
    pnpm install
    ```

3.  **Build the server:**
    This compiles the TypeScript code to JavaScript in the `dist` directory.

    ```bash
    pnpm run build
    ```

    The `prepare` script also runs `pnpm run build`, so dependencies are built upon installation if you clone and run `pnpm install`.

## Configuration (Environment Variables)

This MCP server requires certain environment variables to be set by the MCP client that runs it. These are typically configured in the client's MCP server definition (e.g., in a `mcp.json` file for Cursor, or similar for other clients).

- **`WALLET_PRIVATE_KEY`**: (Required for `NEAR_SEND_TRANSACTION`)
  - The private key of the wallet to be used for interacting with the NEAR blockchain (e.g., signing transactions).
  - **Security Note:** Handle this private key with extreme care. Ensure it is stored securely and only provided to trusted MCP client configurations.
- **`NEAR_ACCOUNT_ID`**: (Required for `NEAR_SEND_TRANSACTION`)
  - The NEAR account ID associated with the `WALLET_PRIVATE_KEY`.
- **`NEAR_NETWORK_ID`**: (Optional, defaults to "mainnet")
  - The NEAR network ID to connect to (e.g., "mainnet", "testnet", "betanet").
- **`NEAR_NODE_URL`**: (Optional, defaults to NEAR's public RPC endpoint)
  - The URL of the NEAR RPC node to connect to.

## Running the Server with an MCP Client

MCP clients (like AI assistants, IDE extensions, etc.) will run this server as a background process. You need to configure the client to tell it how to start your server.

Below is an example configuration snippet that an MCP client might use (e.g., in a `mcp_servers.json` or similar configuration file). This example shows how to run the server using the published npm package via `pnpm dlx`.

```json
{
  "mcpServers": {
    "iq-near-mcp-server": {
      "command": "pnpm",
      "args": ["dlx", "mcp-near"],
      "env": {
        "WALLET_PRIVATE_KEY": "your_wallet_private_key_here",
        "NEAR_ACCOUNT_ID": "your_near_account_id_here",
        "NEAR_NETWORK_ID": "mainnet"
      }
    }
  }
}
```

**Alternative if Globally Installed:**

If you have installed `mcp-near` globally (`pnpm add -g mcp-near`), you can simplify the `command` and `args`:

```json
{
  "mcpServers": {
    "iq-near-mcp-server": {
      "command": "mcp-near",
      "args": [],
      "env": {
        "WALLET_PRIVATE_KEY": "your_wallet_private_key_here",
        "NEAR_ACCOUNT_ID": "your_near_account_id_here",
        "NEAR_NETWORK_ID": "mainnet"
      }
    }
  }
}
```

- **`command`**: The executable to run.
  - For `pnpm dlx`: `"pnpm"` (with `"dlx"` as the first arg)
  - For global install: `"mcp-near"`
- **`args`**: An array of arguments to pass to the command.
  - For `pnpm dlx`: `["dlx", "mcp-near"]`
  - For global install: `[]`
- **`env`**: An object containing environment variables to be set when the server process starts. This is where you provide `WALLET_PRIVATE_KEY`, `NEAR_ACCOUNT_ID`, and `NEAR_NETWORK_ID`.
- **`workingDirectory`**: Generally not required when using the published package via `pnpm dlx` or a global install, as the package should handle its own paths correctly. If you were running from source (`node dist/index.js`), then setting `workingDirectory` to the project root would be important.
