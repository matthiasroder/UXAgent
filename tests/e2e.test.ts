import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runUxAgent } from "../src/runner.js";
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
