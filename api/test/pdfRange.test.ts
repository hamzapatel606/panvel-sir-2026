import { describe, expect, it } from "vitest";
import { parseRange } from "../src/routes/pdf";

describe("parseRange (HTTP Range for the PDF viewer)", () => {
	const size = 1000;

	it("reads start-end", () => expect(parseRange("bytes=0-99", size)).toEqual({ start: 0, end: 99 }));
	it("reads start- to the end", () => expect(parseRange("bytes=900-", size)).toEqual({ start: 900, end: 999 }));
	it("reads a suffix (-N = last N bytes)", () => expect(parseRange("bytes=-100", size)).toEqual({ start: 900, end: 999 }));
	it("clamps an end past the file size", () => expect(parseRange("bytes=950-5000", size)).toEqual({ start: 950, end: 999 }));
	it("rejects a start past the end", () => expect(parseRange("bytes=1000-", size)).toBe("unsatisfiable"));
	it("sends the whole file for no/odd headers", () => {
		expect(parseRange(null, size)).toBeNull();
		expect(parseRange("bytes=0-1,5-9", size)).toBeNull();
		expect(parseRange("items=0-5", size)).toBeNull();
	});
	it("ignores ranges when the stored size is unknown", () => expect(parseRange("bytes=0-99", 0)).toBeNull());
});
