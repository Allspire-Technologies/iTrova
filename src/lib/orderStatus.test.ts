import { describe, it, expect } from "vitest";
import { orderStatusOptions, isOrderLocked, ORDER_STATUSES } from "./orderStatus";

describe("orderStatusOptions", () => {
  it("offers every status from pending or shipped", () => {
    expect(orderStatusOptions("pending")).toEqual([...ORDER_STATUSES]);
    expect(orderStatusOptions("shipped")).toEqual([...ORDER_STATUSES]);
  });

  it("locks a delivered order to delivered or cancelled only", () => {
    expect(orderStatusOptions("delivered")).toEqual(["delivered", "cancelled"]);
  });

  it("keeps a cancelled order terminal", () => {
    expect(orderStatusOptions("cancelled")).toEqual(["cancelled"]);
  });
});

describe("isOrderLocked", () => {
  it("is true only for cancelled", () => {
    expect(isOrderLocked("cancelled")).toBe(true);
    expect(isOrderLocked("delivered")).toBe(false);
    expect(isOrderLocked("pending")).toBe(false);
    expect(isOrderLocked("shipped")).toBe(false);
  });
});
