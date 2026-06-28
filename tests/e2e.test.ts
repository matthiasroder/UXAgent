import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runUxAgent } from "../src/runner.js";
import type { LiveActionPrompt, LiveModelClient } from "../src/agents/live/modelClient.js";
import { tempDir, writeConfig } from "./helpers.js";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const fixturePath = path.resolve("examples/fixtures/publisher.html");
  const html = await fs.readFile(fixturePath, "utf8");

  server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start fixture server.");
  }
  baseUrl = `http://127.0.0.1:${address.port}/publisher.html`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("local demo run", () => {
  it("writes evidence artifacts and aggregate reports", async () => {
    const dir = await tempDir("uxagent-e2e-");
    const configPath = await writeConfig(dir, {
      runName: "Publisher Demo",
      runId: "publisher-demo-test",
      targetUrl: baseUrl,
      mode: "demo",
      limits: {
        maxSteps: 8,
        recordVideo: false,
      },
      personas: [
        {
          id: "newsletter_prospect",
          name: "Newsletter Prospect",
          profile: "Wants updates.",
        },
      ],
      tasks: [
        {
          id: "join_newsletter",
          title: "Join newsletter",
          description: "Subscribe to the publisher newsletter with an email address.",
          successCriteria: ["Confirmation is visible"],
        },
      ],
    });

    const result = await runUxAgent({ configPath, outDir: path.join(dir, "runs") }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/playwright install chromium/i.test(message)) {
        throw new Error(`${message}\nRun: npx playwright install chromium`);
      }
      throw error;
    });

    expect(result.exitCode).toBe(0);
    const runDir = path.join(dir, "runs", "publisher-demo-test");
    const sessionDir = path.join(runDir, "sessions", "newsletter_prospect__join_newsletter");
    const metadata = JSON.parse(await fs.readFile(path.join(sessionDir, "metadata.json"), "utf8")) as { status: string };
    const outcome = JSON.parse(await fs.readFile(path.join(sessionDir, "outcome.json"), "utf8")) as { status: string };
    const actions = JSON.parse(await fs.readFile(path.join(sessionDir, "actions.json"), "utf8")) as unknown[];
    const aggregate = JSON.parse(await fs.readFile(path.join(runDir, "aggregate-report.json"), "utf8")) as {
      taskMatrix: unknown[];
      findings: unknown[];
    };

    expect(metadata.status).toBe("passed");
    expect(outcome.status).toBe("passed");
    expect(actions.length).toBeGreaterThan(1);
    await expect(fs.access(path.join(sessionDir, "screenshots", "initial.png"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(sessionDir, "review.md"))).resolves.toBeUndefined();
    expect(aggregate.taskMatrix).toHaveLength(1);
    expect(aggregate.findings).toHaveLength(1);
  });

  it("runs live mode with a fake model client and writes normal artifacts", async () => {
    const dir = await tempDir("uxagent-live-e2e-");
    const origin = new URL(baseUrl).origin;
    const configPath = await writeConfig(dir, {
      runName: "Live Fixture",
      runId: "live-fixture",
      targetUrl: baseUrl,
      mode: "live",
      limits: {
        maxSteps: 4,
        recordVideo: false,
      },
      live: {
        allowedOrigins: [origin],
        includeScreenshots: false,
        testData: {
          email: "uxagent-test@example.com",
        },
      },
      personas: [
        {
          id: "event_visitor",
          name: "Event Visitor",
          profile: "Looks for event details.",
        },
      ],
      tasks: [
        {
          id: "find_event",
          title: "Find event details",
          description: "Open event details and finish when the event path is visible.",
        },
      ],
    });
    const modelClient: LiveModelClient = {
      async chooseAction(prompt: LiveActionPrompt) {
        const alreadyTyped = prompt.recentActions.some((action) => action.type === "type");
        const alreadyClicked = prompt.recentActions.some((action) => action.type === "click");
        if (alreadyTyped && alreadyClicked) {
          return {
            action: "finish",
            reason: "Event details path was opened.",
            summary: "The live agent opened the event details path.",
          };
        }
        if (!alreadyTyped) {
          const emailTarget = prompt.page.elements.find((element) => element.isInput && /email/i.test(`${element.label ?? ""} ${element.placeholder ?? ""}`));
          return {
            action: "type",
            targetId: emailTarget?.id,
            valueKey: "email",
            reason: "Use configured test email before exploring.",
          };
        }
        const target = prompt.page.elements.find((element) => /event details/i.test(`${element.text} ${element.label ?? ""}`));
        return {
          action: "click",
          targetId: target?.id,
          reason: "The event details link matches the task.",
        };
      },
    };

    const result = await runUxAgent({ configPath, outDir: path.join(dir, "runs"), liveModelClient: modelClient });
    const sessionDir = path.join(dir, "runs", "live-fixture", "sessions", "event_visitor__find_event");
    const outcome = JSON.parse(await fs.readFile(path.join(sessionDir, "outcome.json"), "utf8")) as { status: string; summary: string };
    const actions = JSON.parse(await fs.readFile(path.join(sessionDir, "actions.json"), "utf8")) as Array<{ type: string; value?: string }>;

    expect(result.exitCode).toBe(0);
    expect(outcome.status).toBe("passed");
    expect(outcome.summary).toMatch(/event/i);
    expect(actions.map((action) => action.type)).toContain("click");
    expect(actions.find((action) => action.type === "type")?.value).toBe("uxagent-test@example.com");
    await expect(fs.access(path.join(sessionDir, "review.md"))).resolves.toBeUndefined();
  });

  it("fails live mode before browser work when OpenAI key env is missing", async () => {
    const dir = await tempDir("uxagent-live-key-");
    const origin = new URL(baseUrl).origin;
    const configPath = await writeConfig(dir, {
      runName: "Missing Key",
      runId: "missing-key",
      targetUrl: baseUrl,
      mode: "live",
      live: {
        apiKeyEnv: "UXAGENT_TEST_MISSING_OPENAI_KEY",
        allowedOrigins: [origin],
      },
      personas: [
        {
          id: "reader",
          name: "Reader",
          profile: "Profile.",
        },
      ],
      tasks: [
        {
          id: "task",
          title: "Task",
          description: "Task.",
        },
      ],
    });

    await expect(runUxAgent({ configPath, outDir: path.join(dir, "runs") })).rejects.toThrow(/UXAGENT_TEST_MISSING_OPENAI_KEY/);
    await expect(fs.access(path.join(dir, "runs", "missing-key"))).rejects.toThrow();
  });

  it("respects maxSteps before clicking or typing", async () => {
    const dir = await tempDir("uxagent-steps-");
    const configPath = await writeConfig(dir, {
      runName: "Step Limit",
      runId: "step-limit",
      targetUrl: baseUrl,
      mode: "demo",
      limits: {
        maxSteps: 1,
        recordVideo: false,
      },
      personas: [
        {
          id: "newsletter_prospect",
          name: "Newsletter Prospect",
          profile: "Wants updates.",
        },
      ],
      tasks: [
        {
          id: "join_newsletter",
          title: "Join newsletter",
          description: "Subscribe to the publisher newsletter with an email address.",
        },
      ],
    });

    const result = await runUxAgent({ configPath, outDir: path.join(dir, "runs") });
    const sessionDir = path.join(dir, "runs", "step-limit", "sessions", "newsletter_prospect__join_newsletter");
    const outcome = JSON.parse(await fs.readFile(path.join(sessionDir, "outcome.json"), "utf8")) as { status: string; summary: string };
    const actions = JSON.parse(await fs.readFile(path.join(sessionDir, "actions.json"), "utf8")) as Array<{ type: string }>;

    expect(result.exitCode).toBe(0);
    expect(outcome.status).toBe("failed");
    expect(outcome.summary).toMatch(/Step limit/);
    expect(actions.map((action) => action.type)).not.toContain("click");
    expect(actions.map((action) => action.type)).not.toContain("type");
  });

  it("records navigation errors, returns non-zero, and keeps aggregate structure", async () => {
    const dir = await tempDir("uxagent-nav-error-");
    const configPath = await writeConfig(dir, {
      runName: "Navigation Error",
      runId: "navigation-error",
      targetUrl: "http://127.0.0.1:9/missing.html",
      mode: "demo",
      limits: {
        navigationTimeoutMs: 1000,
        recordVideo: false,
      },
      personas: [
        {
          id: "reader",
          name: "Reader",
          profile: "Profile.",
        },
      ],
      tasks: [
        {
          id: "task_one",
          title: "Task one",
          description: "Attempt task one.",
        },
        {
          id: "task_two",
          title: "Task two",
          description: "Attempt task two.",
        },
      ],
    });

    const result = await runUxAgent({ configPath, outDir: path.join(dir, "runs") });
    const runDir = path.join(dir, "runs", "navigation-error");
    const aggregate = JSON.parse(await fs.readFile(path.join(runDir, "aggregate-report.json"), "utf8")) as {
      taskMatrix: Array<{ status: string }>;
    };

    expect(result.exitCode).toBe(1);
    expect(aggregate.taskMatrix).toHaveLength(2);
    expect(aggregate.taskMatrix.every((row) => row.status === "error")).toBe(true);
    await expect(fs.access(path.join(runDir, "sessions", "reader__task_one", "outcome.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(runDir, "sessions", "reader__task_two", "outcome.json"))).resolves.toBeUndefined();
  });
});
