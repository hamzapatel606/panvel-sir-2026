// Shared HTTP helpers. CORS headers are added once, per request origin,
// in index.ts (see security.ts).
export function json(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, init);
}

export function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

export function encodeCursor(serial: number, id: number): string {
	return btoa(JSON.stringify({ serial, id }));
}

export function decodeCursor(cursor: string): { serial: number; id: number } | null {
	try {
		const decoded = JSON.parse(atob(cursor));
		if (typeof decoded.serial !== "number" || typeof decoded.id !== "number") return null;
		return decoded;
	} catch {
		return null;
	}
}
