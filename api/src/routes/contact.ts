// POST /api/contact — "Found an error or want your entry hidden?"
//
// Flow: browser form → Turnstile check (stops bots) → per-IP limit (3/min) →
// message sent to the site owner's Telegram. Nothing is stored in the database.
import { json } from "../http";

const TYPES = { hide: "Hide my entry", error: "Report an error" } as const;
type RequestType = keyof typeof TYPES;

const LIMITS = { epic: 20, name: 80, contact: 100, message: 1000 };

export interface ContactInput {
	type: RequestType;
	epic: string;
	name: string;
	contact: string;
	message: string;
	turnstileToken: string;
}

function clean(value: unknown, max: number): string {
	// Strip control characters, collapse spaces, cap length.
	return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max) : "";
}

/** Validates the form body. Returns the cleaned input or a list of problems. */
export function parseContact(body: unknown): { ok: true; input: ContactInput } | { ok: false; errors: string[] } {
	const data = (body ?? {}) as Record<string, unknown>;
	const type = data.type;
	const input: ContactInput = {
		type: type === "hide" || type === "error" ? type : "error",
		epic: clean(data.epic, LIMITS.epic).toUpperCase().replace(/\s+/g, ""),
		name: clean(data.name, LIMITS.name),
		contact: clean(data.contact, LIMITS.contact),
		message: clean(data.message, LIMITS.message),
		turnstileToken: clean(data.turnstileToken, 4096),
	};

	const errors: string[] = [];
	if (type !== "hide" && type !== "error") errors.push("Choose what you need.");
	if (!/^[A-Z0-9/]{6,20}$/.test(input.epic)) errors.push("Enter a valid EPIC number.");
	if (input.name.length < 2) errors.push("Enter your name.");
	if (input.contact.length < 5) errors.push("Enter a phone number or email so we can reply.");
	if (input.type === "error" && input.message.length < 5) errors.push("Describe the error.");
	if (!input.turnstileToken) errors.push("Please complete the human check.");
	return errors.length ? { ok: false, errors } : { ok: true, input };
}

/** Plain-text Telegram message (no Markdown/HTML parsing, so user text can't inject formatting). */
export function telegramText(input: ContactInput, when: Date): string {
	return [
		`📮 Panvel SIR — ${TYPES[input.type]}`,
		`EPIC: ${input.epic}`,
		`Name: ${input.name}`,
		`Contact: ${input.contact}`,
		input.message ? `Message: ${input.message}` : "",
		`Time: ${when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
		input.type === "hide" ? "Action: admin → Hidden EPICs → add this EPIC." : "",
	]
		.filter(Boolean)
		.join("\n");
}

async function verifyTurnstile(token: string, ip: string | null, secret: string): Promise<boolean> {
	const form = new FormData();
	form.append("secret", secret);
	form.append("response", token);
	if (ip) form.append("remoteip", ip);
	const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
	if (!response.ok) return false;
	const result = (await response.json()) as { success?: boolean };
	return result.success === true;
}

export async function handleContact(request: Request, env: Env): Promise<Response> {
	if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.TURNSTILE_SECRET) {
		return json({ error: "CONTACT_NOT_CONFIGURED", message: "The contact form is not available right now." }, { status: 503 });
	}

	const ip = request.headers.get("CF-Connecting-IP");
	const limiter = env.CONTACT_LIMITER;
	if (limiter) {
		const { success } = await limiter.limit({ key: ip ?? "unknown" });
		if (!success) {
			return json({ error: "RATE_LIMITED", message: "Too many messages. Please try again in a minute." }, { status: 429 });
		}
	}

	if (Number(request.headers.get("Content-Length") ?? "0") > 8_000) {
		return json({ error: "TOO_LARGE", message: "Message is too long." }, { status: 413 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "INVALID_JSON", message: "Invalid request." }, { status: 400 });
	}

	const parsed = parseContact(body);
	if (!parsed.ok) return json({ error: "INVALID_INPUT", message: parsed.errors[0], errors: parsed.errors }, { status: 400 });

	if (!(await verifyTurnstile(parsed.input.turnstileToken, ip, env.TURNSTILE_SECRET))) {
		return json({ error: "HUMAN_CHECK_FAILED", message: "Human check failed. Please try again." }, { status: 400 });
	}

	const telegram = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: telegramText(parsed.input, new Date()), disable_web_page_preview: true }),
	});
	if (!telegram.ok) {
		console.error("Telegram send failed", telegram.status);
		return json({ error: "SEND_FAILED", message: "Could not send your message. Please try again later." }, { status: 502 });
	}

	return json({ success: true });
}
