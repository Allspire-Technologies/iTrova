import { describe, it, expect, vi } from "vitest";
import { retryImport, isChunkLoadError } from "./lazyWithRetry";

describe("isChunkLoadError", () => {
  it("recognises the browser variants of a failed dynamic import", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: /assets/POS-a.js"))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error("x"), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 5 failed"))).toBe(true);
  });
  it("is false for unrelated errors and non-errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

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
