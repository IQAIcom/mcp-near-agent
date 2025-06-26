import * as cron from "node-cron";
import { EventEmitter } from "node:events";
import { AuthManager } from "../services/auth-manager";
import { EventListener } from "../services/event-listener";

jest.mock("../services/auth-manager", () => {
	const mockAuthManagerInstance = {
		isReady: jest.fn(),
		initialize: jest.fn(),
		getAccount: jest.fn(),
		getStatus: jest.fn(),
	};
	return {
		AuthManager: {
			getInstance: jest.fn(() => mockAuthManagerInstance),
		},
	};
});

jest.mock("../env.js", () => ({
	env: {
		ACCOUNT_KEY: "mock_account_key",
		NEAR_NODE_URL: "http://mock-near-node.test",
		ACCOUNT_ID: "mock_account_id.near",
		NEAR_NETWORK_ID: "testnet",
	},
}));

let mockAuthManagerInstance: jest.Mocked<AuthManager>;

jest.mock("node-cron", () => ({
	schedule: jest.fn(() => ({
		start: jest.fn(),
		stop: jest.fn(),
		destroy: jest.fn(),
	})),
}));
const mockCronSchedule = cron.schedule as jest.Mock;

const mockProvider = {
	viewBlock: jest.fn(),
	viewChunk: jest.fn(),
	viewTransactionStatus: jest.fn(),
};

const mockAccount = {
	provider: mockProvider,
	connection: {
		networkId: "testnet",
	},
};

describe("EventListener", () => {
	let eventListener: EventListener;

	beforeEach(() => {
		jest.clearAllMocks();

		mockAuthManagerInstance =
			AuthManager.getInstance() as jest.Mocked<AuthManager>;

		mockAuthManagerInstance.isReady.mockReturnValue(true);
		mockAuthManagerInstance.getAccount.mockReturnValue(mockAccount as any);

		mockCronSchedule.mockImplementation(() => ({
			start: jest.fn(),
			stop: jest.fn(),
			destroy: jest.fn(),
		}));

		global.fetch = jest.fn() as jest.Mock;

		eventListener = new EventListener();
		jest.spyOn(console, "log").mockImplementation(() => {});
		jest.spyOn(console, "error").mockImplementation(() => {});
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should create an instance of EventListener and get AuthManager instance", () => {
			expect(eventListener).toBeInstanceOf(EventListener);
			expect(AuthManager.getInstance).toHaveBeenCalledTimes(2);
		});
	});

	describe("initialize", () => {
		it("should initialize AuthManager if not ready", async () => {
			mockAuthManagerInstance.isReady.mockReturnValue(false);
			await eventListener.initialize();
			expect(mockAuthManagerInstance.initialize).toHaveBeenCalledTimes(1);
		});

		it("should not initialize AuthManager if already ready", async () => {
			mockAuthManagerInstance.isReady.mockReturnValue(true);
			await eventListener.initialize();
			expect(mockAuthManagerInstance.initialize).not.toHaveBeenCalled();
		});

		it("should throw an error if AuthManager initialization fails", async () => {
			mockAuthManagerInstance.isReady.mockReturnValue(false);
			const initError = new Error("Auth failed");
			mockAuthManagerInstance.initialize.mockRejectedValue(initError);
			await expect(eventListener.initialize()).rejects.toThrow(
				"EventListener initialization failed: Auth failed",
			);
			expect(console.error).toHaveBeenCalledWith(
				"❌ Failed to initialize EventListener:",
				initError,
			);
		});
	});

	describe("getAccount", () => {
		it("should return the account if AuthManager is ready and has an account", () => {
			const account = (eventListener as any).getAccount();
			expect(account).toEqual(mockAccount);
			expect(mockAuthManagerInstance.getAccount).toHaveBeenCalledTimes(1);
		});

		it("should throw an error if AuthManager does not have an account", () => {
			mockAuthManagerInstance.getAccount.mockReturnValue(null);
			expect(() => (eventListener as any).getAccount()).toThrow(
				"EventListener not initialized. Call initialize() first.",
			);
		});
	});

	describe("getStats", () => {
		it("should return correct statistics when no subscriptions are active", () => {
			mockAuthManagerInstance.isReady.mockReturnValue(true);

			const stats = eventListener.getStats();
			expect(stats).toEqual({
				isInitialized: true,
				activeSubscriptions: 0,
				authManagerStatus: undefined,
				processingStates: [],
			});
		});

		it("should return correct statistics when subscriptions are active", () => {
			mockAuthManagerInstance.isReady.mockReturnValue(true);

			const mockSubscription1 = {
				id: "sub1",
				eventName: "e1",
				contractId: "c1",
				cronExpression: "* * * * *",
			};
			const mockSubscription2 = {
				id: "sub2",
				eventName: "e2",
				contractId: "c2",
				cronExpression: "* * * * *",
			};
			(eventListener as any).processingStates.set(mockSubscription1.id, {
				lastBlockHeight: 100,
				isProcessing: false,
				processedTransactionIds: new Set(["tx1", "tx2"]),
			});
			(eventListener as any).processingStates.set(mockSubscription2.id, {
				lastBlockHeight: 200,
				isProcessing: true,
				processedTransactionIds: new Set(["tx3"]),
			});

			const stats = eventListener.getStats();
			expect(stats).toEqual({
				isInitialized: true,
				activeSubscriptions: 2,
				authManagerStatus: undefined,
				processingStates: [
					{
						subscriptionId: "sub1",
						lastBlockHeight: 100,
						isProcessing: false,
						processedTransactionCount: 2,
					},
					{
						subscriptionId: "sub2",
						lastBlockHeight: 200,
						isProcessing: true,
						processedTransactionCount: 1,
					},
				],
			});
		});
	});
});
