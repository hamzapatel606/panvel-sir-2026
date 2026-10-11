// Values `wrangler types` cannot see (secrets, and vars that only the admin
// Worker has). Declared here so both Workers type-check.
interface Env {
	/** Public API: Telegram bot that receives contact-form messages (secret). */
	TELEGRAM_BOT_TOKEN?: string;
	/** Public API: your Telegram chat id (secret). */
	TELEGRAM_CHAT_ID?: string;
	/** Public API: Cloudflare Turnstile secret key (secret). */
	TURNSTILE_SECRET?: string;
	/** Public API: 3 contact messages per minute per IP. */
	CONTACT_LIMITER?: RateLimit;
	/** Admin Worker: read-only Cloudflare API token for the usage panel (secret). */
	CF_API_TOKEN?: string;
	/** Admin Worker: https://<team>.cloudflareaccess.com */
	TEAM_DOMAIN?: string;
	/** Admin Worker: Access application AUD tag. */
	POLICY_AUD?: string;
	/** Admin Worker, local dev only (.dev.vars): "1" skips Access on localhost. */
	ACCESS_DEV_BYPASS?: string;
	/** Admin Worker: the built admin page. */
	ASSETS?: Fetcher;
}
