// panvel-sir-admin: the private admin Worker.
// - Protected by Cloudflare Access (checked again in code: access.ts).
// - Serves the admin page (built by `npm run build:admin` in the website folder).
// - Answers the admin page's API calls on the same address (imports, PDFs, versions),
//   plus the read routes the page uses (/api/:list/version).
// Uses the same databases and PDF storage as the public API.
import { requireAccess } from "./access";
import { json } from "./http";
import { handleAdminRoute, isAdminPath } from "./routes/admin";
import { handlePdfRoute } from "./routes/pdf";
import { clearPublicCache, handlePublicRoute } from "./routes/public";

export default {
	async fetch(request, env): Promise<Response> {
		const denied = await requireAccess(request, env);
		if (denied) return denied;

		const url = new URL(request.url);
		const response = await route(request, env, url);
		// Admin pages and answers are never cached anywhere.
		const result = new Response(response.body, response);
		result.headers.set("Cache-Control", "no-store");
		result.headers.set("X-Robots-Tag", "noindex");
		return result;
	},
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
	if (isAdminPath(url)) {
		if (request.method !== "GET") clearPublicCache();
		return handleAdminRoute(request, env, url);
	}

	if (url.pathname.startsWith("/api/")) {
		const pdf = await handlePdfRoute(request, env, url);
		if (pdf) return pdf;
		const publicResponse = await handlePublicRoute(request, env, url);
		if (publicResponse) return publicResponse;
		return json({ error: "NOT_FOUND", message: "Unknown API route." }, { status: 404 });
	}

	// Everything else: the admin page (single-page app).
	if (!env.ASSETS) return new Response("Admin page not built. Run npm run build:admin.", { status: 500 });
	return env.ASSETS.fetch(request);
}
