import { Account, KeyPairSigner } from "near-api-js";
import { JsonRpcProvider } from "near-api-js/lib/providers/json-rpc-provider.js";
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
			const signer = KeyPairSigner.fromSecretKey(env.ACCOUNT_KEY);
			const provider = new JsonRpcProvider({
				url: env.NEAR_NODE_URL,
			});
			this.account = new Account(env.ACCOUNT_ID, provider, signer);
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
		return true;
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
