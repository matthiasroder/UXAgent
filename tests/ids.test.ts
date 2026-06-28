import { describe, expect, it } from "vitest";
import { runRoot, safeId, sessionId } from "../src/ids.js";

describe("safe IDs", () => {
  it("normalizes labels for filesystem paths", () => {
    expect(safeId("Publisher Relaunch Demo")).toBe("publisher-relaunch-demo");
    expect(safeId("Persona_1")).toBe("persona_1");
    expect(sessionId("Literary Reader", "Buy Book")).toBe("literary-reader__buy-book");
  });

  it("uses a stable fallback for unsafe labels", () => {
    const first = safeId("!!!", "run");
    const second = safeId("!!!", "run");

    expect(first).toMatch(/^run-[a-f0-9]{8}$/);
    expect(second).toBe(first);
  });

  it("builds run roots from runId when provided", () => {
    expect(runRoot("/tmp/out", "My Run", "stable-run")).toBe("/tmp/out/stable-run");
  });
});
