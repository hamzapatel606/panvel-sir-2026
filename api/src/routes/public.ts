// Public read-only routes. One implementation serves every list in sections.ts.
import { decodeCursor, encodeCursor, json } from "../http";
import { checkQuery } from "../security";
import { buildFtsQuery } from "../searchText";
import {
	getDatabase,
	getSearchFields,
	getTable,
	isSection,
	resolveAllField,
	type FieldSpec,
	type Section,
	type TableConfig,
} from "../sections";

interface ActiveVersion {
	dataset_id: number;
	version_code: string;
	version_name: string;
	status: "ACTIVE";
	created_at: string;
}

const SECTION_PATTERN = /^\/api\/([a-z]+)\/(version|parts|search|by-epic\/[^/]+|records\/\d+)$/;

interface PartRow {
	part_id: number;
	part_no: number;
	part_name: string | null;
	record_count: number;
	status: string;
}

// Short in-memory cache for data that only changes when the admin imports or
// publishes: the active version and the Parts list. Saves 1–2 database calls on
// every search and the Parts query on every page view. Each Worker instance keeps
// its own copy for MEMO_TTL_MS; admin changes clear it (clearPublicCache).
const MEMO_TTL_MS = 60_000;
const memo = new Map<string, { expires: number; value: Promise<unknown> }>();

function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const hit = memo.get(key);
	if (hit && hit.expires > now) return hit.value as Promise<T>;
	const value = load().catch((error) => {
		memo.delete(key); // never keep a failure
		throw error;
	});
	memo.set(key, { expires: now + MEMO_TTL_MS, value });
	return value;
}

/** Called after admin imports/publishing so this instance serves fresh data at once. */
export function clearPublicCache(): void {
	memo.clear();
}

function getActiveVersion(db: D1Database, section: Section): Promise<ActiveVersion | null> {
	return remember(`${section}:version`, () =>
		db
			.prepare(
				`SELECT dataset_id, version_code, version_name, status, created_at
				 FROM dataset_versions WHERE status = 'ACTIVE' LIMIT 1`,
			)
			.first<ActiveVersion>(),
	);
}

function getReadyParts(db: D1Database, section: Section, datasetId: number): Promise<PartRow[]> {
	return remember(`${section}:${datasetId}:parts`, async () => {
		const result = await db
			.prepare(
				`SELECT part_id, part_no, part_name, record_count, status
				 FROM parts WHERE dataset_id = ? AND status = 'READY' ORDER BY part_no ASC`,
			)
			.bind(datasetId)
			.all<PartRow>();
		return result.results ?? [];
	});
}

/** Removal requests: voters whose EPIC is in hidden_epics never appear (one primary-key lookup per row). */
const NOT_HIDDEN = `NOT EXISTS (SELECT 1 FROM hidden_epics h WHERE h.epic_no = r.epic_no)`;

function selectList(table: TableConfig): string {
	return table.selectColumns.map((column) => `r.${column}`).join(", ");
}


/** Handles /api/:section/... public routes. Returns null when the path is not one of them. */
export async function handlePublicRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
	if (request.method !== "GET") return null;

	const match = url.pathname.match(SECTION_PATTERN);
	if (!match || !isSection(match[1])) return null;

	const section = match[1];
	const action = match[2];
	const db = getDatabase(env, section);

	try {
		const version = await getActiveVersion(db, section);

		if (action === "version") {
			// 200 with version:null means "not published yet" (e.g. Final Draft → Coming soon).
			return json({ section, version });
		}

		if (action === "parts") return await listParts(db, section, version);
		if (action === "search") return await search(db, section, version, url);

		if (action.startsWith("by-epic/")) {
			const epic = decodeURIComponent(action.slice("by-epic/".length)).trim();
			return await getOneRecord(db, section, version, "epic_no", epic, true);
		}

		const recordId = Number(action.slice("records/".length));
		return await getOneRecord(db, section, version, getTable(section).idColumn, recordId, false);
	} catch (error) {
		console.error(`Public route failed: ${section}/${action}`, error);
		return json({ error: "DATABASE_ERROR", message: "Unable to read records." }, { status: 500 });
	}
}

async function listParts(db: D1Database, section: Section, version: ActiveVersion | null): Promise<Response> {
	if (!version) return json({ section, version: null, parts: [] });
	const parts = await getReadyParts(db, section, version.dataset_id);
	return json({ section, version, parts });
}

async function getOneRecord(
	db: D1Database,
	section: Section,
	version: ActiveVersion | null,
	column: string,
	value: string | number,
	nocase: boolean,
): Promise<Response> {
	if (!version) {
		return json({ error: "VERSION_NOT_FOUND", message: "This list is not published yet." }, { status: 404 });
	}

	const table = getTable(section);
	const record = await db
		.prepare(
			`SELECT ${selectList(table)}
			 FROM ${table.table} r ${column === "epic_no" ? `INDEXED BY ${table.epicIndex}` : ""}
			 JOIN parts p ON p.part_id = r.part_id
			 WHERE p.dataset_id = ? AND p.status = 'READY' AND ${NOT_HIDDEN}
			   AND r.${column} = ?${nocase ? " COLLATE NOCASE" : ""}
			 LIMIT 1`,
		)
		.bind(version.dataset_id, value)
		.first();

	if (!record) {
		return json({ error: "RECORD_NOT_FOUND", message: "Record not found." }, { status: 404 });
	}
	return json({ section, version, record });
}

async function search(db: D1Database, section: Section, version: ActiveVersion | null, url: URL): Promise<Response> {
	const table = getTable(section);
	const query = url.searchParams.get("query")?.trim() ?? "";
	const field = url.searchParams.get("field")?.trim() || "all";
	const partNoParam = url.searchParams.get("partNo");
	const cursorParam = url.searchParams.get("cursor");
	const requestedLimit = Number(url.searchParams.get("limit") ?? "30");
	const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 30) : 30;
	const partNo = partNoParam && /^\d+$/.test(partNoParam) ? Number(partNoParam) : null;

	const empty = (extra: Record<string, unknown> = {}) =>
		json({ section, version, part: partNo !== null ? { partNo } : null, records: [], nextCursor: null, hasMore: false, ...extra });

	if (!getSearchFields(section).includes(field)) {
		return json(
			{ error: "INVALID_SEARCH_FIELD", message: `Search field "${field}" is not available for ${section}.` },
			{ status: 400 },
		);
	}

	const cursor = cursorParam ? decodeCursor(cursorParam) : null;
	if (cursorParam && !cursor) {
		return json({ error: "INVALID_CURSOR", message: "Invalid pagination cursor." }, { status: 400 });
	}

	if (!version) return empty({ available: false });

	// No query and no Part = "list everything sorted by Sr No", which reads the whole
	// table on every page view (free plan: 5M rows read/day). Ask for a search or a Part.
	if (!query && partNo === null) return empty({ needsQuery: true });

	const params: unknown[] = [version.dataset_id];
	let join = "";
	// Force the right index: the live database's planner has picked full scans before.
	let indexHint = "";
	let where = `p.dataset_id = ? AND p.status = 'READY' AND ${NOT_HIDDEN}`;

	if (partNo !== null) {
		const part = (await getReadyParts(db, section, version.dataset_id)).find((row) => row.part_no === partNo);
		if (!part) return empty();
		where += ` AND r.part_id = ?`;
		params.push(part.part_id);
		indexHint = `INDEXED BY ${table.partIndex}`;
	}

	if (query) {
		const spec: FieldSpec = field === "all" ? resolveAllField(query, table) : table.fields[field];

		const badQuery = checkQuery(query, spec.type === "fts");
		if (badQuery) return badQuery;

		if (spec.needsPart && partNo === null) {
			return json(
				{ error: "PART_REQUIRED", message: "Please select a Part to search by this field." },
				{ status: 400 },
			);
		}

		if (spec.type === "fts") {
			const ftsQuery = buildFtsQuery(query, spec.column);
			if (!ftsQuery) return empty();
			join = `JOIN ${table.ftsTable} ON ${table.ftsTable}.rowid = r.${table.idColumn}`;
			where += ` AND ${table.ftsTable} MATCH ?`;
			params.push(ftsQuery);
		} else if (spec.numeric) {
			if (!/^\d+$/.test(query)) return empty();
			where += ` AND r.${spec.column} = ?`;
			params.push(Number(query));
		} else {
			where += ` AND r.${spec.column} = ?${spec.nocase ? " COLLATE NOCASE" : ""}`;
			params.push(query);
			if (spec.column === "epic_no") indexHint = `INDEXED BY ${table.epicIndex}`;
		}
	}

	if (cursor) {
		const serial = `r.${table.serialColumn}`;
		const id = `r.${table.idColumn}`;
		where += ` AND (${serial} > ? OR (${serial} = ? AND ${id} > ?))`;
		params.push(cursor.serial, cursor.serial, cursor.id);
	}

	params.push(limit + 1);

	const result = await db
		.prepare(
			`SELECT ${selectList(table)}
			 FROM ${table.table} r ${indexHint}
			 JOIN parts p ON p.part_id = r.part_id
			 ${join}
			 WHERE ${where}
			 ORDER BY r.${table.serialColumn} ASC, r.${table.idColumn} ASC
			 LIMIT ?`,
		)
		.bind(...params)
		.all<Record<string, unknown>>();

	const rows = result.results ?? [];
	const hasMore = rows.length > limit;
	const records = hasMore ? rows.slice(0, limit) : rows;
	const last = records[records.length - 1];

	return json({
		section,
		version,
		part: partNo !== null ? { partNo } : null,
		records,
		nextCursor: hasMore && last ? encodeCursor(Number(last[table.serialColumn]), Number(last[table.idColumn])) : null,
		hasMore,
	});
}
