// Cloudflare Access check for the admin Worker.
//
// Access (Zero Trust) sits in front of panvel-sir-admin.*.workers.dev and only
// lets in the emails in its policy. Every request that passes carries a signed
// JWT in the Cf-Access-Jwt-Assertion header. We verify that JWT here too, so the
// admin stays locked even if Access were switched off by mistake.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { json } from "./http";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeam = "";

function keysFor(teamDomain: string) {
	if (!jwks || jwksTeam !== teamDomain) {
		jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
		jwksTeam = teamDomain;
	}
	return jwks;
}

function isLocalDev(request: Request, env: Env): boolean {
	// Only for `wrangler dev` on your PC: needs BOTH a localhost address AND the
	// ACCESS_DEV_BYPASS=1 line in .dev.vars. Impossible on the live workers.dev address.
	const host = new URL(request.url).hostname;
	return env.ACCESS_DEV_BYPASS === "1" && (host === "localhost" || host === "127.0.0.1");
}

/** Returns a 403 response when the request is not from a signed-in admin, else null. */
export async function requireAccess(request: Request, env: Env): Promise<Response | null> {
	if (isLocalDev(request, env)) return null;

	const teamDomain = (env.TEAM_DOMAIN ?? "").replace(/\/$/, "");
	const audience = env.POLICY_AUD ?? "";
	if (!teamDomain || !audience) {
		return json({ error: "ACCESS_NOT_CONFIGURED", message: "Cloudflare Access is not configured." }, { status: 403 });
	}

	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) return json({ error: "FORBIDDEN", message: "Sign in through Cloudflare Access." }, { status: 403 });

	try {
		await jwtVerify(token, keysFor(teamDomain), { issuer: teamDomain, audience });
		return null;
	} catch {
		return json({ error: "FORBIDDEN", message: "Invalid or expired Access session." }, { status: 403 });
	}
}
