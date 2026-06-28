import { describe, expect, it } from "vitest";
import { parseLiveAction } from "../src/agents/live/actionSchema.js";

describe("live action schema", () => {
  it("accepts a valid structured action", () => {
    expect(
      parseLiveAction({
        action: "click",
        targetId: "el_1",
        reason: "This call to action matches the task.",
      }),
    ).toEqual({
      action: "click",
      targetId: "el_1",
      reason: "This call to action matches the task.",
    });
  });

  it("rejects malformed actions", () => {
    expect(() => parseLiveAction({ action: "eval", code: "alert(1)" })).toThrow();
  });

  it("rejects extra model fields", () => {
    expect(() =>
      parseLiveAction({
        action: "observe",
        reason: "Look around.",
        script: "document.cookie",
      }),
    ).toThrow();
  });
});
