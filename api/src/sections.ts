// ============================================================
// SIR Panvel API — single source of truth for the public lists.
//
// To add or remove a list, change THIS file only.
// "final" reuses the Draft table layout (draft_records) in its own
// D1 database, so no new schema or query code is needed for it.
// ============================================================

export const SECTION_KEYS = ["draft", "final", "asdd"] as const;
export type Section = (typeof SECTION_KEYS)[number];

/** Table layout a list uses. Final Draft uses the Draft layout. */
export type RecordKind = "draft" | "asdd";

export function isSection(value: unknown): value is Section {
	return typeof value === "string" && (SECTION_KEYS as readonly string[]).includes(value);
}

export interface SectionConfig {
	key: Section;
	label: string;
	kind: RecordKind;
	db: (env: Env) => D1Database;
}

export const SECTIONS: Record<Section, SectionConfig> = {
	draft: { key: "draft", label: "Draft", kind: "draft", db: (env) => env.DRAFT_DB },
	final: { key: "final", label: "Final Draft", kind: "draft", db: (env) => env.FINAL_DB },
	asdd: { key: "asdd", label: "ASDD", kind: "asdd", db: (env) => env.ASDD_DB },
};

export function getDatabase(env: Env, section: Section): D1Database {
	return SECTIONS[section].db(env);
}

// ------------------------------------------------------------
// Table layouts
// ------------------------------------------------------------

/**
 * How one search field maps to SQL.
 * - fts: full-text (prefix) match on one FTS column, or all FTS columns when column is null
 * - eq:  exact match on a table column
 * - needsPart: the column has no index, so the search must be limited to one
 *   Part (~1,000 rows) instead of scanning the whole list.
 */
export type FieldSpec =
	| { type: "fts"; column: string | null; needsPart?: boolean }
	| { type: "eq"; column: string; numeric?: boolean; nocase?: boolean; needsPart?: boolean };

export interface TableConfig {
	table: string;
	ftsTable: string;
	idColumn: string;
	serialColumn: string;
	/** Index on epic_no COLLATE NOCASE, forced with INDEXED BY so EPIC lookups never scan the table. */
	epicIndex: string;
	/** Index on (part_id, serial, id), forced when browsing/searching inside one Part. */
	partIndex: string;
	selectColumns: string[];
	fields: Record<string, FieldSpec>;
}

export const TABLES: Record<RecordKind, TableConfig> = {
	draft: {
		table: "draft_records",
		ftsTable: "draft_records_fts",
		idColumn: "draft_record_id",
		serialColumn: "sr_no",
		epicIndex: "idx_draft_epic_nocase",
		partIndex: "idx_draft_part_serial",
		selectColumns: [
			"draft_record_id", "part_id", "sr_no", "epic_no", "name",
			"relation_type", "relative_name", "house_number", "age", "gender",
			"pdf_id", "pdf_page", "pdf_box", "grid_row", "grid_col", "source_file_id",
		],
		fields: {
			serial: { type: "eq", column: "sr_no", numeric: true, needsPart: true },
			epic: { type: "eq", column: "epic_no", nocase: true },
			name: { type: "fts", column: "name" },
			relative: { type: "fts", column: "relative_name" },
			relation: { type: "eq", column: "relation_type", nocase: true, needsPart: true },
			house: { type: "eq", column: "house_number", nocase: true, needsPart: true },
			age: { type: "eq", column: "age", numeric: true, needsPart: true },
			gender: { type: "eq", column: "gender", nocase: true, needsPart: true },
		},
	},
	asdd: {
		table: "asdd_records",
		ftsTable: "asdd_records_fts",
		idColumn: "asdd_record_id",
		serialColumn: "serial_no",
		epicIndex: "idx_asdd_epic_nocase",
		partIndex: "idx_asdd_part_serial",
		selectColumns: [
			"asdd_record_id", "part_id", "serial_no", "epic_no", "name",
			"relative_details_raw", "relative_name", "relation_type", "age",
			"reference_epic", "uncollectable_reason_raw", "uncollectable_reason_code",
			"pdf_id", "pdf_page", "pdf_box", "source_file_id",
		],
		fields: {
			serial: { type: "eq", column: "serial_no", numeric: true, needsPart: true },
			epic: { type: "eq", column: "epic_no", nocase: true },
			name: { type: "fts", column: "name" },
			relative: { type: "fts", column: "relative_name" },
			relation: { type: "eq", column: "relation_type", nocase: true },
			age: { type: "eq", column: "age", numeric: true },
			referenceEpic: { type: "eq", column: "reference_epic", nocase: true },
			reason: { type: "fts", column: "reason" },
		},
	},
};

export function getTable(section: Section): TableConfig {
	return TABLES[SECTIONS[section].kind];
}

/** Search fields a list accepts, including the smart "all" field. */
export function getSearchFields(section: Section): string[] {
	return ["all", ...Object.keys(getTable(section).fields)];
}

/**
 * The "all" field picks ONE indexed strategy from the shape of the query,
 * instead of OR-ing every column (which forced a full table scan):
 * - letters + digits, no spaces  -> EPIC
 * - digits only                  -> Serial No
 * - anything else                -> name / relative (/ reason) full-text
 */
export function resolveAllField(query: string, table: TableConfig): FieldSpec {
	if (/^\d+$/.test(query)) return { type: "eq", column: table.serialColumn, numeric: true, needsPart: true };
	if (/^[A-Za-z0-9/]+$/.test(query) && /\d/.test(query) && /[A-Za-z]/.test(query)) {
		return { type: "eq", column: "epic_no", nocase: true };
	}
	return { type: "fts", column: null };
}
