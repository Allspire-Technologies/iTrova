import { describe, it, expect, vi } from "vitest";
import { runPrewarm } from "./offlinePrewarm";

// offlinePrewarm imports the Supabase client transitively; stub it so importing the module doesn't
// require env (these tests inject fake tasks and never hit the real warmers). vitest hoists this
// above the imports above.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

// Inject fake tasks so the orchestration is tested without hitting Supabase/IndexedDB.
const task = (key: string, run: () => Promise<void>) => ({ key, label: key.toUpperCase(), run });

describe("runPrewarm", () => {
  it("runs every task in order and reports progress from 0 to total", async () => {
    const order: string[] = [];
    const tasks = [
      task("a", async () => { order.push("a"); }),
      task("b", async () => { order.push("b"); }),
      task("c", async () => { order.push("c"); }),
    ];
    const seen: number[] = [];
    const res = await runPrewarm("biz-1", (p) => seen.push(p.done), tasks);

    expect(order).toEqual(["a", "b", "c"]);
    expect(res).toEqual({ completed: 3, total: 3, errors: [] });
    expect(seen[0]).toBe(0);          // emits before the first task
    expect(seen.at(-1)).toBe(3);      // emits total after the last
  });

  it("records a failing task but keeps going (partial coverage beats none)", async () => {
    const tasks = [
      task("a", async () => { throw new Error("boom"); }),
      task("b", async () => { /* ok */ }),
    ];
    const res = await runPrewarm("biz-1", undefined, tasks);

    expect(res.completed).toBe(2);
    expect(res.errors).toEqual([{ key: "a", message: "boom" }]);
  });

  it("guards against concurrent runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const tasks = [task("slow", async () => { await gate; })];

    const first = runPrewarm("biz-1", undefined, tasks);   // takes the lock, parks on the gate
    const second = await runPrewarm("biz-1", undefined, tasks); // no-op while the first is in flight
    expect(second).toEqual({ completed: 0, total: 1, errors: [] });

    release();
    expect((await first).completed).toBe(1);
  });
});
