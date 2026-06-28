import { describe, expect, it } from "vitest";
import { EvidenceReviewer } from "../src/agents/reviewer.js";
import type { SessionArtifact, UXAgentConfig } from "../src/types.js";

describe("evidence reviewer", () => {
  it("preserves JSON findings when markdown severity filtering hides them", async () => {
    const reviewer = new EvidenceReviewer();
    const config: UXAgentConfig = {
      runName: "Review Test",
      targetUrl: "http://example.test",
      mode: "demo",
      limits: {
        maxSteps: 12,
        actionDelayMs: 0,
        navigationTimeoutMs: 30000,
        recordVideo: false,
      },
      personas: [],
      tasks: [],
      reviewer: {
        minSeverity: "high",
      },
    };
    const session: SessionArtifact = {
      sessionId: "reader__newsletter",
      sessionDir: "/tmp/session",
      metadata: {
        sessionId: "reader__newsletter",
        persona: {
          id: "reader",
          name: "Reader",
          profile: "Profile",
        },
        task: {
          id: "newsletter",
          title: "Join newsletter",
          description: "Subscribe",
          successCriteria: [],
        },
        targetUrl: "http://example.test",
        startedAt: new Date().toISOString(),
        status: "passed",
      },
      actions: [],
      outcome: {
        status: "passed",
        summary: "Task passed.",
        evidence: ["screenshots/final.png"],
      },
      thinkAloud: [],
    };

    const result = await reviewer.reviewSession({ config, session });

    expect(result.review.findings).toHaveLength(1);
    expect(result.review.findings[0]?.severity).toBe("low");
    expect(result.markdown).toContain("No findings at or above high severity.");
    expect(result.review.outcome.evidence).toContain("screenshots/final.png");
  });
});
