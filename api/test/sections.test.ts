import { describe, expect, it } from "vitest";
import { getSearchFields, getTable, isSection, resolveAllField } from "../src/sections";

describe("lists", () => {
	it("knows exactly draft, final and asdd (Discrepancy is gone)", () => {
		expect(["draft", "final", "asdd"].every(isSection)).toBe(true);
		expect(isSection("discrepancy")).toBe(false);
	});

	it("Final Draft uses the Draft table layout", () => {
		expect(getTable("final").table).toBe(getTable("draft").table);
	});

	it("every list offers 'all' plus name and EPIC search", () => {
		for (const section of ["draft", "final", "asdd"] as const) {
			expect(getSearchFields(section)).toEqual(expect.arrayContaining(["all", "name", "epic"]));
		}
	});
});

describe("resolveAllField (what an 'All' search means)", () => {
	const table = getTable("draft");

	it("digits only = Sr No, which needs a Part (no index)", () => {
		expect(resolveAllField("123", table)).toMatchObject({ column: table.serialColumn, numeric: true, needsPart: true });
	});

	it("letters + digits = EPIC, case-insensitive", () => {
		expect(resolveAllField("ABC1234567", table)).toMatchObject({ type: "eq", column: "epic_no", nocase: true });
	});

	it("anything else = full-text name search", () => {
		expect(resolveAllField("hamza patel", table).type).toBe("fts");
	});
});
