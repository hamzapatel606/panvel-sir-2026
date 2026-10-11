// SIR Panvel public API — router (read-only).
// Admin lives in a separate Worker behind Cloudflare Access (src/admin-worker.ts).
// Lists (Draft, Final Draft, ASDD) are defined once in sections.ts.
import { json } from "./http";
import { handlePdfRoute } from "./routes/pdf";
import { handleContact } from "./routes/contact";
import { handlePublicRoute } from "./routes/public";
import { checkRateLimit, originStatus, withCors } from "./security";
import { SECTION_KEYS, SECTIONS } from "./sections";

export default {
	async fetch(request, env): Promise<Response> {
		const response = await route(request, env);
		return withCors(response, request, env);
	},
} satisfies ExportedHandler<Env>;

async function health(env: Env): Promise<Response> {
	try {
		const checks = await Promise.all(
			SECTION_KEYS.map(async (key) => {
				const row = await SECTIONS[key].db(env).prepare("SELECT 1 AS ok").first<{ ok: number }>();
				return [key, row?.ok === 1] as const;
			}),
		);
		return json({ status: "ok", databases: Object.fromEntries(checks) });
	} catch {
		return json({ status: "error" }, { status: 500 });
	}
}

/**
 * Lets the visitor's browser reuse successful public answers for 5 minutes
 * (back button, repeat searches, switching lists): instant, and no database reads.
 * Data only changes when the admin imports, so 5 minutes of staleness is harmless.
 * Errors are never cached.
 */
function withBrowserCache(response: Response, request: Request): Response {
	const result = new Response(response.body, response);
	// The admin panel calls /version with a token and must always see fresh data.
	const cacheable = response.status === 200 && !request.headers.has("Authorization");
	result.headers.set("Cache-Control", cacheable ? "public, max-age=300" : "no-store");
	return result;
}

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	// Browsers on other websites may not call the API at all.
	if (originStatus(request, env) === "blocked") {
		return json({ error: "ORIGIN_NOT_ALLOWED", message: "This API only serves the SIR Panvel website." }, { status: 403 });
	}

	if (request.method === "OPTIONS") return new Response(null, { status: 204 });

	if (url.pathname === "/api/health") return health(env);

	if (url.pathname.startsWith("/api/")) {
		const limited = await checkRateLimit(request, env);
		if (limited) return limited;
	}

	if (url.pathname === "/api/contact") {
		if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED", message: "Use POST." }, { status: 405 });
		return handleContact(request, env);
	}

	const pdf = await handlePdfRoute(request, env, url);
	if (pdf) return pdf;

	const publicResponse = await handlePublicRoute(request, env, url);
	if (publicResponse) return withBrowserCache(publicResponse, request);

	if (url.pathname.startsWith("/api/")) {
		return json({ error: "NOT_FOUND", message: "Unknown API route." }, { status: 404 });
	}
	return new Response("SIR Panvel API");
}
