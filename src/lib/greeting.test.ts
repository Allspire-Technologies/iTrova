import { describe, it, expect } from "vitest";
import { greeting, greetingPart } from "./greeting";

const at = (h: number, m = 0) => new Date(2026, 6, 31, h, m, 0);

describe("greetingPart", () => {
  it("greets morning from midnight to 11:59", () => {
    expect(greetingPart(at(0))).toBe("morning");      // midnight starts the morning
    expect(greetingPart(at(5, 30))).toBe("morning");
    expect(greetingPart(at(11, 59))).toBe("morning");
  });

  it("greets afternoon from noon to 16:59", () => {
    expect(greetingPart(at(12))).toBe("afternoon");
    expect(greetingPart(at(16, 59))).toBe("afternoon");
  });

  it("greets evening from 17:00 to 23:59", () => {
    expect(greetingPart(at(17))).toBe("evening");
    expect(greetingPart(at(21, 15))).toBe("evening");
    expect(greetingPart(at(23, 59))).toBe("evening");
  });
});

describe("greeting", () => {
  it("renders the full phrase", () => {
    expect(greeting(at(9))).toBe("Good morning");
    expect(greeting(at(13))).toBe("Good afternoon");
    expect(greeting(at(19))).toBe("Good evening");
  });
});
