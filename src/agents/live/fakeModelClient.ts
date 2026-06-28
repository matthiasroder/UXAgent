import type { LiveActionDecision } from "../../types.js";
import type { LiveActionPrompt, LiveModelClient } from "./modelClient.js";

export class FakeModelClient implements LiveModelClient {
  private readonly decisions: LiveActionDecision[];

  constructor(decisions: LiveActionDecision[]) {
    this.decisions = [...decisions];
  }

  async chooseAction(_prompt: LiveActionPrompt): Promise<LiveActionDecision> {
    return (
      this.decisions.shift() ?? {
        action: "fail",
        reason: "No fake model decision remains.",
        summary: "The fake model exhausted its scripted decisions.",
      }
    );
  }
}
