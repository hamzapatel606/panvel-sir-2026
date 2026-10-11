import { afterEach, describe, expect, it, vi } from "vitest";
import { handleContact, parseContact, telegramText } from "../src/routes/contact";

const valid = {
	type: "hide",
	epic: " abc 1234567 ",
	name: "Test Voter",
	contact: "98xxxxxx10",
	message: "",
	turnstileToken: "token",
};

describe("parseContact", () => {
	it("accepts a hide request and normalises the EPIC", () => {
		const result = parseContact(valid);
		expect(result.ok && result.input.epic).toBe("ABC1234567");
	});

	it("needs a message when reporting an error", () => {
		const result = parseContact({ ...valid, type: "error", message: "" });
		expect(result.ok).toBe(false);
	});

	it("rejects junk EPICs, missing contact and a missing human check", () => {
		const result = parseContact({ ...valid, epic: "<script>", contact: "", turnstileToken: "" });
		expect(result.ok ? [] : result.errors).toHaveLength(3);
	});

	it("caps long text and strips control characters", () => {
		const result = parseContact({ ...valid, type: "error", message: "a\u0000b".padEnd(5000, "x") });
		expect(result.ok && result.input.message.length).toBe(1000);
		expect(result.ok && result.input.message.startsWith("ab")).toBe(true);
	});
});

describe("telegramText", () => {
	it("is plain text with the EPIC and an admin hint for hide requests", () => {
		const parsed = parseContact(valid);
		if (!parsed.ok) throw new Error("expected valid");
		const text = telegramText(parsed.input, new Date("2026-10-11T12:00:00Z"));
		expect(text).toContain("Hide my entry");
		expect(text).toContain("EPIC: ABC1234567");
		expect(text).toContain("Hidden EPICs");
	});
});

describe("handleContact", () => {
	const env = { TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "1", TURNSTILE_SECRET: "secret" } as unknown as Env;
	const post = (body: unknown) =>
		new Request("https://api.test/api/contact", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

	afterEach(() => vi.unstubAllGlobals());

	function stubNetwork(turnstileOk: boolean) {
		const calls: string[] = [];
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			const url = String(input instanceof Request ? input.url : input);
			calls.push(url);
			if (url.includes("turnstile")) return Response.json({ success: turnstileOk });
			if (url.includes("api.telegram.org")) return Response.json({ ok: true });
			return new Response("unexpected", { status: 500 });
		});
		return calls;
	}

	it("sends to Telegram after a passed human check", async () => {
		const calls = stubNetwork(true);
		const response = await handleContact(post(valid), env);
		expect(response.status).toBe(200);
		expect(calls.some((url) => url.includes("api.telegram.org/botbot/sendMessage"))).toBe(true);
	});

	it("never reaches Telegram when the human check fails", async () => {
		const calls = stubNetwork(false);
		const response = await handleContact(post(valid), env);
		expect(response.status).toBe(400);
		expect(calls.some((url) => url.includes("telegram"))).toBe(false);
	});

	it("is off (503) until the secrets are set", async () => {
		expect((await handleContact(post(valid), {} as Env)).status).toBe(503);
	});
});
