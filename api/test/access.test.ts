import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireAccess } from "../src/access";

const TEAM = "https://panvel-test.cloudflareaccess.com";
const AUD = "test-aud-tag";
const env = { TEAM_DOMAIN: TEAM, POLICY_AUD: AUD } as unknown as Env;

let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
	const pair = await generateKeyPair("RS256");
	privateKey = pair.privateKey;
	otherKey = (await generateKeyPair("RS256")).privateKey;
	const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
	// Stand-in for Cloudflare's public keys at <team>/cdn-cgi/access/certs.
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url === `${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
		return new Response("not found", { status: 404 });
	});
});

afterAll(() => vi.unstubAllGlobals());

function token(key: CryptoKey, claims: { aud?: string; iss?: string; exp?: string | number } = {}) {
	return new SignJWT({ email: "admin@example.com" })
		.setProtectedHeader({ alg: "RS256", kid: "k1" })
		.setIssuer(claims.iss ?? TEAM)
		.setAudience(claims.aud ?? AUD)
		.setIssuedAt()
		.setExpirationTime(claims.exp ?? "1h")
		.sign(key);
}

const request = (jwt?: string, host = "panvel-sir-admin.panvel-sir.workers.dev") =>
	new Request(`https://${host}/api/admin/draft/datasets`, { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} });

describe("requireAccess (admin Worker lock)", () => {
	it("lets in a valid Access session", async () => {
		expect(await requireAccess(request(await token(privateKey)), env)).toBeNull();
	});

	it("blocks requests with no Access token", async () => {
		expect((await requireAccess(request(), env))?.status).toBe(403);
	});

	it("blocks a token signed by someone else", async () => {
		expect((await requireAccess(request(await token(otherKey)), env))?.status).toBe(403);
	});

	it("blocks a token for another Access app (wrong AUD)", async () => {
		expect((await requireAccess(request(await token(privateKey, { aud: "other-app" })), env))?.status).toBe(403);
	});

	it("blocks an expired token", async () => {
		const expired = Math.floor(Date.now() / 1000) - 60;
		expect((await requireAccess(request(await token(privateKey, { exp: expired })), env))?.status).toBe(403);
	});

	it("stays locked when Access settings are missing", async () => {
		expect((await requireAccess(request(await token(privateKey)), {} as Env))?.status).toBe(403);
	});

	it("dev bypass works only on localhost", async () => {
		const devEnv = { ...env, ACCESS_DEV_BYPASS: "1" } as Env;
		expect(await requireAccess(new Request("http://localhost:8788/"), devEnv)).toBeNull();
		expect((await requireAccess(request(), devEnv))?.status).toBe(403);
	});
});
