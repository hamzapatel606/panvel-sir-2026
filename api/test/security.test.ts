import { describe, expect, it } from "vitest";
import { checkQuery, MAX_QUERY, originStatus } from "../src/security";

const env = { ALLOWED_ORIGINS: "https://sir.hamzapatel.co.in, http://localhost:5173/" } as unknown as Env;
const from = (origin?: string) => new Request("https://api.test/api/draft/search", { headers: origin ? { Origin: origin } : {} });

describe("originStatus (CORS lock)", () => {
	it("allows our site, including a trailing slash in the config", () => {
		expect(originStatus(from("https://sir.hamzapatel.co.in"), env)).toBe("allowed");
		expect(originStatus(from("http://localhost:5173"), env)).toBe("allowed");
	});
	it("blocks other websites", () => expect(originStatus(from("https://evil.example"), env)).toBe("blocked"));
	it("treats no Origin as 'none' (curl, direct PDF links)", () => expect(originStatus(from(), env)).toBe("none"));
});

describe("checkQuery", () => {
	it("rejects text searches under 3 letters", async () => {
		const response = checkQuery("ab", true);
		expect(response?.status).toBe(400);
		expect(await response?.json()).toMatchObject({ error: "QUERY_TOO_SHORT" });
	});
	it("allows short EPIC/number searches (not text)", () => expect(checkQuery("12", false)).toBeNull());
	it("rejects very long input", async () => {
		const response = checkQuery("x".repeat(MAX_QUERY + 1), false);
		expect(await response?.json()).toMatchObject({ error: "QUERY_TOO_LONG" });
	});
	it("accepts a normal name", () => expect(checkQuery("hamza patel", true)).toBeNull());
});
