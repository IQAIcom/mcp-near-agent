import type { FastMCPSession } from "fastmcp";
import type * as cron from "node-cron";
import {
	SubscriptionConfig,
	SubscriptionManager,
} from "../services/subscription-manager";

const mockSession: FastMCPSession = {
	connect: jest.fn(),
	disconnect: jest.fn(),
	isConnected: jest.fn(() => true),
} as unknown as FastMCPSession;

const mockCronScheduledTask = {
	stop: jest.fn(),
	destroy: jest.fn(),
	start: jest.fn(),
} as unknown as cron.ScheduledTask;

describe("SubscriptionManager", () => {
	let manager: SubscriptionManager;
	const resetManager = () => {
		// @ts-ignore: Accessing private constructor for testing purposes
		SubscriptionManager.instance = new (SubscriptionManager as any)();
		manager = SubscriptionManager.getInstance();
		manager["subscriptions"].clear();
	};

	beforeEach(() => {
		resetManager();
		jest.clearAllMocks();
	});

	it("should return a singleton instance", () => {
		const instance1 = SubscriptionManager.getInstance();
		const instance2 = SubscriptionManager.getInstance();
		expect(instance1).toBe(instance2);
	});

	describe("subscribe", () => {
		it("should successfully subscribe to a new event", () => {
			const config: SubscriptionConfig = {
				contractId: "contract1",
				eventName: "EventA",
				responseMethodName: "myResponse",
				cronExpression: "*/5 * * * * *",
				session: mockSession,
			};

			const subscription = manager.subscribe(config);

			expect(subscription).toBeDefined();
			expect(subscription.id).toBe("contract1:EventA");
			expect(subscription.contractId).toBe("contract1");
			expect(subscription.eventName).toBe("EventA");
			expect(subscription.responseMethodName).toBe("myResponse");
			expect(subscription.cronExpression).toBe("*/5 * * * * *");
			expect(subscription.session).toBe(mockSession);
			expect(subscription.isActive).toBe(true);
			expect(subscription.createdAt).toBeLessThanOrEqual(Date.now());
			expect(manager.hasSubscription("contract1", "EventA")).toBe(true);
			expect(manager.getSubscriptionIds()).toContain("contract1:EventA");
		});

		it("should use default responseMethodName and cronExpression if not provided", () => {
			const config: SubscriptionConfig = {
				contractId: "contract2",
				eventName: "EventB",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};

			const subscription = manager.subscribe(config);
			expect(subscription.responseMethodName).toBe("agent_response");
			expect(subscription.cronExpression).toBe("*/10 * * * * *");
		});

		it("should throw an error if already subscribed to the event", () => {
			const config: SubscriptionConfig = {
				contractId: "contract3",
				eventName: "EventC",
				responseMethodName: "myResponse",
				cronExpression: "*/5 * * * * *",
				session: mockSession,
			};

			manager.subscribe(config);
			expect(() => manager.subscribe(config)).toThrow(
				"Already subscribed to event 'EventC' on contract 'contract3'",
			);
		});
	});

	describe("unsubscribe", () => {
		it("should successfully unsubscribe from an event", () => {
			const config: SubscriptionConfig = {
				contractId: "contract4",
				eventName: "EventD",
				responseMethodName: "myResponse",
				cronExpression: "*/5 * * * * *",
				session: mockSession,
			};
			const subscription = manager.subscribe(config);
			subscription.cronJob = mockCronScheduledTask;

			const result = manager.unsubscribe("contract4", "EventD");
			expect(result).toBe(true);
			expect(manager.hasSubscription("contract4", "EventD")).toBe(false);
			expect(mockCronScheduledTask.stop).toHaveBeenCalledTimes(1);
			expect(mockCronScheduledTask.destroy).toHaveBeenCalledTimes(1);
		});

		it("should return false if trying to unsubscribe from a non-existent event", () => {
			const result = manager.unsubscribe(
				"nonExistentContract",
				"nonExistentEvent",
			);
			expect(result).toBe(false);
			expect(mockCronScheduledTask.stop).not.toHaveBeenCalled();
			expect(mockCronScheduledTask.destroy).not.toHaveBeenCalled();
		});

		it("should not try to stop/destroy cron job if it doesn't exist on subscription", () => {
			const config: SubscriptionConfig = {
				contractId: "contract5",
				eventName: "EventE",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			manager.subscribe(config);

			const result = manager.unsubscribe("contract5", "EventE");
			expect(result).toBe(true);
			expect(mockCronScheduledTask.stop).not.toHaveBeenCalled();
			expect(mockCronScheduledTask.destroy).not.toHaveBeenCalled();
		});
	});

	describe("hasSubscription", () => {
		it("should return true if subscription exists", () => {
			manager.subscribe({
				contractId: "contract6",
				eventName: "EventF",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			expect(manager.hasSubscription("contract6", "EventF")).toBe(true);
		});

		it("should return false if subscription does not exist", () => {
			expect(manager.hasSubscription("contract6", "NonExistentEvent")).toBe(
				false,
			);
		});
	});

	describe("getSubscription", () => {
		it("should return the subscription if it exists", () => {
			const config: SubscriptionConfig = {
				contractId: "contract7",
				eventName: "EventG",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			const subscribed = manager.subscribe(config);
			const retrieved = manager.getSubscription("contract7", "EventG");
			expect(retrieved).toBe(subscribed);
		});

		it("should return undefined if the subscription does not exist", () => {
			const retrieved = manager.getSubscription(
				"contract7",
				"NonExistentEvent",
			);
			expect(retrieved).toBeUndefined();
		});
	});

	describe("getActiveSubscriptions", () => {
		it("should return only active subscriptions", () => {
			manager.subscribe({
				contractId: "c1",
				eventName: "e1",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.subscribe({
				contractId: "c1",
				eventName: "e2",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.subscribe({
				contractId: "c2",
				eventName: "e3",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.pauseSubscription("c1", "e2");

			const activeSubs = manager.getActiveSubscriptions();
			expect(activeSubs.length).toBe(2);
			expect(activeSubs.some((s) => s.id === "c1:e1")).toBe(true);
			expect(activeSubs.some((s) => s.id === "c2:e3")).toBe(true);
			expect(activeSubs.some((s) => s.id === "c1:e2")).toBe(false);
		});

		it("should return an empty array if no active subscriptions", () => {
			manager.subscribe({
				contractId: "c1",
				eventName: "e1",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.pauseSubscription("c1", "e1");
			expect(manager.getActiveSubscriptions()).toEqual([]);
		});
	});

	describe("getSubscriptionsByContract", () => {
		it("should return only active subscriptions for a given contract", () => {
			manager.subscribe({
				contractId: "contractA",
				eventName: "event1",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.subscribe({
				contractId: "contractA",
				eventName: "event2",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.subscribe({
				contractId: "contractB",
				eventName: "event3",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.pauseSubscription("contractA", "event2");

			const subsForContractA = manager.getSubscriptionsByContract("contractA");
			expect(subsForContractA.length).toBe(1);
			expect(subsForContractA[0].id).toBe("contractA:event1");
			expect(subsForContractA.some((s) => s.id === "contractA:event2")).toBe(
				false,
			);
		});

		it("should return an empty array if no subscriptions for the contract", () => {
			manager.subscribe({
				contractId: "contractC",
				eventName: "event4",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			expect(manager.getSubscriptionsByContract("nonExistentContract")).toEqual(
				[],
			);
		});
	});

	describe("updateCronJob", () => {
		it("should update the cron job for an existing subscription", () => {
			const config: SubscriptionConfig = {
				contractId: "contract8",
				eventName: "EventH",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			manager.subscribe(config);

			const oldCronJob = { ...mockCronScheduledTask };
			manager.updateCronJob("contract8", "EventH", oldCronJob);

			const newCronJob = { ...mockCronScheduledTask };
			const result = manager.updateCronJob("contract8", "EventH", newCronJob);

			expect(result).toBe(true);
			const subscription = manager.getSubscription("contract8", "EventH");
			expect(subscription?.cronJob).toBe(newCronJob);
			expect(oldCronJob.stop).toHaveBeenCalledTimes(1);
			expect(oldCronJob.destroy).toHaveBeenCalledTimes(1);
		});

		it("should return false if subscription does not exist", () => {
			const result = manager.updateCronJob(
				"nonExistentContract",
				"nonExistentEvent",
				mockCronScheduledTask,
			);
			expect(result).toBe(false);
		});
	});

	describe("markEventReceived", () => {
		it("should update lastEventAt for an existing subscription", () => {
			const config: SubscriptionConfig = {
				contractId: "contract9",
				eventName: "EventI",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			manager.subscribe(config);

			const initialLastEventAt = manager.getSubscription(
				"contract9",
				"EventI",
			)?.lastEventAt;
			expect(initialLastEventAt).toBeUndefined();

			jest.useFakeTimers();
			jest.setSystemTime(new Date(2025, 0, 1, 12, 0, 0));

			manager.markEventReceived("contract9", "EventI");
			const updatedLastEventAt = manager.getSubscription(
				"contract9",
				"EventI",
			)?.lastEventAt;

			expect(updatedLastEventAt).toBe(new Date(2025, 0, 1, 12, 0, 0).getTime());

			jest.useRealTimers();
		});

		it("should do nothing if subscription does not exist", () => {
			manager.markEventReceived("nonExistentContract", "nonExistentEvent");
			expect(
				manager.getSubscription("nonExistentContract", "nonExistentEvent"),
			).toBeUndefined();
		});
	});

	describe("pauseSubscription", () => {
		it("should mark subscription as inactive and stop its cron job", () => {
			const config: SubscriptionConfig = {
				contractId: "contract10",
				eventName: "EventJ",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			const subscription = manager.subscribe(config);
			subscription.cronJob = mockCronScheduledTask;

			const result = manager.pauseSubscription("contract10", "EventJ");
			expect(result).toBe(true);
			expect(subscription.isActive).toBe(false);
			expect(mockCronScheduledTask.stop).toHaveBeenCalledTimes(1);
			expect(mockCronScheduledTask.destroy).not.toHaveBeenCalled();
		});

		it("should return false if subscription does not exist", () => {
			const result = manager.pauseSubscription(
				"nonExistentContract",
				"nonExistentEvent",
			);
			expect(result).toBe(false);
			expect(mockCronScheduledTask.stop).not.toHaveBeenCalled();
		});

		it("should not try to stop cron job if it doesn't exist", () => {
			const config: SubscriptionConfig = {
				contractId: "contract11",
				eventName: "EventK",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			const subscription = manager.subscribe(config);

			const result = manager.pauseSubscription("contract11", "EventK");
			expect(result).toBe(true);
			expect(subscription.isActive).toBe(false);
			expect(mockCronScheduledTask.stop).not.toHaveBeenCalled();
		});
	});

	describe("resumeSubscription", () => {
		it("should mark subscription as active and start its cron job", () => {
			const config: SubscriptionConfig = {
				contractId: "contract12",
				eventName: "EventL",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			const subscription = manager.subscribe(config);
			subscription.cronJob = mockCronScheduledTask;
			subscription.isActive = false;

			const result = manager.resumeSubscription("contract12", "EventL");
			expect(result).toBe(true);
			expect(subscription.isActive).toBe(true);
			expect(mockCronScheduledTask.start).toHaveBeenCalledTimes(1);
		});

		it("should return false if subscription does not exist", () => {
			const result = manager.resumeSubscription(
				"nonExistentContract",
				"nonExistentEvent",
			);
			expect(result).toBe(false);
			expect(mockCronScheduledTask.start).not.toHaveBeenCalled();
		});

		it("should not try to start cron job if it doesn't exist", () => {
			const config: SubscriptionConfig = {
				contractId: "contract13",
				eventName: "EventM",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			const subscription = manager.subscribe(config);
			subscription.isActive = false;

			const result = manager.resumeSubscription("contract13", "EventM");
			expect(result).toBe(true);
			expect(subscription.isActive).toBe(true);
			expect(mockCronScheduledTask.start).not.toHaveBeenCalled();
		});
	});

	describe("getStats", () => {
		it("should return correct statistics when no subscriptions exist", () => {
			const stats = manager.getStats();
			expect(stats).toEqual({
				total: 0,
				active: 0,
				paused: 0,
				contractCounts: {},
				oldestSubscription: null,
			});
		});

		it("should return correct statistics with mixed active and paused subscriptions", () => {
			jest.useFakeTimers();
			jest.setSystemTime(new Date(2020, 0, 1, 0, 0, 0));

			manager.subscribe({
				contractId: "c1",
				eventName: "e1",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			jest.setSystemTime(new Date(2020, 0, 2, 0, 0, 0));
			manager.subscribe({
				contractId: "c1",
				eventName: "e2",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			jest.setSystemTime(new Date(2020, 0, 3, 0, 0, 0));
			manager.subscribe({
				contractId: "c2",
				eventName: "e3",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});

			manager.pauseSubscription("c1", "e2");

			const stats = manager.getStats();
			expect(stats.total).toBe(3);
			expect(stats.active).toBe(2);
			expect(stats.paused).toBe(1);
			expect(stats.contractCounts).toEqual({ c1: 2, c2: 1 });
			expect(stats.oldestSubscription).toBe(
				new Date(2020, 0, 1, 0, 0, 0).getTime(),
			);
			jest.useRealTimers();
		});
	});

	describe("cleanup", () => {
		it("should clear all subscriptions and stop/destroy their cron jobs", () => {
			const config1: SubscriptionConfig = {
				contractId: "contractX",
				eventName: "EventY",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			const sub1 = manager.subscribe(config1);
			sub1.cronJob = {
				...mockCronScheduledTask,
				id: "job1",
			} as cron.ScheduledTask;
			const stopSpy1 = jest.spyOn(sub1.cronJob, "stop");
			const destroySpy1 = jest.spyOn(sub1.cronJob, "destroy");

			const config2: SubscriptionConfig = {
				contractId: "contractX",
				eventName: "EventZ",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			};
			const sub2 = manager.subscribe(config2);
			sub2.cronJob = {
				...mockCronScheduledTask,
				id: "job2",
			} as cron.ScheduledTask;
			const stopSpy2 = jest.spyOn(sub2.cronJob, "stop");
			const destroySpy2 = jest.spyOn(sub2.cronJob, "destroy");

			expect(manager.getSubscriptionIds().length).toBe(2);

			manager.cleanup();

			expect(manager.getSubscriptionIds().length).toBe(0);
			expect(stopSpy1).toHaveBeenCalledTimes(2);
			expect(destroySpy1).toHaveBeenCalledTimes(2);
			expect(stopSpy2).toHaveBeenCalledTimes(2);
			expect(destroySpy2).toHaveBeenCalledTimes(2);
		});

		it("should handle cleanup gracefully when no subscriptions exist", () => {
			expect(manager.getSubscriptionIds().length).toBe(0);
			expect(() => manager.cleanup()).not.toThrow();
			expect(manager.getSubscriptionIds().length).toBe(0);
		});
	});

	describe("private methods", () => {
		it("generateSubscriptionId should create correct ID", () => {
			// @ts-ignore: Accessing private method for testing
			const id = manager["generateSubscriptionId"]("myContract", "myEvent");
			expect(id).toBe("myContract:myEvent");
		});
	});

	describe("getSubscriptionIds", () => {
		it("should return an array of all subscription IDs", () => {
			manager.subscribe({
				contractId: "c_test1",
				eventName: "e_test1",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			manager.subscribe({
				contractId: "c_test2",
				eventName: "e_test2",
				responseMethodName: "agent_response",
				cronExpression: "*/10 * * * * *",
				session: mockSession,
			});
			const ids = manager.getSubscriptionIds();
			expect(ids).toEqual(["c_test1:e_test1", "c_test2:e_test2"]);
		});

		it("should return an empty array if no subscriptions", () => {
			expect(manager.getSubscriptionIds()).toEqual([]);
		});
	});
});
