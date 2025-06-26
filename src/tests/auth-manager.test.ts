import { Account, KeyPairSigner } from "near-api-js";
import { JsonRpcProvider } from "near-api-js/lib/providers/json-rpc-provider.js";
import { env } from "../env.js";
import { AuthManager } from "../services/auth-manager.js";

// Mock near-api-js classes
jest.mock("near-api-js", () => ({
	Account: jest.fn().mockImplementation(function (this: any) {
		this.accountId = "mockAccountId";
		return this;
	}),
	KeyPairSigner: {
		fromSecretKey: jest.fn(),
	},
}));

jest.mock("near-api-js/lib/providers/json-rpc-provider.js", () => ({
	JsonRpcProvider: jest.fn().mockImplementation(function (this: any) {
		return this;
	}),
}));

// Mock the env module
jest.mock("../env.js", () => ({
	env: {
		NEAR_NETWORK_ID: "testnet",
		ACCOUNT_ID: "test.near",
		ACCOUNT_KEY:
			"ed25519:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
	},
}));

describe("AuthManager", () => {
	let authManager: AuthManager;
	let consoleLogSpy: jest.SpyInstance;
	let consoleErrorSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.clearAllMocks();
		(AuthManager as any).instance = null;
		authManager = AuthManager.getInstance();
		consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
		(KeyPairSigner.fromSecretKey as jest.Mock).mockReturnValue({});
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});

	describe("getInstance", () => {
		it("should return a singleton instance of AuthManager", () => {
			const instance1 = AuthManager.getInstance();
			const instance2 = AuthManager.getInstance();
			expect(instance1).toBe(instance2);
		});
	});

	describe("initialize", () => {
		it("should initialize the NEAR account successfully", async () => {
			const result = await authManager.initialize();

			expect(KeyPairSigner.fromSecretKey).toHaveBeenCalledTimes(1);
			expect(KeyPairSigner.fromSecretKey).toHaveBeenCalledWith(env.ACCOUNT_KEY);

			expect(JsonRpcProvider).toHaveBeenCalledTimes(1);
			expect(JsonRpcProvider).toHaveBeenCalledWith({
				url: env.NEAR_NODE_URL,
			});

			expect(Account).toHaveBeenCalledTimes(1);
			expect(Account).toHaveBeenCalledWith(
				env.ACCOUNT_ID,
				expect.any(Object),
				expect.any(Object),
			);
			expect(result.accountId).toBe("mockAccountId");
			expect(authManager.getAccount()?.accountId).toBe("mockAccountId");
			expect(consoleLogSpy).toHaveBeenCalledWith(
				"🔑 Initializing NEAR account connection...",
			);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				`✅ NEAR account initialized: ${env.ACCOUNT_ID}`,
			);
		});

		it("should return the existing account if already initialized", async () => {
			await authManager.initialize();
			jest.clearAllMocks();
			consoleLogSpy.mockClear();
			const result = await authManager.initialize();
			expect(Account).not.toHaveBeenCalled();
			expect(KeyPairSigner.fromSecretKey).not.toHaveBeenCalled();
			expect(JsonRpcProvider).not.toHaveBeenCalled();
			expect(result).toBe(authManager.getAccount());
			expect(authManager.getAccount()?.accountId).toBe("mockAccountId");
			expect(consoleLogSpy).not.toHaveBeenCalledWith(
				"🔑 Initializing NEAR account connection...",
			);
		});

		it("should throw an error if initialization fails (e.g., invalid key)", async () => {
			const errorMessage = "Invalid secret key format";
			(KeyPairSigner.fromSecretKey as jest.Mock).mockImplementationOnce(() => {
				throw new Error(errorMessage);
			});

			await expect(authManager.initialize()).rejects.toThrow(
				`NEAR account initialization failed: ${errorMessage}`,
			);
			expect(authManager.getAccount()).toBeNull();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				"❌ Failed to initialize NEAR account:",
				expect.any(Error),
			);
		});

		it("should throw an error with 'Unknown error' for non-Error thrown objects", async () => {
			(KeyPairSigner.fromSecretKey as jest.Mock).mockImplementationOnce(() => {
				throw "Something went wrong!";
			});

			await expect(authManager.initialize()).rejects.toThrow(
				"NEAR account initialization failed: Unknown error",
			);
			expect(authManager.isReady()).toBe(false);
		});
	});

	describe("getAccount", () => {
		it("should return null if the account is not initialized", () => {
			expect(authManager.getAccount()).toBeNull();
		});

		it("should return the Account object if initialized", async () => {
			await authManager.initialize();
			expect(authManager.getAccount()?.accountId).toBe("mockAccountId");
		});
	});

	describe("isReady", () => {
		it("should return false if not initialized", () => {
			expect(authManager.isReady()).toBe(false);
		});

		it("should return true if initialized with an account", async () => {
			await authManager.initialize();
			expect(authManager.isReady()).toBe(true);
		});

		it("should return false if initialization failed", async () => {
			(KeyPairSigner.fromSecretKey as jest.Mock).mockImplementationOnce(() => {
				throw new Error("Initialization failed");
			});
			await expect(authManager.initialize()).rejects.toThrow();
			expect(authManager.isReady()).toBe(false);
		});
	});

	describe("validateConnection", () => {
		it("should return false if account is null", async () => {
			expect(await authManager.validateConnection()).toBe(false);
		});

		it("should return true if account exists", async () => {
			await authManager.initialize();
			expect(await authManager.validateConnection()).toBe(true);
		});
	});

	describe("reset", () => {
		it("should reset the account and initialization status", async () => {
			await authManager.initialize();
			expect(authManager.isReady()).toBe(true);
			expect(authManager.getAccount()).not.toBeNull();

			authManager.reset();

			expect(authManager.isReady()).toBe(false);
			expect(authManager.getAccount()).toBeNull();
			expect(consoleLogSpy).toHaveBeenCalledWith("🔄 AuthManager reset");
		});
	});

	describe("getStatus", () => {
		it("should return correct status when not initialized", () => {
			const status = authManager.getStatus();
			expect(status).toEqual({
				isInitialized: false,
				hasAccount: false,
				accountId: null,
				networkId: env.NEAR_NETWORK_ID,
			});
		});

		it("should return correct status when initialized", async () => {
			await authManager.initialize();

			const status = authManager.getStatus();
			expect(status).toEqual({
				isInitialized: true,
				hasAccount: true,
				accountId: env.ACCOUNT_ID,
				networkId: env.NEAR_NETWORK_ID,
			});
		});

		it("should return correct status after reset", async () => {
			await authManager.initialize();
			authManager.reset();

			const status = authManager.getStatus();
			expect(status).toEqual({
				isInitialized: false,
				hasAccount: false,
				accountId: null,
				networkId: env.NEAR_NETWORK_ID,
			});
		});
	});
});
