import { defineConfig } from "vitest/config";

// Unit tests for the pure logic (search building, ranges, field rules, query limits).
// They run in Node: no Worker runtime or database needed.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
	},
});
