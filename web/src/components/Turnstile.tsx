import { useEffect, useRef } from "react";

// Cloudflare Turnstile "I'm human" check. The script loads only on the contact page.
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
	render: (element: HTMLElement, options: Record<string, unknown>) => string;
	reset: (widgetId: string) => void;
	remove: (widgetId: string) => void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
	if (window.turnstile) return Promise.resolve(window.turnstile);
	if (!scriptPromise) {
		scriptPromise = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = SCRIPT_SRC;
			script.async = true;
			script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing")));
			script.onerror = () => {
				scriptPromise = null;
				reject(new Error("Turnstile failed to load"));
			};
			document.head.appendChild(script);
		});
	}
	return scriptPromise;
}

/** Renders the widget; calls onToken with a fresh token (or "" when it expires). `resetKey` change = new check. */
export default function Turnstile({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const onTokenRef = useRef(onToken);

	useEffect(() => {
		onTokenRef.current = onToken;
	}, [onToken]);

	useEffect(() => {
		const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
		let widgetId: string | null = null;
		let cancelled = false;

		loadTurnstile()
			.then((api) => {
				if (cancelled || !containerRef.current) return;
				widgetId = api.render(containerRef.current, {
					sitekey: siteKey,
					theme: "light",
					callback: (token: string) => onTokenRef.current(token),
					"expired-callback": () => onTokenRef.current(""),
					"error-callback": () => onTokenRef.current(""),
				});
			})
			.catch(() => onTokenRef.current(""));

		return () => {
			cancelled = true;
			if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
		};
	}, [resetKey]);

	return <div ref={containerRef} className="turnstile-box" />;
}
