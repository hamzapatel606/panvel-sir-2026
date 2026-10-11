// PDF metadata and file streaming from R2.
import { json } from "../http";
import { getDatabase, isSection } from "../sections";

const PDF_PATTERN = /^\/api\/([a-z]+)\/pdf\/(\d+)(\/file)?$/;

export async function handlePdfRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
	if (request.method !== "GET") return null;

	const match = url.pathname.match(PDF_PATTERN);
	if (!match || !isSection(match[1])) return null;

	const section = match[1];
	const pdfId = Number(match[2]);
	const wantsFile = Boolean(match[3]);
	const db = getDatabase(env, section);

	if (!wantsFile) {
		try {
			const pdf = await db
				.prepare(
					`SELECT pdf_id, part_id, source_file_id, r2_key, file_name, file_size, page_count, checksum, status
					 FROM pdf_documents WHERE pdf_id = ? LIMIT 1`,
				)
				.bind(pdfId)
				.first<Record<string, unknown>>();
			if (!pdf) return json({ error: "PDF_NOT_FOUND", message: "PDF not found." }, { status: 404 });
			return json({ section, pdf: { ...pdf, page_count: pdf.page_count === 0 ? null : pdf.page_count } });
		} catch {
			return json({ error: "DATABASE_ERROR", message: "Unable to read PDF metadata." }, { status: 500 });
		}
	}

	try {
		const pdf = await db
			.prepare(`SELECT pdf_id, r2_key, file_name, file_size, status FROM pdf_documents WHERE pdf_id = ? LIMIT 1`)
			.bind(pdfId)
			.first<{ pdf_id: number; r2_key: string; file_name: string; file_size: number; status: string }>();

		if (!pdf || pdf.status !== "READY") {
			return json({ error: "PDF_NOT_FOUND", message: "PDF not found." }, { status: 404 });
		}

		// Partial downloads (HTTP Range). The in-site viewer (PDF.js) fetches only the
		// bytes it needs for one page, so these must be exact.
		const size = Number(pdf.file_size);
		const parsed = parseRange(request.headers.get("Range"), size);
		if (parsed === "unsatisfiable") {
			return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
		}

		const object = await env.PDF_BUCKET.get(
			pdf.r2_key,
			parsed ? { range: { offset: parsed.start, length: parsed.end - parsed.start + 1 } } : undefined,
		);
		if (!object) {
			return json({ error: "PDF_FILE_NOT_FOUND", message: "PDF file is not available in storage." }, { status: 404 });
		}

		const headers = new Headers();
		headers.set("Content-Type", object.httpMetadata?.contentType || "application/pdf");
		headers.set("Accept-Ranges", "bytes");
		headers.set("Content-Disposition", `inline; filename="${pdf.file_name.replace(/"/g, "")}"`);
		// A pdf_id never changes content (a replaced PDF gets a new id), so browsers can cache it.
		headers.set("Cache-Control", "public, max-age=86400");
		if (object.httpEtag) headers.set("ETag", object.httpEtag);

		if (parsed) {
			headers.set("Content-Length", String(parsed.end - parsed.start + 1));
			headers.set("Content-Range", `bytes ${parsed.start}-${parsed.end}/${object.size}`);
			return new Response(object.body, { status: 206, headers });
		}

		headers.set("Content-Length", String(object.size));
		return new Response(object.body, { status: 200, headers });
	} catch {
		return json({ error: "PDF_READ_FAILED", message: "Unable to read PDF file." }, { status: 500 });
	}
}

/**
 * Parses a single "bytes=" range against the file size.
 * Supports "start-end", "start-" and "-suffix". Returns null for no/ignored range
 * (send the whole file) or "unsatisfiable" when it starts past the end.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "unsatisfiable" {
	if (!header || !Number.isFinite(size) || size <= 0) return null;
	const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
	if (!match || (match[1] === "" && match[2] === "")) return null; // multi-range or malformed: send whole file

	if (match[1] === "") {
		const suffix = Number(match[2]);
		if (suffix <= 0) return "unsatisfiable";
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}

	const start = Number(match[1]);
	if (start >= size) return "unsatisfiable";
	const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
	if (end < start) return null;
	return { start, end };
}
