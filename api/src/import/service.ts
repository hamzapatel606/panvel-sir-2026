import {
	createSourceFile,
	getCurrentPdf,
	getDatabase,
	insertAsddRecords,
	insertDraftRecords,
	markPartError,
	cleanupFailedPart,
	markPartReady,
	preparePart,
} from "./db";
import { getTable, SECTIONS } from "../sections";
import { processXlsx } from "./pipeline";
import type {
	ImportSection,
	NormalizedAsddRecord,
	NormalizedDraftRecord,
	ImportValidationResult,
} from "./types";

export interface ImportSourceInput {
	fileName: string;
	fileType: string;
	fileSize?: number | null;
	checksum?: string | null;
}
export interface ImportWorkbookInput {
	section: ImportSection;
	datasetId: number;
	xlsxBuffer: ArrayBuffer;
	sourceFile: ImportSourceInput;
}
export interface ImportPartResult {
	section: ImportSection;
	datasetId: number;
	partId: number;
	partNo: number;
	recordCount: number;
	status: "READY";
	warnings: number;
	pdfAttached: boolean;
	/** Rows D1 counted as written for this Part (table + indexes + search). Free plan: 100,000/day. */
	rowsWritten: number;
}
export interface ImportWorkbookResult {
	section: ImportSection;
	datasetId: number;
	fileName: string;
	totalRecords: number;
	parts: ImportPartResult[];
	warnings: ImportValidationResult["warnings"];
	/** Parts in the file that were already READY and were skipped (safe re-upload). */
	skippedParts: number[];
	/** Set when the import stopped part-way, e.g. the daily write limit ran out. Re-upload the same file to continue. */
	failedPart: { partNo: number; message: string } | null;
	/** Total rows written by this import. */
	rowsWritten: number;
	/** Average rows written per record, to plan how many records fit in a day. */
	rowsWrittenPerRecord: number;
}
export class ImportValidationError extends Error {
	constructor(public readonly validation: ImportValidationResult) {
		super("Import validation failed.");
		this.name = "ImportValidationError";
	}
}

export async function importWorkbook(env: Env, input: ImportWorkbookInput): Promise<ImportWorkbookResult> {
	const db = getDatabase(env, input.section);
	const pipelineResult = processXlsx(input.xlsxBuffer, input.section);
	if (!pipelineResult.validation.valid) throw new ImportValidationError(pipelineResult.validation);

	const dataset = await db.prepare(`SELECT dataset_id, status FROM dataset_versions WHERE dataset_id = ? LIMIT 1`)
		.bind(input.datasetId).first<{ dataset_id: number; status: "ACTIVE" | "ARCHIVED" }>();
	if (!dataset) {
		throw new Error(`Dataset ${input.datasetId} does not exist in the ${input.section} database.`);
	}

	// Both dataset states are supported, but they have different purposes:
	// ARCHIVED = prepare a future version privately; ACTIVE = append new
	// Parts to the currently published dataset. Existing READY Parts are
	// never overwritten by preparePart().
	if (dataset.status !== "ARCHIVED" && dataset.status !== "ACTIVE") {
		throw new Error(`Dataset ${input.datasetId} has an invalid status.`);
	}

	// Resumable: Parts already READY are skipped, and Parts left half-done by an
	// earlier failed upload (ERROR / PREPARING) are cleaned up and imported again.
	// So re-uploading the same 10-Part file after a failure continues where it stopped.
	const partNos = [...new Set(pipelineResult.records.map((record) => record.partNo))];
	const existing = await getPartStatuses(db, input.datasetId, partNos);
	const skippedParts = partNos.filter((partNo) => existing.get(partNo)?.status === "READY").sort((a, b) => a - b);
	for (const part of existing.values()) {
		if (part.status === "PREPARING") await markPartError(db, part.partId);
		if (part.status === "PREPARING" || part.status === "ERROR") {
			await cleanupFailedPart(db, input.section, part.partId);
		}
	}

	const records = pipelineResult.records.filter((record) => !skippedParts.includes(record.partNo));
	const emptyResult = (failedPart: ImportWorkbookResult["failedPart"] = null): ImportWorkbookResult => ({
		section: input.section,
		datasetId: input.datasetId,
		fileName: input.sourceFile.fileName,
		totalRecords: 0,
		parts: [],
		warnings: pipelineResult.validation.warnings,
		skippedParts,
		failedPart,
		rowsWritten: 0,
		rowsWrittenPerRecord: 0,
	});
	if (!records.length) return emptyResult();

	await validateExistingEpics(db, input.section, input.datasetId, records);

	const sourceFile = await createSourceFile(db, input.datasetId, null, input.sourceFile.fileName, input.sourceFile.fileType, input.sourceFile.fileSize ?? null, input.sourceFile.checksum ?? null);
	const groups = new Map<number, (NormalizedDraftRecord | NormalizedAsddRecord)[]>();
	for (const record of records) {
		const group = groups.get(record.partNo);
		if (group) group.push(record); else groups.set(record.partNo, [record]);
	}

	const results: ImportPartResult[] = [];
	let failedPart: ImportWorkbookResult["failedPart"] = null;
	const warningCount = pipelineResult.validation.warnings.reduce((n, w) => n + (w.count ?? 1), 0);
	for (const partNo of [...groups.keys()].sort((a, b) => a - b)) {
		try {
			results.push(await importSinglePart(env, db, input, partNo, groups.get(partNo)!, warningCount, sourceFile.sourceFileId));
		} catch (error) {
			// Stop at the first failure; finished Parts stay READY.
			failedPart = { partNo, message: error instanceof Error ? error.message : "Import failed." };
			break;
		}
	}

	const rowsWritten = results.reduce((sum, part) => sum + part.rowsWritten, 0);
	const totalRecords = results.reduce((sum, part) => sum + part.recordCount, 0);
	return {
		section: input.section,
		datasetId: input.datasetId,
		fileName: input.sourceFile.fileName,
		totalRecords,
		parts: results,
		warnings: pipelineResult.validation.warnings,
		skippedParts,
		failedPart,
		rowsWritten,
		rowsWrittenPerRecord: totalRecords ? Math.round((rowsWritten / totalRecords) * 10) / 10 : 0,
	};
}

async function getPartStatuses(
	db: D1Database,
	datasetId: number,
	partNos: number[],
): Promise<Map<number, { partId: number; status: string }>> {
	const map = new Map<number, { partId: number; status: string }>();
	for (let start = 0; start < partNos.length; start += 90) {
		const chunk = partNos.slice(start, start + 90);
		const rows = await db
			.prepare(`SELECT part_id, part_no, status FROM parts WHERE dataset_id = ? AND part_no IN (${chunk.map(() => "?").join(",")})`)
			.bind(datasetId, ...chunk)
			.all<{ part_id: number; part_no: number; status: string }>();
		for (const row of rows.results) map.set(row.part_no, { partId: row.part_id, status: row.status });
	}
	return map;
}

async function importSinglePart(
	env: Env, db: D1Database, input: ImportWorkbookInput, partNo: number,
	records: (NormalizedDraftRecord | NormalizedAsddRecord)[], warnings: number, sourceFileId: number,
): Promise<ImportPartResult> {
	let partId: number | null = null;
	try {
		const part = await preparePart(db, input.datasetId, partNo, null);
		partId = part.partId;
		const currentPdf = await getCurrentPdf(db, partId);
		const pdfId = currentPdf?.pdfId ?? null;

		const rowsWritten =
			SECTIONS[input.section].kind === "draft"
				? await insertDraftRecords(db, records as NormalizedDraftRecord[], partId, pdfId, sourceFileId)
				: await insertAsddRecords(db, records as NormalizedAsddRecord[], partId, pdfId, sourceFileId);
		const readyPart = await markPartReady(db, partId, records.length);
		return { section: input.section, datasetId: readyPart.datasetId, partId: readyPart.partId, partNo: readyPart.partNo, recordCount: readyPart.recordCount, status: "READY", warnings, pdfAttached: Boolean(pdfId), rowsWritten };
	} catch (error) {
		if (partId !== null) {
			try { await markPartError(db, partId); await cleanupFailedPart(db, input.section, partId); } catch {}
		}
		throw error;
	}
}

/**
 * Rejects the import if any EPIC already exists in this dataset.
 *
 * Reads only matching rows: the query filters on epic_no alone, so D1 must use the
 * epic_no index (INDEXED BY). The dataset check happens in code. v4's version also
 * filtered by part_id in SQL, which let the live database pick a full table scan:
 * ~3M rows read for one 10-Part import (free plan: 5M rows read/day).
 */
async function validateExistingEpics(db: D1Database, section: ImportSection, datasetId: number, records: (NormalizedDraftRecord | NormalizedAsddRecord)[]): Promise<void> {
	if (!records.length) return;
	const { table, epicIndex } = getTable(section);
	const partRows = await db
		.prepare(`SELECT part_id FROM parts WHERE dataset_id = ?`)
		.bind(datasetId)
		.all<{ part_id: number }>();
	const datasetPartIds = new Set(partRows.results.map((row) => row.part_id));
	if (!datasetPartIds.size) return;

	const epics = [...new Set(records.map((r) => r.epicNo.trim()))];
	for (let start = 0; start < epics.length; start += 90) {
		const chunk = epics.slice(start, start + 90);
		const placeholders = chunk.map(() => "?").join(",");
		const rows = await db
			.prepare(`SELECT epic_no, part_id FROM ${table} INDEXED BY ${epicIndex} WHERE epic_no COLLATE NOCASE IN (${placeholders})`)
			.bind(...chunk)
			.all<{ epic_no: string; part_id: number }>();
		const clash = rows.results.find((row) => datasetPartIds.has(row.part_id));
		if (clash) throw new Error(`Duplicate EPIC "${clash.epic_no}" already exists in dataset ${datasetId}.`);
	}
}
