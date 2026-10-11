import type { Section } from "../config/sections";

export type { Section };

// Production: the Worker's workers.dev address, set in .env.production.
// Local dev: empty, so /api goes through the Vite proxy to `wrangler dev`.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/** Base URL of the API, used for PDF links. */
export const API_BASE = API_BASE_URL;

export interface DatasetVersion {
	dataset_id: number;
	version_code: string;
	version_name: string;
	status?: "ACTIVE" | "ARCHIVED";
	created_at?: string;
}

export interface Part {
	part_id: number;
	part_no: number;
	part_name: string | null;
	record_count: number;
	status: "READY";
}

export interface SearchResponse<T = unknown> {
	section: Section;
	/** null = this list is not published yet. */
	version: DatasetVersion | null;
	part: Part | null;
	records: T[];
	nextCursor: string | null;
	hasMore: boolean;
}

async function request<T>(path: string): Promise<T> {
	const response = await fetch(`${API_BASE_URL}${path}`);

	if (!response.ok) {
		let message = `Request failed (${response.status})`;

		try {
			const body = await response.json();
			if (body?.message) {
				message = body.message;
			}
		} catch {
			// Keep default error message.
		}

		throw new Error(message);
	}

	return response.json();
}

export function getVersion(section: Section) {
	return request<{
		section: Section;
		/** null = this list is not published yet. */
		version: DatasetVersion | null;
	}>(`/api/${section}/version`);
}

export interface AdminDataset extends DatasetVersion {
	dataset_id: number;
	status: "ACTIVE" | "ARCHIVED";
}

export function getAdminDatasets(section: Section) {
	return request<{
		section: Section;
		datasets: AdminDataset[];
	}>(`/api/admin/${section}/datasets`);
}

export function createAdminDataset(
	section: Section,
	versionCode: string,
	versionName: string,
) {
	return fetch(`${API_BASE_URL}/api/admin/${section}/datasets`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ versionCode, versionName }),
	}).then(async (response) => {
		if (!response.ok) {
			let message = `Request failed (${response.status})`;
			try {
				const body = await response.json();
				if (body?.message) message = body.message;
			} catch {
				// Keep default error message.
			}
			throw new Error(message);
		}
		return response.json() as Promise<{
			success: true;
			dataset: AdminDataset;
		}>;
	});
}

export function activateAdminDataset(
	section: Section,
	datasetId: number,
) {
	return fetch(
		`${API_BASE_URL}/api/admin/${section}/datasets/${datasetId}/activate`,
		{
			method: "POST",
		},
	).then(async (response) => {
		if (!response.ok) {
			let message = `Request failed (${response.status})`;
			try {
				const body = await response.json();
				if (body?.message) message = body.message;
			} catch {
				// Keep default error message.
			}
			throw new Error(message);
		}
		return response.json() as Promise<{
			success: true;
			section: Section;
			datasetId: number;
			status: "ACTIVE";
		}>;
	});
}

export interface PartsResponse {
	section: Section;
	/** null = this list is not published yet. */
	version: DatasetVersion | null;
	parts: Part[];
}

export function getParts(section: Section) {
	return request<PartsResponse>(`/api/${section}/parts`);
}

// One request per list per page load, shared by every component that asks.
const partsCache = new Map<Section, Promise<PartsResponse>>();

export function getPartsCached(section: Section): Promise<PartsResponse> {
	let pending = partsCache.get(section);
	if (!pending) {
		pending = getParts(section).catch((error) => {
			partsCache.delete(section);
			throw error;
		});
		partsCache.set(section, pending);
	}
	return pending;
}

/** A list is published when it has an ACTIVE version with at least one READY Part. */
export function isPublished(result: PartsResponse): boolean {
	return result.version !== null && result.parts.length > 0;
}

export function searchRecords(
	section: Section,
	query: string,
	field = "all",
	partNo?: number,
	cursor?: string,
	limit = 30,
) {
	const params = new URLSearchParams();

	if (query.trim()) {
		params.set("query", query.trim());
	}

	params.set("field", field);

	if (partNo !== undefined) {
		params.set("partNo", String(partNo));
	}

	if (cursor) {
		params.set("cursor", cursor);
	}

	params.set("limit", String(limit));

	return request<SearchResponse>(
		`/api/${section}/search?${params.toString()}`,
	);
}

export function getRecordByEpic(
	section: Section,
	epicNo: string,
) {
	return request<{
		section: Section;
		version: DatasetVersion;
		record: unknown;
	}>(`/api/${section}/by-epic/${encodeURIComponent(epicNo)}`);
}
/** Error/success JSON from admin import routes (only the fields the UI reads). */
interface ApiErrorBody {
	error?: string;
	message?: string;
	errors?: { message?: string }[];
	errorCount?: number;
	[key: string]: unknown;
}

export interface ImportResult {
	partsProcessed?: number;
	recordCount?: number;
	totalRecords?: number;
	parts?: unknown[];
	[key: string]: unknown;
}

export interface PdfImportResult {
	section: Section;
	datasetId: number;
	partId: number;
	partNo: number;
	pdfId: number;
	partStatus: "NO_DATA" | "PREPARING" | "READY" | "ERROR";
	replacedPdfId?: number | null;
}

export async function importAdminPdfs(
	section: Section,
	datasetId: number,
	files: Array<{ file: File; partNo: number; pageCount?: number | null }>,
) {
	const formData = new FormData();
	formData.set("section", section);
	formData.set("datasetId", String(datasetId));

	for (const item of files) {
		formData.append("file", item.file);
		formData.append("partNo", String(item.partNo));
		formData.append("pageCount", item.pageCount == null ? "" : String(item.pageCount));
	}

	const response = await fetch(`${API_BASE_URL}/api/admin/import/pdfs`, {
		method: "POST",
		body: formData,
	});

	let body: ApiErrorBody | null = null;
	try {
		body = (await response.json()) as ApiErrorBody;
	} catch {
		// Keep generic error below.
	}

	if (!response.ok) {
		throw new Error(body?.message ?? body?.error ?? `PDF import failed (${response.status})`);
	}

	return body as {
		success: true;
		count: number;
		results: PdfImportResult[];
	};
}

export async function importAdminWorkbook(
	section: Section,
	datasetId: number,
	file: File,
) {
	const formData = new FormData();
	formData.set("section", section);
	formData.set("datasetId", String(datasetId));
	formData.set("file", file);

	const response = await fetch(`${API_BASE_URL}/api/admin/import/data`, {
		method: "POST",
		body: formData,
	});

	let body: ApiErrorBody | null = null;
	try {
		body = (await response.json()) as ApiErrorBody;
	} catch {
		// Keep the generic error below.
	}

	if (!response.ok) {
		if (body?.error === "IMPORT_VALIDATION_FAILED") {
			const details = Array.isArray(body.errors) ? body.errors : [];
			const first = details[0]?.message ?? body.message ?? "XLSX validation failed.";
			throw new Error(`${first}${body.errorCount ? ` (${body.errorCount} validation error(s))` : ""}`);
		}
		throw new Error(body?.message ?? `Import failed (${response.status})`);
	}

	return body?.result as ImportResult;
}

export interface ContactRequest {
	type: "hide" | "error";
	epic: string;
	name: string;
	contact: string;
	message: string;
	turnstileToken: string;
}

/** Public contact form → Worker → Telegram. */
export async function sendContact(input: ContactRequest): Promise<void> {
	const response = await fetch(`${API_BASE_URL}/api/contact`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		let message = `Could not send (${response.status})`;
		try {
			const body = (await response.json()) as ApiErrorBody;
			if (body?.message) message = body.message;
		} catch {
			// Keep generic message.
		}
		throw new Error(message);
	}
}

export interface HiddenEpic {
	epic_no: string;
	note: string | null;
	created_at: string;
}

async function adminJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_BASE_URL}${path}`, init);
	const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
	if (!response.ok) throw new Error(body?.message ?? `Request failed (${response.status})`);
	return body as T;
}

export function getHiddenEpics() {
	return adminJson<{ hidden: HiddenEpic[] }>("/api/admin/hidden");
}

export function hideEpic(epic: string, note: string) {
	return adminJson<{ success: true; epic: string }>("/api/admin/hidden", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ epic, note }),
	});
}

export function unhideEpic(epic: string) {
	return adminJson<{ success: true; epic: string }>(`/api/admin/hidden/${encodeURIComponent(epic)}`, { method: "DELETE" });
}
