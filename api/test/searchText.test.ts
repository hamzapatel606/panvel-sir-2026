import { describe, expect, it } from "vitest";
import { buildFtsQuery, queryWords, wordVariants } from "../src/searchText";

describe("queryWords", () => {
	it("lowercases, splits on non-letters and drops 1-letter words", () => {
		expect(queryWords("Hamza  B. PATEL")).toEqual(["hamza", "patel"]);
	});

	it("keeps at most 5 words", () => {
		expect(queryWords("aa bb cc dd ee ff gg")).toHaveLength(5);
	});
});

describe("wordVariants", () => {
	it("expands name families both ways", () => {
		expect(wordVariants("md")).toContain("mohammad");
		expect(wordVariants("patil")).toContain("patel");
	});

	it("applies letter swaps (z/j, w/v, ee/i)", () => {
		expect(wordVariants("hamja")).toContain("hamza");
		expect(wordVariants("vasim")).toContain("wasim");
		expect(wordVariants("sameer")).toContain("samir");
	});

	it("puts the typed word first and caps the variant count", () => {
		const variants = wordVariants("zeeshaan");
		expect(variants[0]).toBe("zeeshaan");
		expect(variants.length).toBeLessThanOrEqual(8);
	});
});

describe("buildFtsQuery", () => {
	it("requires every word, any order, as prefixes on one column", () => {
		const query = buildFtsQuery("hamza patel", "name");
		expect(query).toMatch(/^name : \(.*"hamza"\*.*\) AND name : \(.*"patel"\*.*\)$/);
	});

	it("returns null when nothing searchable is left", () => {
		expect(buildFtsQuery("a ! ?", "name")).toBeNull();
	});

	it("never lets quotes from the user break the MATCH syntax", () => {
		const query = buildFtsQuery('ha"mza OR x', null) ?? "";
		// Only our own quotes appear: one opening and one closing per variant.
		for (const token of query.match(/"[^"]*"/g) ?? []) expect(token).toMatch(/^"[a-z0-9]+"$/);
	});
});
