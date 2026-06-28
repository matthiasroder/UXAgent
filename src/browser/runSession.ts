import path from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright";
import { ensureDir, relativeArtifact, writeJson, writeText } from "../artifacts.js";
import { isSafeInteractionUrl } from "../agents/demoUserAgent.js";
import { createLivePolicy, shouldBlockHttpRequest, shouldBlockNetworkRequest } from "../safety/livePolicy.js";
import { sessionId } from "../ids.js";
import type { UserAgent } from "../agents/contracts.js";
import type { ActionLogEntry, PersonaConfig, SessionArtifact, SessionMetadata, TaskConfig, TaskOutcome, UXAgentConfig } from "../types.js";

export interface RunSessionInput {
  config: UXAgentConfig;
  persona: PersonaConfig;
  task: TaskConfig;
  runDir: string;
  userAgent: UserAgent;
}

export async function runSession(input: RunSessionInput): Promise<SessionArtifact> {
  const id = sessionId(input.persona.id, input.task.id);
  const sessionDir = path.join(input.runDir, "sessions", id);
  const screenshotDir = path.join(sessionDir, "screenshots");
  const videoDir = path.join(sessionDir, "video");
  await ensureDir(screenshotDir);

  const startedAt = new Date().toISOString();
  const metadata: SessionMetadata = {
    sessionId: id,
    persona: {
      id: input.persona.id,
      name: input.persona.name,
      profile: input.persona.profile,
    },
    task: {
      id: input.task.id,
      title: input.task.title,
      description: input.task.description,
      successCriteria: input.task.successCriteria,
    },
    targetUrl: input.task.resolvedUrl ?? input.config.targetUrl,
    startedAt,
    status: "error",
  };

  const actions: ActionLogEntry[] = [];
  const thinkAloud: string[] = [];
  let outcome: TaskOutcome = {
    status: "error",
    summary: "Session did not complete.",
    evidence: [],
  };
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let videoPath: string | undefined;

  const captureEvidence = async (label: string): Promise<string> => {
    if (!page) {
      throw new Error("Cannot capture screenshot before page exists.");
    }
    const screenshotPath = path.join(screenshotDir, `${safeScreenshotLabel(label)}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return relativeArtifact(sessionDir, screenshotPath);
  };

  try {
    browser = await launchChromium();
    context = await browser.newContext(contextOptions(input.config, videoDir));
    await installRequestGuard(context, input.config, metadata.targetUrl);
    page = await context.newPage();
    page.setDefaultTimeout(input.config.limits.navigationTimeoutMs);
    await page.goto(metadata.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: input.config.limits.navigationTimeoutMs,
    });

    const initial = await captureEvidence("initial");
    actions.push({
      step: 0,
      type: "screenshot",
      screenshot: initial,
      timestamp: new Date().toISOString(),
      note: "Initial page state.",
    });

    const result = await input.userAgent.run({
      page,
      persona: input.persona,
      task: input.task,
      limits: input.config.limits,
      captureEvidence,
    });
    actions.push(...result.actions);
    thinkAloud.push(...result.thinkAloud);
    outcome = result.outcome;

    const finalScreenshot = await captureEvidence("final");
    outcome = {
      ...outcome,
      evidence: [...new Set([...outcome.evidence, initial, finalScreenshot])],
    };
  } catch (error) {
    const message = browserErrorMessage(error);
    const evidence = page ? [await captureEvidence("error")] : [];
    outcome = {
      status: "error",
      summary: message,
      evidence,
      error: message,
    };
    actions.push({
      step: actions.length,
      type: "error",
      timestamp: new Date().toISOString(),
      note: message,
      screenshot: evidence[0],
    });
  } finally {
    try {
      if (page?.video()) {
        const video = page.video();
        await closeContextBestEffort(context, actions);
        if (video) {
          try {
            videoPath = path.join(sessionDir, "video.webm");
            await video.saveAs(videoPath);
            metadata.video = relativeArtifact(sessionDir, videoPath);
          } catch (error) {
            actions.push({
              step: actions.length,
              type: "warning",
              timestamp: new Date().toISOString(),
              note: `Video capture failed: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      } else {
        await closeContextBestEffort(context, actions);
      }
    } finally {
      await closeBrowserBestEffort(browser, actions);
    }
  }

  metadata.endedAt = new Date().toISOString();
  metadata.status = outcome.status;

  const artifact: SessionArtifact = {
    sessionId: id,
    sessionDir,
    metadata,
    actions,
    outcome,
    thinkAloud,
  };

  await writeJson(path.join(sessionDir, "metadata.json"), metadata);
  await writeJson(path.join(sessionDir, "actions.json"), actions);
  await writeJson(path.join(sessionDir, "outcome.json"), outcome);
  await writeText(path.join(sessionDir, "think-aloud.md"), renderThinkAloud(input.persona.name, thinkAloud));

  return artifact;
}

async function closeContextBestEffort(context: BrowserContext | undefined, actions: ActionLogEntry[]): Promise<void> {
  try {
    await context?.close();
  } catch (error) {
    actions.push({
      step: actions.length,
      type: "warning",
      timestamp: new Date().toISOString(),
      note: `Browser context close failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function closeBrowserBestEffort(browser: Browser | undefined, actions: ActionLogEntry[]): Promise<void> {
  try {
    await browser?.close();
  } catch (error) {
    actions.push({
      step: actions.length,
      type: "warning",
      timestamp: new Date().toISOString(),
      note: `Browser close failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function installRequestGuard(context: BrowserContext, config: UXAgentConfig, currentUrl: string): Promise<void> {
  if (config.mode === "live" && config.live) {
    const policy = createLivePolicy(config.live);
    await context.routeWebSocket(/.*/, () => {
      // Intentionally do not connect to the server. Playwright will mock the
      // socket locally, preventing external ws/wss traffic from leaving live mode.
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (shouldBlockNetworkRequest(requestUrl, route.request().method(), policy)) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    return;
  }

  await installExternalRequestGuard(context, currentUrl);
}

function contextOptions(config: UXAgentConfig, videoDir: string): BrowserContextOptions {
  return {
    ...(config.limits.recordVideo
      ? {
          recordVideo: {
            dir: videoDir,
          },
        }
      : {}),
    ...(config.mode === "live"
      ? {
          serviceWorkers: "block" as const,
        }
      : {}),
  };
}

async function installExternalRequestGuard(context: BrowserContext, currentUrl: string): Promise<void> {
  if (!isSafeInteractionUrl(currentUrl)) {
    return;
  }

  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (isExternalHttpRequest(requestUrl)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

export function isExternalHttpRequest(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  return !isSafeInteractionUrl(value);
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(browserErrorMessage(error));
  }
}

function browserErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("npx playwright install chromium")) {
    return message;
  }
  if (/Executable doesn't exist|browserType\.launch|chromium/i.test(message)) {
    return `${message}\nInstall the browser with: npx playwright install chromium`;
  }
  return message;
}

function renderThinkAloud(personaName: string, notes: string[]): string {
  const body = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "- No think-aloud notes were produced.";
  return `# Think-Aloud Notes: ${personaName}\n\n${body}\n`;
}

function safeScreenshotLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "screenshot";
}
