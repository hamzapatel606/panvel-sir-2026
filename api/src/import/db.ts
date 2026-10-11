import { getDatabase as getSectionDatabase, getTable } from "../sections";
import type { ImportSection } from "./types";

export function getDatabase(env: Env, section: ImportSection): D1Database {
	return getSectionDatabase(env, section);
}

export interface DatasetVersion {
	datasetId: number;
	versionCode: string;
	versionName: string;
	status: "ACTIVE" | "ARCHIVED";
}

export interface Part {
	partId: number;
	datasetId: number;
	partNo: number;
	partName: string | null;
	recordCount: number;
	status: "NO_DATA" | "PREPARING" | "READY" | "ERROR";
}

export async function getActiveVersion(
	db: D1Database,
): Promise<DatasetVersion | null> {
	return await db
		.prepare(
			`
			SELECT
				dataset_id,
				version_code,
				version_name,
				status
			FROM dataset_versions
			WHERE status = 'ACTIVE'
			LIMIT 1
			`,
		)
		.first<{
			dataset_id: number;
			version_code: string;
			version_name: string;
			status: "ACTIVE" | "ARCHIVED";
		}>()
		.then((row) => {
			if (!row) {
				return null;
			}

			return {
				datasetId: row.dataset_id,
				versionCode: row.version_code,
				versionName: row.version_name,
				status: row.status,
			};
		});
}

export async function getPart(
	db: D1Database,
	datasetId: number,
	partNo: number,
): Promise<Part | null> {
	return await db
		.prepare(
			`
			SELECT
				part_id,
				dataset_id,
				part_no,
				part_name,
				record_count,
				status
			FROM parts
			WHERE dataset_id = ?
			  AND part_no = ?
			LIMIT 1
			`,
		)
		.bind(datasetId, partNo)
		.first<{
			part_id: number;
			dataset_id: number;
			part_no: number;
			part_name: string | null;
			record_count: number;
			status: "NO_DATA" | "PREPARING" | "READY" | "ERROR";
		}>()
		.then((row) => {
			if (!row) {
				return null;
			}

			return {
				partId: row.part_id,
				datasetId: row.dataset_id,
				partNo: row.part_no,
				partName: row.part_name,
				recordCount: row.record_count,
				status: row.status,
			};
		});
}
export async function preparePart(
	db: D1Database,
	datasetId: number,
	partNo: number,
	partName: string | null,
): Promise<Part> {
	const existing = await getPart(
		db,
		datasetId,
		partNo,
	);

	if (existing) {
		if (existing.status === "READY") {
			throw new Error(
				`Part ${partNo} already contains READY data. Create/import a new dataset version instead of overwriting it.`,
			);
		}

		if (existing.status === "PREPARING") {
			throw new Error(
				`Part ${partNo} is already being imported.`,
			);
		}

		if (existing.status === "ERROR") {
			throw new Error(
				`Part ${partNo} is in ERROR state. Clean up the failed data import before retrying.`,
			);
		}

		if (existing.status === "NO_DATA") {
			await db
				.prepare(
					`
					UPDATE parts
					SET
						part_name = ?,
						record_count = 0,
						status = 'PREPARING'
					WHERE part_id = ?
					  AND status = 'NO_DATA'
					`,
				)
				.bind(
					partName,
					existing.partId,
				)
				.run();

			const prepared = await getPart(
				db,
				datasetId,
				partNo,
			);

			if (!prepared) {
				throw new Error(
					`Part ${partNo} disappeared after preparation`,
				);
			}

			return prepared;
		}
	}

	const result = await db
		.prepare(
			`
			INSERT INTO parts (
				dataset_id,
				part_no,
				part_name,
				record_count,
				status
			)
			VALUES (?, ?, ?, 0, 'PREPARING')
			`,
		)
		.bind(
			datasetId,
			partNo,
			partName,
		)
		.run();

	const partId = result.meta.last_row_id;

	const created = await getPart(
		db,
		datasetId,
		partNo,
	);

	if (!created) {
		throw new Error(
			`Failed to create Part ${partNo} (ID ${partId})`,
		);
	}

	return created;
}
export async function ensurePartForPdf(
	db: D1Database,
	datasetId: number,
	partNo: number,
	partName: string | null,
): Promise<Part> {
	const existing = await getPart(
		db,
		datasetId,
		partNo,
	);

	if (existing) {
		return existing;
	}

	const result = await db
		.prepare(
			`
			INSERT INTO parts (
				dataset_id,
				part_no,
				part_name,
				record_count,
				status
			)
			VALUES (?, ?, ?, 0, 'NO_DATA')
			`,
		)
		.bind(
			datasetId,
			partNo,
			partName,
		)
		.run();

	const partId = result.meta.last_row_id;

	const created = await getPart(
		db,
		datasetId,
		partNo,
	);

	if (!created) {
		throw new Error(
			`Failed to create PDF-only Part ${partNo} (ID ${partId})`,
		);
	}

	return created;
}

export async function markPartReady(
	db: D1Database,
	partId: number,
	recordCount: number,
): Promise<Part> {
	if (recordCount < 0) {
		throw new Error(
			`Invalid record count: ${recordCount}`,
		);
	}

	await db
		.prepare(
			`
			UPDATE parts
			SET
				record_count = ?,
				status = 'READY'
			WHERE part_id = ?
			  AND status = 'PREPARING'
			`,
		)
		.bind(recordCount, partId)
		.run();

	const row = await db
		.prepare(
			`
			SELECT
				part_id,
				dataset_id,
				part_no,
				part_name,
				record_count,
				status
			FROM parts
			WHERE part_id = ?
			`,
		)
		.bind(partId)
		.first<{
			part_id: number;
			dataset_id: number;
			part_no: number;
			part_name: string | null;
			record_count: number;
			status: "NO_DATA" | "PREPARING" | "READY" | "ERROR";
		}>();

	if (!row) {
		throw new Error(
			`Part ${partId} not found while marking READY`,
		);
	}

	if (row.status !== "READY") {
		throw new Error(
			`Part ${partId} could not be marked READY`,
		);
	}

	return {
		partId: row.part_id,
		datasetId: row.dataset_id,
		partNo: row.part_no,
		partName: row.part_name,
		recordCount: row.record_count,
		status: row.status,
	};
}
export async function markPartError(
	db: D1Database,
	partId: number,
): Promise<void> {
	await db
		.prepare(
			`
			UPDATE parts
			SET status = 'ERROR'
			WHERE part_id = ?
			  AND status = 'PREPARING'
			`,
		)
		.bind(partId)
		.run();
}
export async function cleanupFailedPart(
	db: D1Database,
	section: ImportSection,
	partId: number,
): Promise<void> {
	const part = await db
		.prepare(
			`
			SELECT status
			FROM parts
			WHERE part_id = ?
			`,
		)
		.bind(partId)
		.first<{
			status: "NO_DATA" | "PREPARING" | "READY" | "ERROR";
		}>();

	if (!part) {
		throw new Error(
			`Part ${partId} not found`,
		);
	}

	if (part.status !== "ERROR") {
		throw new Error(
			`Part ${partId} cannot be cleaned up because its status is ${part.status}`,
		);
	}

	const recordTable = getTable(section).table;

	const pdf = await db
		.prepare(
			`
			SELECT pdf_id
			FROM pdf_documents
			WHERE part_id = ?
			LIMIT 1
			`,
		)
		.bind(partId)
		.first<{
			pdf_id: number;
		}>();

	const statements: D1PreparedStatement[] = [];

	// Remove records created by the failed Excel import.
	statements.push(
		db
			.prepare(
				`
				DELETE FROM ${recordTable}
				WHERE part_id = ?
				`,
			)
			.bind(partId),
	);

	// Remove source files belonging to this Part only when
	// they are not referenced by a PDF document.
	statements.push(
		db
			.prepare(
				`
				DELETE FROM source_files
				WHERE part_id = ?
				  AND source_file_id NOT IN (
						SELECT source_file_id
						FROM pdf_documents
						WHERE part_id = ?
						  AND source_file_id IS NOT NULL
				  )
				`,
			)
			.bind(partId, partId),
	);

	if (pdf) {
		// Keep the Part because its PDF exists independently.
		// It becomes available again for a future Excel import.
		statements.push(
			db
				.prepare(
					`
					UPDATE parts
					SET
						record_count = 0,
						status = 'NO_DATA'
					WHERE part_id = ?
					  AND status = 'ERROR'
					`,
				)
				.bind(partId),
		);
	} else {
		// No independent PDF exists, so the failed Part itself
		// can be removed.
		statements.push(
			db
				.prepare(
					`
					DELETE FROM parts
					WHERE part_id = ?
					  AND status = 'ERROR'
					`,
				)
				.bind(partId),
		);
	}

	await db.batch(statements);
}
export interface SourceFile {
	sourceFileId: number;
	datasetId: number;
	partId: number | null;
	fileName: string;
	fileType: string;
	fileSize: number | null;
	checksum: string | null;
}

export async function createSourceFile(
	db: D1Database, datasetId: number, partId: number | null, fileName: string, fileType: string,
	fileSize: number | null = null, checksum: string | null = null,
): Promise<SourceFile> {
	const row = await db.prepare(`
		INSERT INTO source_files (dataset_id, part_id, file_name, file_type, file_size, checksum, imported_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		RETURNING source_file_id, dataset_id, part_id, file_name, file_type, file_size, checksum
	`).bind(datasetId, partId, fileName, fileType, fileSize, checksum, new Date().toISOString()).first<any>();
	if (!row) throw new Error(`Failed to create source file record for "${fileName}"`);
	return { sourceFileId: row.source_file_id, datasetId: row.dataset_id, partId: row.part_id, fileName: row.file_name, fileType: row.file_type, fileSize: row.file_size, checksum: row.checksum };
}
export interface PdfDocument {
	pdfId: number;
	partId: number;
	sourceFileId: number | null;
	r2Key: string;
	fileName: string;
	fileSize: number;
	pageCount: number | null;
	checksum: string | null;
	status: "READY" | "ERROR";
}

export async function getCurrentPdf(db: D1Database, partId: number): Promise<PdfDocument | null> {
	const row = await db.prepare(`SELECT pdf_id, part_id, source_file_id, r2_key, file_name, file_size, page_count, checksum, status FROM pdf_documents WHERE part_id = ? AND status = 'READY' ORDER BY pdf_id DESC LIMIT 1`).bind(partId).first<any>();
	if (!row) return null;
	return { pdfId: row.pdf_id, partId: row.part_id, sourceFileId: row.source_file_id, r2Key: row.r2_key, fileName: row.file_name, fileSize: row.file_size, pageCount: row.page_count === 0 ? null : row.page_count, checksum: row.checksum, status: row.status };
}

export async function createPdfDocument(
	db: D1Database, partId: number, sourceFileId: number | null, r2Key: string, fileName: string,
	fileSize: number, pageCount: number | null, checksum: string | null = null,
): Promise<PdfDocument> {
	if (pageCount !== null && (!Number.isInteger(pageCount) || pageCount < 1)) throw new Error(`Invalid PDF page count: ${pageCount}`);
	if (fileSize < 0) throw new Error(`Invalid PDF file size: ${fileSize}`);
	const row = await db.prepare(`
		INSERT INTO pdf_documents (part_id, source_file_id, r2_key, file_name, file_size, page_count, checksum, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'READY')
		RETURNING pdf_id, part_id, source_file_id, r2_key, file_name, file_size, page_count, checksum, status
	`).bind(partId, sourceFileId, r2Key, fileName, fileSize, pageCount ?? 0, checksum).first<any>(); // page_count is NOT NULL: 0 = unknown (see migration 0008)
	if (!row) throw new Error(`Failed to create PDF metadata for "${fileName}"`);
	return { pdfId: row.pdf_id, partId: row.part_id, sourceFileId: row.source_file_id, r2Key: row.r2_key, fileName: row.file_name, fileSize: row.file_size, pageCount: row.page_count === 0 ? null : row.page_count, checksum: row.checksum, status: row.status };
}

import type {
	NormalizedAsddRecord,
	NormalizedDraftRecord,
} from "./types";

export async function insertDraftRecords(
	db: D1Database,
	records: NormalizedDraftRecord[],
	partId: number,
	pdfId: number | null,
	sourceFileId: number,
): Promise<number> {
	const statements = records.map((record) =>
		db
			.prepare(
				`
				INSERT INTO draft_records (
					part_id,
					sr_no,
					epic_no,
					name,
					relation_type,
					relative_name,
					house_number,
					age,
					gender,
					pdf_id,
					pdf_page,
					pdf_box,
					grid_row,
					grid_col,
					source_file_id
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`,
			)
			.bind(
				partId,
				record.srNo,
				record.epicNo,
				record.name,
				record.relationType,
				record.relativeName,
				record.houseNumber,
				record.age,
				record.gender,
				pdfId,
				record.pdfPage,
				record.pdfBox,
				record.gridRow,
				record.gridCol,
				sourceFileId,
			),
	);

	return executeBatches(db, statements);
}

export async function insertAsddRecords(
	db: D1Database,
	records: NormalizedAsddRecord[],
	partId: number,
	pdfId: number | null,
	sourceFileId: number,
): Promise<number> {
	const statements = records.map((record) =>
		db
			.prepare(
				`
				INSERT INTO asdd_records (
					part_id,
					serial_no,
					epic_no,
					name,
					relative_details_raw,
					relative_name,
					relation_type,
					age,
					reference_epic,
					uncollectable_reason_raw,
					uncollectable_reason_code,
					pdf_id,
					pdf_page,
					pdf_box,
					source_file_id
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`,
			)
			.bind(
				partId,
				record.serialNo,
				record.epicNo,
				record.name,
				record.relativeDetailsRaw,
				record.relativeName,
				record.relationType,
				record.age,
				record.referenceEpic,
				record.uncollectableReasonRaw,
				record.uncollectableReasonCode,
				pdfId,
				record.pdfPage,
				record.pdfBox,
				sourceFileId,
			),
	);

	return executeBatches(db, statements);
}

/** Runs statements in batches of 250. Returns D1's count of rows written (incl. index + search rows). */
async function executeBatches(
	db: D1Database,
	statements: D1PreparedStatement[],
): Promise<number> {
	const BATCH_SIZE = 250;
	let rowsWritten = 0;

	for (let start = 0; start < statements.length; start += BATCH_SIZE) {
		const results = await db.batch(statements.slice(start, start + BATCH_SIZE));
		for (const result of results) rowsWritten += result.meta?.rows_written ?? 0;
	}

	return rowsWritten;
}
