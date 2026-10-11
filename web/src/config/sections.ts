// Single source of truth for the public lists on the website.
// Must match SECTION_KEYS in the API (panvel-sir-api/src/sections.ts).

export const SECTION_KEYS = ["draft", "final", "asdd"] as const;
export type Section = (typeof SECTION_KEYS)[number];

/** Field layout of a list's records. Final Draft uses the Draft layout. */
export type RecordKind = "draft" | "asdd";

export type SearchField =
	| "all"
	| "serial"
	| "epic"
	| "name"
	| "relative"
	| "relation"
	| "house"
	| "age"
	| "gender"
	| "referenceEpic"
	| "reason";

export interface SectionConfig {
	key: Section;
	kind: RecordKind;
	path: string;
	/** Page heading and admin title, e.g. "Final Draft List". */
	title: string;
	/** Short name for nav and buttons, e.g. "Final Draft". */
	shortLabel: string;
	/** Small uppercase label on record cards. */
	kicker: string;
	description: string;
	homeDescription: string;
	adminDescription: string;
	/** Shown instead of the search while nothing is published. */
	unpublishedTitle: string;
	unpublishedText: string;
	searchFields: { value: SearchField; label: string }[];
	/** Fields that only work with a Part selected (no database index). Must match the API. */
	partRequiredFields: SearchField[];
}

/** Which Parts this site covers. Shown on the home page so a missing result isn't misread. */
export const COVERAGE_TEXT = "This site covers Parts 1–80 of Panvel Assembly Constituency 188.";

const DRAFT_SEARCH_FIELDS: SectionConfig["searchFields"] = [
	{ value: "all", label: "All" },
	{ value: "serial", label: "Elector Sr No" },
	{ value: "epic", label: "EPIC No" },
	{ value: "name", label: "Name" },
	{ value: "relative", label: "Relative Name" },
	{ value: "relation", label: "Relation" },
	{ value: "house", label: "House No" },
	{ value: "age", label: "Age" },
	{ value: "gender", label: "Gender" },
];

export const SECTIONS: Record<Section, SectionConfig> = {
	draft: {
		key: "draft",
		kind: "draft",
		path: "/draft",
		title: "Draft List",
		shortLabel: "Draft",
		kicker: "DRAFT ELECTOR",
		description: "Access and search voter information from the Draft List for Panvel Assembly Constituency 188.",
		homeDescription: "Search the SIR Panvel Draft List.",
		adminDescription: "Draft electoral roll",
		unpublishedTitle: "Not published yet",
		unpublishedText: "The Draft List has not been published on this site yet. Please check back later.",
		searchFields: DRAFT_SEARCH_FIELDS,
		partRequiredFields: ["serial", "relation", "house", "age", "gender"],
	},
	final: {
		key: "final",
		kind: "draft",
		path: "/final",
		title: "Final Draft List",
		shortLabel: "Final Draft",
		kicker: "FINAL DRAFT ELECTOR",
		description: "Access and search voter information from the updated Final Draft List for Panvel Assembly Constituency 188.",
		homeDescription: "Search the updated SIR Panvel Final Draft List.",
		adminDescription: "Updated (final) draft electoral roll",
		unpublishedTitle: "Coming soon",
		unpublishedText:
			"The Final Draft List has not been published yet. It will appear here as soon as the updated data is available.",
		searchFields: DRAFT_SEARCH_FIELDS,
		partRequiredFields: ["serial", "relation", "house", "age", "gender"],
	},
	asdd: {
		key: "asdd",
		kind: "asdd",
		path: "/asdd",
		title: "ASDD List",
		shortLabel: "ASDD",
		kicker: "ASDD RECORD",
		description:
			"Access and search voter information from the Absent, Shifted, Dead & Duplicate (ASDD) list for Panvel Assembly Constituency 188.",
		homeDescription: "Search Absent, Shifted, Dead & Duplicate SIR records.",
		adminDescription: "Absent, Shifted, Dead & Duplicate voters",
		unpublishedTitle: "Not published yet",
		unpublishedText: "The ASDD List has not been published on this site yet. Please check back later.",
		searchFields: [
			{ value: "all", label: "All" },
			{ value: "serial", label: "Elector Sr No" },
			{ value: "epic", label: "EPIC No" },
			{ value: "name", label: "Name" },
			{ value: "relative", label: "Relative Name" },
			{ value: "relation", label: "Relation" },
			{ value: "age", label: "Age" },
			{ value: "referenceEpic", label: "Reference EPIC" },
			{ value: "reason", label: "Reason" },
		],
		partRequiredFields: ["serial"],
	},
};

/** Display order across the site: nav, home cards, admin. */
export const SECTION_LIST: SectionConfig[] = SECTION_KEYS.map((key) => SECTIONS[key]);

/** True when this search would need a Part (mirrors the API's "all" field rules). */
export function needsPart(section: Section, field: SearchField, query: string): boolean {
	const q = query.trim();
	if (!q) return false;
	if (field === "all") return /^\d+$/.test(q); // digits only = Sr No
	return SECTIONS[section].partRequiredFields.includes(field);
}

/** Text searches need at least this many letters (must match MIN_TEXT_QUERY in the API). */
export const MIN_TEXT_QUERY = 3;

/** True when the query would be a name/relative/reason text search that is too short. */
export function isTooShortTextSearch(section: Section, field: SearchField, query: string): boolean {
	const q = query.trim();
	if (!q) return false;
	const textFields: SearchField[] = ["name", "relative", "reason"];
	const isText =
		textFields.includes(field) ||
		(field === "all" && !/^\d+$/.test(q) && !(/\d/.test(q) && /[A-Za-z]/.test(q) && /^[A-Za-z0-9/]+$/.test(q)));
	void section;
	return isText && q.replace(/["\s]/g, "").length < MIN_TEXT_QUERY;
}

export function isSearchField(section: Section, value: string | null): value is SearchField {
	return SECTIONS[section].searchFields.some((field) => field.value === value);
}
