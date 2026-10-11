import { SECTIONS } from "../sections";
import { normalizeAsddRows, normalizeDraftRows } from "./normalize";
import type {
	ImportSection,
	ImportValidationResult,
	NormalizedAsddRecord,
	NormalizedDraftRecord,
} from "./types";
import { validateAsddRecords, validateDraftRecords } from "./validate";
import { parseXlsx } from "./xlsx";

function aggregateWarnings(warnings: ImportValidationResult["warnings"]): ImportValidationResult["warnings"] {
	const map = new Map<string, ImportValidationResult["warnings"][number]>();
	for (const warning of warnings) {
		const key = `${warning.code}|${warning.message}`;
		const existing = map.get(key);
		if (existing) existing.count = (existing.count ?? 1) + 1;
		else map.set(key, { ...warning, count: 1 });
	}
	return [...map.values()];
}

export interface ImportPipelineResult {
	section: ImportSection;
	sheetName: string;
	rowCount: number;
	records: NormalizedDraftRecord[] | NormalizedAsddRecord[];
	validation: ImportValidationResult;
}

/** Parses and validates a workbook. Final Draft uses the Draft column layout. */
export function processXlsx(buffer: ArrayBuffer, section: ImportSection): ImportPipelineResult {
	const workbook = parseXlsx(buffer);
	const kind = SECTIONS[section].kind;

	const normalized = kind === "draft" ? normalizeDraftRows(workbook.rows) : normalizeAsddRows(workbook.rows);
	const validation =
		kind === "draft"
			? validateDraftRecords(normalized.records as NormalizedDraftRecord[])
			: validateAsddRecords(normalized.records as NormalizedAsddRecord[]);

	return {
		section,
		sheetName: workbook.sheetName,
		rowCount: workbook.rows.length,
		records: normalized.records,
		validation: {
			valid: normalized.result.valid && validation.valid,
			warnings: aggregateWarnings([...normalized.result.warnings, ...validation.warnings]),
			errors: [...normalized.result.errors, ...validation.errors],
		},
	};
}
