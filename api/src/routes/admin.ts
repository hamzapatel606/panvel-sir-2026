// Admin routes: imports, PDFs, dataset versions, usage.
// Served only by the admin Worker (src/admin-worker.ts), behind Cloudflare Access.
import { getR2Usage } from "../admin-usage";
import { errorMessage, json } from "../http";
import { uploadAndAttachPdf } from "../import/pdf-service";
import { ImportValidationError, importWorkbook } from "../import/service";
import { getDatabase, isSection, SECTION_KEYS } from "../sections";

const INVALID_SECTION = {
	error: "INVALID_SECTION",
	message: `Section must be one of: ${SECTION_KEYS.join(", ")}.`,
};

export function isAdminPath(url: URL): boolean {
	return url.pathname.startsWith("/api/admin/");
}

function safeFileName(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function handleAdminRoute(request: Request, env: Env, url: URL): Promise<Response> {
	const { pathname } = url;
	const method = request.method;

	if (method === "POST" && pathname === "/api/admin/import/data") return importData(request, env);
	if (method === "POST" && pathname === "/api/admin/import/pdfs") return importPdfs(request, env);
	if (method === "POST" && pathname === "/api/admin/import/pdf") return importSinglePdf(request, env);

	if (method === "GET" && pathname === "/api/admin/usage") {
		try {
			return json(await getR2Usage(env));
		} catch (error) {
			return json({ error: "USAGE_UNAVAILABLE", message: errorMessage(error, "Cloudflare usage unavailable.") }, { status: 503 });
		}
	}

	if (pathname === "/api/admin/hidden" && method === "GET") return listHidden(env);
	if (pathname === "/api/admin/hidden" && method === "POST") return addHidden(request, env);
	const hiddenMatch = pathname.match(/^\/api\/admin\/hidden\/([A-Za-z0-9/%]+)$/);
	if (hiddenMatch && method === "DELETE") return removeHidden(env, decodeURIComponent(hiddenMatch[1]));

	const datasetMatch = pathname.match(/^\/api\/admin\/([a-z]+)\/datasets(?:\/(\d+)\/activate)?$/);
	if (datasetMatch) {
		if (!isSection(datasetMatch[1])) return json(INVALID_SECTION, { status: 400 });
		return datasets(request, env, datasetMatch[1], datasetMatch[2] ? Number(datasetMatch[2]) : null);
	}

	return json({ error: "NOT_FOUND", message: "Unknown admin route." }, { status: 404 });
}

async function importData(request: Request, env: Env): Promise<Response> {
	try {
		const formData = await request.formData();
		const section = formData.get("section");
		const datasetId = Number(formData.get("datasetId"));
		const file = formData.get("file");

		if (!isSection(section)) return json(INVALID_SECTION, { status: 400 });
		if (!Number.isInteger(datasetId) || datasetId < 1) {
			return json({ error: "INVALID_DATASET_ID", message: "datasetId must be a positive integer." }, { status: 400 });
		}
		if (!(file instanceof File)) return json({ error: "FILE_REQUIRED", message: "An XLSX file is required." }, { status: 400 });

		const result = await importWorkbook(env, {
			section,
			datasetId,
			xlsxBuffer: await file.arrayBuffer(),
			sourceFile: {
				fileName: file.name,
				fileType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				fileSize: file.size,
			},
		});
		return json({ success: true, result }, { status: 201 });
	} catch (error) {
		if (error instanceof ImportValidationError) {
			return json(
				{
					error: "IMPORT_VALIDATION_FAILED",
					message: "No database writes were made because validation failed.",
					errors: error.validation.errors.slice(0, 200),
					errorCount: error.validation.errors.length,
					warnings: error.validation.warnings,
				},
				{ status: 422 },
			);
		}
		return json({ error: "IMPORT_FAILED", message: errorMessage(error, "Unable to import XLSX data.") }, { status: 400 });
	}
}

async function importPdfs(request: Request, env: Env): Promise<Response> {
	try {
		const formData = await request.formData();
		const section = formData.get("section");
		const datasetId = Number(formData.get("datasetId"));
		if (!isSection(section)) return json(INVALID_SECTION, { status: 400 });
		if (!Number.isInteger(datasetId) || datasetId < 1) return json({ error: "INVALID_DATASET_ID" }, { status: 400 });

		const files = formData.getAll("file").filter((v): v is File => v instanceof File);
		if (!files.length) return json({ error: "FILE_REQUIRED", message: "At least one PDF file is required." }, { status: 400 });
		if (files.length > 20) return json({ error: "TOO_MANY_FILES", message: "Maximum 20 PDFs per request." }, { status: 400 });

		const partNos = formData.getAll("partNo").map((v) => Number(v));
		const pageCountsRaw = formData.getAll("pageCount");
		if (partNos.length && partNos.length !== files.length) {
			return json({ error: "PART_COUNT_MISMATCH", message: "Provide one partNo per file, or omit partNo fields and use Part_N.pdf filenames." }, { status: 400 });
		}
		if (pageCountsRaw.length && pageCountsRaw.length !== files.length) {
			return json({ error: "PAGE_COUNT_MISMATCH", message: "Provide one pageCount per file, or leave each pageCount blank." }, { status: 400 });
		}

		const pageCounts = files.map((_, i) => {
			const raw = pageCountsRaw.length ? String(pageCountsRaw[i] ?? "").trim() : "";
			if (!raw) return null;
			const value = Number(raw);
			return Number.isInteger(value) && value >= 1 ? value : NaN;
		});
		if (pageCounts.some((value) => Number.isNaN(value))) {
			return json({ error: "INVALID_PAGE_COUNT", message: "Page Count must be a positive integer when supplied. Leave it blank if unknown." }, { status: 400 });
		}

		const resolved = files.map((file, i) => {
			const supplied = partNos.length ? partNos[i] : null;
			const match = file.name.match(/(?:^|[^0-9])part[_ -]?(\d+)(?:[^0-9]|$)/i);
			const partNo = supplied ?? (match ? Number(match[1]) : NaN);
			return { file, partNo, pageCount: pageCounts[i] };
		});
		if (resolved.some((x) => !Number.isInteger(x.partNo) || x.partNo < 1)) {
			return json({ error: "PART_NO_REQUIRED", message: "Each PDF needs a valid partNo or a filename containing Part_123." }, { status: 400 });
		}

		const results = [];
		for (const { file, partNo, pageCount } of resolved) {
			results.push(
				await uploadAndAttachPdf(
					env,
					{
						section,
						datasetId,
						partNo,
						partName: null,
						sourceFile: { fileName: file.name, fileType: file.type || "application/pdf", fileSize: file.size },
						pdf: {
							r2Key: `pdf/${section}/dataset-${datasetId}/part-${partNo}/pdf-${crypto.randomUUID()}-${safeFileName(file.name)}`,
							fileName: file.name,
							fileSize: file.size,
							pageCount,
						},
					},
					await file.arrayBuffer(),
				),
			);
		}
		return json({ success: true, count: results.length, results }, { status: 201 });
	} catch (error) {
		return json({ error: "PDF_IMPORT_FAILED", message: errorMessage(error, "Unable to upload PDFs.") }, { status: 400 });
	}
}

async function importSinglePdf(request: Request, env: Env): Promise<Response> {
	try {
		const formData = await request.formData();
		const section = formData.get("section");
		const datasetId = Number(formData.get("datasetId"));
		const partNo = Number(formData.get("partNo"));
		const partNameValue = formData.get("partName");
		const pageCountValue = formData.get("pageCount");
		const file = formData.get("file");
		const pageCount = pageCountValue === null || String(pageCountValue).trim() === "" ? null : Number(pageCountValue);

		if (!isSection(section)) return json(INVALID_SECTION, { status: 400 });
		if (!Number.isInteger(datasetId) || datasetId < 1) {
			return json({ error: "INVALID_DATASET_ID", message: "datasetId must be a positive integer." }, { status: 400 });
		}
		if (!Number.isInteger(partNo) || partNo < 1) {
			return json({ error: "INVALID_PART_NO", message: "partNo must be a positive integer." }, { status: 400 });
		}
		if (pageCount !== null && (!Number.isInteger(pageCount) || pageCount < 1)) {
			return json({ error: "INVALID_PAGE_COUNT", message: "pageCount must be a positive integer when supplied." }, { status: 400 });
		}
		if (!(file instanceof File)) return json({ error: "FILE_REQUIRED", message: "A PDF file is required." }, { status: 400 });

		const result = await uploadAndAttachPdf(
			env,
			{
				section,
				datasetId,
				partNo,
				partName: typeof partNameValue === "string" ? partNameValue.trim() || null : null,
				sourceFile: { fileName: file.name, fileType: file.type || "application/pdf", fileSize: file.size },
				pdf: {
					r2Key: `pdf/${section}/dataset-${datasetId}/part-${partNo}/pdf-${crypto.randomUUID()}-${safeFileName(file.name)}`,
					fileName: file.name,
					fileSize: file.size,
					pageCount,
				},
			},
			await file.arrayBuffer(),
		);
		return json({ success: true, result }, { status: 201 });
	} catch (error) {
		return json({ error: "PDF_IMPORT_FAILED", message: errorMessage(error, "Unable to upload PDF.") }, { status: 400 });
	}
}

async function datasets(request: Request, env: Env, section: (typeof SECTION_KEYS)[number], activateId: number | null): Promise<Response> {
	const db = getDatabase(env, section);
	try {
		if (request.method === "GET" && activateId === null) {
			const result = await db
				.prepare(`SELECT dataset_id, version_code, version_name, status, created_at FROM dataset_versions ORDER BY dataset_id DESC`)
				.all();
			return json({ section, datasets: result.results });
		}

		if (request.method === "POST" && activateId === null) {
			const body = await request.json<{ versionCode?: unknown; versionName?: unknown }>();
			const versionCode = typeof body?.versionCode === "string" ? body.versionCode.trim() : "";
			const versionName = typeof body?.versionName === "string" ? body.versionName.trim() : "";
			if (!versionCode || !versionName) return json({ error: "VERSION_FIELDS_REQUIRED" }, { status: 400 });
			const row = await db
				.prepare(
					`INSERT INTO dataset_versions (version_code, version_name, status, created_at)
					 VALUES (?, ?, 'ARCHIVED', ?)
					 RETURNING dataset_id, version_code, version_name, status, created_at`,
				)
				.bind(versionCode, versionName, new Date().toISOString())
				.first();
			return json({ success: true, dataset: row }, { status: 201 });
		}

		if (request.method === "POST" && activateId !== null) {
			const target = await db.prepare(`SELECT dataset_id FROM dataset_versions WHERE dataset_id = ? LIMIT 1`).bind(activateId).first();
			if (!target) return json({ error: "DATASET_NOT_FOUND" }, { status: 404 });
			await db.batch([
				db.prepare(`UPDATE dataset_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE' AND dataset_id <> ?`).bind(activateId),
				db.prepare(`UPDATE dataset_versions SET status = 'ACTIVE' WHERE dataset_id = ?`).bind(activateId),
			]);
			return json({ success: true, section, datasetId: activateId, status: "ACTIVE" });
		}

		return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
	} catch (error) {
		return json({ error: "DATASET_OPERATION_FAILED", message: errorMessage(error, "Dataset operation failed.") }, { status: 400 });
	}
}

// ------------------------------------------------------------
// Hidden EPICs (removal requests). Kept identical in all three
// databases so a hidden voter disappears from every list at once.
// ------------------------------------------------------------

function normalizeEpic(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const epic = value.trim().toUpperCase().replace(/\s+/g, "");
	return /^[A-Z0-9/]{6,20}$/.test(epic) ? epic : null;
}

async function listHidden(env: Env): Promise<Response> {
	try {
		const result = await getDatabase(env, "draft")
			.prepare(`SELECT epic_no, note, created_at FROM hidden_epics ORDER BY created_at DESC`)
			.all();
		return json({ hidden: result.results ?? [] });
	} catch (error) {
		return json({ error: "DATABASE_ERROR", message: errorMessage(error, "Unable to read hidden EPICs.") }, { status: 500 });
	}
}

async function addHidden(request: Request, env: Env): Promise<Response> {
	let body: { epic?: unknown; note?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: "INVALID_JSON", message: "Invalid request." }, { status: 400 });
	}
	const epic = normalizeEpic(body.epic);
	if (!epic) return json({ error: "INVALID_EPIC", message: "Enter a valid EPIC number." }, { status: 400 });
	const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : null;
	const now = new Date().toISOString();

	try {
		await Promise.all(
			SECTION_KEYS.map((key) =>
				getDatabase(env, key)
					.prepare(`INSERT INTO hidden_epics (epic_no, note, created_at) VALUES (?, ?, ?)
					          ON CONFLICT(epic_no) DO UPDATE SET note = excluded.note`)
					.bind(epic, note, now)
					.run(),
			),
		);
		return json({ success: true, epic });
	} catch (error) {
		return json({ error: "DATABASE_ERROR", message: errorMessage(error, "Unable to hide EPIC.") }, { status: 500 });
	}
}

async function removeHidden(env: Env, raw: string): Promise<Response> {
	const epic = normalizeEpic(raw);
	if (!epic) return json({ error: "INVALID_EPIC", message: "Invalid EPIC number." }, { status: 400 });
	try {
		await Promise.all(
			SECTION_KEYS.map((key) => getDatabase(env, key).prepare(`DELETE FROM hidden_epics WHERE epic_no = ?`).bind(epic).run()),
		);
		return json({ success: true, epic });
	} catch (error) {
		return json({ error: "DATABASE_ERROR", message: errorMessage(error, "Unable to unhide EPIC.") }, { status: 500 });
	}
}
