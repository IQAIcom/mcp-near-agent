import {
	type Account,
	type ConnectConfig,
	KeyPair,
	connect,
	keyStores,
} from "near-api-js";
import { env } from "../env.js";

export class AuthManager {
	private static instance: AuthManager;
	private account: Account | null = null;
	private isInitialized = false;

	private constructor() {}

	public static getInstance(): AuthManager {
		if (!AuthManager.instance) {
			AuthManager.instance = new AuthManager();
		}
		return AuthManager.instance;
	}

	public async initialize(): Promise<Account> {
		if (this.isInitialized && this.account) {
			return this.account;
		}

		console.log("🔑 Initializing NEAR account connection...");

		try {
			const keyStore = new keyStores.InMemoryKeyStore();
			const keyPair = KeyPair.fromString(env.ACCOUNT_KEY);

			await keyStore.setKey(env.NEAR_NETWORK_ID, env.ACCOUNT_ID, keyPair);

			const connectConfig: ConnectConfig = {
				networkId: env.NEAR_NETWORK_ID,
				nodeUrl: env.NEAR_NODE_URL,
				keyStore,
			};

			const near = await connect(connectConfig);
			this.account = await near.account(env.ACCOUNT_ID);
			this.isInitialized = true;

			console.log(`✅ NEAR account initialized: ${env.ACCOUNT_ID}`);
			return this.account;
		} catch (error) {
			console.error("❌ Failed to initialize NEAR account:", error);
			throw new Error(
				`NEAR account initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	public getAccount(): Account | null {
		return this.account;
	}

	public isReady(): boolean {
		return this.isInitialized && this.account !== null;
	}

	public async validateConnection(): Promise<boolean> {
		if (!this.account) return false;

		try {
			await this.account.state();
			return true;
		} catch {
			return false;
		}
	}

	public reset(): void {
		this.account = null;
		this.isInitialized = false;
		console.log("🔄 AuthManager reset");
	}

	public getStatus() {
		return {
			isInitialized: this.isInitialized,
			hasAccount: this.account !== null,
			accountId: this.account ? env.ACCOUNT_ID : null,
			networkId: env.NEAR_NETWORK_ID,
		};
	}
}
