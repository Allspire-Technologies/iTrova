import { describe, it, expect, vi } from "vitest";
import { retryImport } from "./lazyWithRetry";

describe("retryImport", () => {
  it("returns the value on the first success", async () => {
    const factory = vi.fn().mockResolvedValue("ok");
    await expect(retryImport(factory, 2, 0)).resolves.toBe("ok");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries after a transient failure and then succeeds", async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValue("ok");
    await expect(retryImport(factory, 2, 0)).resolves.toBe("ok");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("gives up after retries+1 attempts and rethrows the last error", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("chunk gone"));
    await expect(retryImport(factory, 2, 0)).rejects.toThrow("chunk gone");
    expect(factory).toHaveBeenCalledTimes(3);
  });
});
