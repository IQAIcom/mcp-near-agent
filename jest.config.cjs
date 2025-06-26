module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
		"^../services/auth-manager.js$": "<rootDir>/src/services/auth-manager.ts",
		"^../services/event-listener.js$":
			"<rootDir>/src/services/event-listener.ts",

		"^../env.js$": "<rootDir>/src/env.ts",
	},
	roots: ["<rootDir>/src"],
	testMatch: ["<rootDir>/src/**/*.test.ts"],
};
