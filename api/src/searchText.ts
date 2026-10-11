// Name search: word-by-word matching plus common Indian spelling variants.
//
// "hamza patel"  -> hamza* AND patel*        (finds "Hamza Bilal Patel", "Patel Hamza")
// "hamja patil"  -> (hamja* OR hamza*) AND (patil* OR patel*)
//
// Everything runs on the existing full-text index: no data changes, no extra writes.
// Limit: missing/extra letters ("hmza") are NOT matched; that needs a trigram index.

/** Whole-word families that are spelled many ways. Any member expands to all of them. */
const NAME_FAMILIES: string[][] = [
	["mohammad", "mohammed", "muhammad", "mohamad", "mohamed", "mohd", "md"],
	["patel", "patil"],
	["shaikh", "sheikh", "shekh", "shaik"],
	["syed", "sayyed", "sayed", "saiyed"],
	["pathan", "pattan"],
	["khan", "kahn"],
	["laxmi", "lakshmi"],
	["ganesh", "ganesha"],
	["krishna", "krushna", "krisna"],
];

/** Letter swaps tried in both directions (most useful first: each word gets few variants). */
const SWAPS_BOTH_WAYS: [string, string][] = [
	["z", "j"],
	["w", "v"],
	["ee", "i"],
	["oo", "u"],
	["ph", "f"],
];

/** Swaps tried one way only (long -> short), so we never invent letters like "haamzaa". */
const SWAPS_ONE_WAY: [string, string][] = [
	["aa", "a"],
	["bh", "b"],
	["dh", "d"],
	["th", "t"],
	["kh", "k"],
	["gh", "g"],
];

const MAX_WORDS = 5;
const MAX_VARIANTS_PER_WORD = 8;

/** Spelling variants for one lowercase word, the word itself first. */
export function wordVariants(word: string): string[] {
	const family = NAME_FAMILIES.find((members) => members.includes(word));
	if (family) return [word, ...family.filter((member) => member !== word)].slice(0, MAX_VARIANTS_PER_WORD);

	const variants = [word];
	const add = (from: string, to: string) => {
		for (const current of [...variants]) {
			if (variants.length >= MAX_VARIANTS_PER_WORD) return;
			if (!current.includes(from)) continue;
			const next = current.split(from).join(to);
			if (next.length >= 2 && !variants.includes(next)) variants.push(next);
		}
	};
	for (const [a, b] of SWAPS_BOTH_WAYS) {
		add(a, b);
		add(b, a);
	}
	for (const [a, b] of SWAPS_ONE_WAY) add(a, b);
	return variants.slice(0, MAX_VARIANTS_PER_WORD);
}

/** Lowercase words of 2+ letters/digits, at most MAX_WORDS. */
export function queryWords(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 2)
		.slice(0, MAX_WORDS);
}

/**
 * FTS5 MATCH expression: every word must match (any order, any position),
 * each word as a prefix, with spelling variants OR-ed together.
 * Returns null when the query has no usable words.
 */
export function buildFtsQuery(query: string, column: string | null): string | null {
	const words = queryWords(query);
	if (!words.length) return null;
	const prefix = column ? `${column} : ` : "";
	return words
		.map((word) => {
			const variants = wordVariants(word).map((variant) => `"${variant}"*`);
			const group = variants.length === 1 ? variants[0] : `(${variants.join(" OR ")})`;
			return `${prefix}${group}`;
		})
		.join(" AND ");
}
