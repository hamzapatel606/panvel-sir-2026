// Step 4: protection for the public API.
//
// 1. Origin lock (CORS): only our own sites may call the API from a browser.
//    This stops other websites from embedding the data. It does NOT stop scripts
//    (they can fake the Origin header), so the rate limit below is the real guard.
// 2. Per-visitor rate limit (Workers Rate Limiting binding, keyed by IP).
// 3. Query rules: text searches need at least 3 characters, so "a" can't match
//    (and read) most of the list.

import { json } from "./http";

/** Text queries shorter than this are rejected (they match too many rows). */
export const MIN_TEXT_QUERY = 3;
/** Longest query we accept. Real names and EPICs are far shorter. */
export const MAX_QUERY = 60;

export function allowedOrigins(env: Env): string[] {
	return (env.ALLOWED_ORIGINS ?? "")
		.split(",")
		.map((origin) => origin.trim().replace(/\/$/, ""))
		.filter(Boolean);
}

/** null = request has no Origin (curl, server, same-origin navigation). */
export function originStatus(request: Request, env: Env): "none" | "allowed" | "blocked" {
	const origin = request.headers.get("Origin");
	if (!origin) return "none";
	return allowedOrigins(env).includes(origin) ? "allowed" : "blocked";
}

export function corsHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get("Origin");
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
		"Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
		Vary: "Origin",
	};
	if (origin && allowedOrigins(env).includes(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return headers;
}

/** Copies the response with CORS headers for this request's origin (replaces any "*"). */
export function withCors(response: Response, request: Request, env: Env): Response {
	const result = new Response(response.body, response);
	result.headers.delete("Access-Control-Allow-Origin");
	for (const [key, value] of Object.entries(corsHeaders(request, env))) result.headers.set(key, value);
	return result;
}

/**
 * Per-IP rate limit for public API calls. Returns a 429 response when exceeded,
 * or null to continue. If the RATE_LIMITER binding isn't configured (e.g. not
 * available on the plan), requests are allowed and a warning is logged.
 */
export async function checkRateLimit(request: Request, env: Env): Promise<Response | null> {
	const limiter = (env as Env & { RATE_LIMITER?: RateLimit }).RATE_LIMITER;
	if (!limiter) {
		console.warn("RATE_LIMITER binding missing: public API is not rate limited.");
		return null;
	}
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const { success } = await limiter.limit({ key: ip });
	if (success) return null;
	return json(
		{ error: "RATE_LIMITED", message: "Too many searches. Please wait a minute and try again." },
		{ status: 429, headers: { "Retry-After": "60" } },
	);
}

/** Validates a search query. Returns an error response, or null if the query is fine. */
export function checkQuery(query: string, isTextSearch: boolean): Response | null {
	if (query.length > MAX_QUERY) {
		return json({ error: "QUERY_TOO_LONG", message: "Search text is too long." }, { status: 400 });
	}
	if (isTextSearch && query.replace(/["\s]/g, "").length < MIN_TEXT_QUERY) {
		return json(
			{ error: "QUERY_TOO_SHORT", message: `Please type at least ${MIN_TEXT_QUERY} letters to search by name.` },
			{ status: 400 },
		);
	}
	return null;
}
