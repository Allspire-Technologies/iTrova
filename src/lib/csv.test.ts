import { describe, it, expect } from "vitest";
import { toCsv, parseCsv } from "./csv";

describe("toCsv", () => {
  it("writes a header then rows in column order", () => {
    expect(toCsv([{ a: 1, b: 2 }], ["b", "a"])).toBe("b,a\n2,1");
  });
  it("quotes fields containing commas, quotes, or newlines", () => {
    expect(toCsv([{ a: "x,y" }], ["a"])).toBe('a\n"x,y"');
    expect(toCsv([{ a: 'he said "hi"' }], ["a"])).toBe('a\n"he said ""hi"""');
    expect(toCsv([{ a: "l1\nl2" }], ["a"])).toBe('a\n"l1\nl2"');
  });
  it("renders null/undefined as empty", () => {
    expect(toCsv([{ a: null, b: "x" }], ["a", "b"])).toBe("a,b\n,x");
  });
  it("returns empty string for no rows and no columns", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("parseCsv", () => {
  it("parses header + rows into objects", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });
  it("handles quoted fields with commas and newlines", () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual([{ a: "x,y", b: "2" }]);
    expect(parseCsv('a,b\n"l1\nl2",2')).toEqual([{ a: "l1\nl2", b: "2" }]);
  });
  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"he ""hi"""')).toEqual([{ a: 'he "hi"' }]);
  });
  it("trims headers and values and skips blank lines", () => {
    expect(parseCsv(" a , b \n 1 , 2 \n\n3,4")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });
  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });
});
