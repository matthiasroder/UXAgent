import type { Locator, Page } from "playwright";
import { USER_AGENT_CONTRACT, type UserAgent, type UserAgentInput, type UserAgentResult } from "./contracts.js";
import { capturePageSnapshot } from "./live/pageSnapshot.js";
import type { LiveModelClient } from "./live/modelClient.js";
import { createLivePolicy, validateLiveAction, type LivePolicy } from "../safety/livePolicy.js";
import type { ActionLogEntry, LiveActionDecision, LiveConfig, TaskOutcome } from "../types.js";

export class LiveUserAgent implements UserAgent {
  readonly name = "live-llm-user";
  readonly contract = USER_AGENT_CONTRACT;
  private readonly liveConfig: LiveConfig;
  private readonly modelClient: LiveModelClient;
  private readonly policy: LivePolicy;

  constructor(liveConfig: LiveConfig, modelClient: LiveModelClient) {
    this.liveConfig = liveConfig;
    this.modelClient = modelClient;
    this.policy = createLivePolicy(liveConfig);
  }

  async run(input: UserAgentInput): Promise<UserAgentResult> {
    const actions: ActionLogEntry[] = [];
    const thinkAloud: string[] = [];

    for (let step = 1; step <= input.limits.maxSteps; step += 1) {
      const snapshot = await capturePageSnapshot(input.page, this.liveConfig.includeScreenshots);
      const decision = await this.modelClient.chooseAction({
        persona: input.persona,
        task: input.task,
        page: snapshot,
        recentActions: actions,
        allowedActions: ["observe", "click", "type", "scroll", "wait", "back", "finish", "fail"],
        testDataKeys: Object.keys(this.liveConfig.testData),
      });

      const safety = validateLiveAction(this.policy, {
        action: decision,
        currentUrl: input.page.url(),
        elements: snapshot.elements,
      });

      if (!safety.allowed) {
        const screenshot = await input.captureEvidence(`step-${step}-blocked`);
        actions.push({
          step,
          type: "blocked_action",
          target: decision.targetId,
          value: decision.valueKey ? `testData.${decision.valueKey}` : undefined,
          screenshot,
          timestamp: new Date().toISOString(),
          note: `${safety.reason ?? "Blocked by live safety policy."} Proposed action: ${describeDecision(decision)}`,
        });
        thinkAloud.push(`${input.persona.name}: I could not take the proposed action because ${safety.reason ?? "it was blocked"}.`);
        continue;
      }

      if (decision.action === "finish") {
        const screenshot = await input.captureEvidence(`step-${step}-finish`);
        actions.push({
          step,
          type: "finish",
          screenshot,
          timestamp: new Date().toISOString(),
          note: decision.summary ?? decision.reason,
        });
        thinkAloud.push(`${input.persona.name}: ${decision.summary ?? decision.reason}`);
        return finish(actions, thinkAloud, decision.summary ?? decision.reason);
      }

      if (decision.action === "fail") {
        const screenshot = await input.captureEvidence(`step-${step}-fail`);
        actions.push({
          step,
          type: "fail",
          screenshot,
          timestamp: new Date().toISOString(),
          note: decision.summary ?? decision.reason,
        });
        thinkAloud.push(`${input.persona.name}: ${decision.summary ?? decision.reason}`);
        return fail(actions, thinkAloud, decision.summary ?? decision.reason);
      }

      await executeDecision(input.page, decision, safety.element ? locatorFor(input.page, safety.element.id) : undefined, safety.value);
      const screenshot = await input.captureEvidence(`step-${step}-${decision.action}`);
      actions.push({
        step,
        type: decision.action,
        target: decision.targetId,
        value: safety.value ?? decision.valueKey,
        screenshot,
        timestamp: new Date().toISOString(),
        note: decision.reason,
      });
      thinkAloud.push(`${input.persona.name}: ${decision.reason}`);

      if (input.limits.actionDelayMs > 0) {
        await input.page.waitForTimeout(input.limits.actionDelayMs);
      }
    }

    return fail(actions, thinkAloud, `Reached maxSteps (${input.limits.maxSteps}) before the task was finished.`);
  }
}

async function executeDecision(page: Page, decision: LiveActionDecision, locator: Locator | undefined, value: string | undefined): Promise<void> {
  switch (decision.action) {
    case "observe":
      return;
    case "click":
      if (!locator) {
        throw new Error("Click action passed safety without a locator.");
      }
      await locator.click();
      return;
    case "type":
      if (!locator || value === undefined) {
        throw new Error("Type action passed safety without a locator or value.");
      }
      await locator.fill(value);
      return;
    case "scroll":
      await page.mouse.wheel(0, decision.amount ?? 700);
      return;
    case "wait":
      await page.waitForTimeout(Math.min(Math.max(decision.amount ?? 1000, 0), 5000));
      return;
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      return;
    default:
      return;
  }
}

function locatorFor(page: Page, id: string): Locator {
  return page.locator(`[data-uxagent-id="${id}"]`).first();
}

function finish(actions: ActionLogEntry[], thinkAloud: string[], summary: string): UserAgentResult {
  return {
    actions,
    thinkAloud,
    outcome: {
      status: "passed",
      summary,
      evidence: evidence(actions),
    },
  };
}

function fail(actions: ActionLogEntry[], thinkAloud: string[], summary: string): UserAgentResult {
  return {
    actions,
    thinkAloud,
    outcome: {
      status: "failed",
      summary,
      evidence: evidence(actions),
    },
  };
}

function evidence(actions: ActionLogEntry[]): string[] {
  return actions.map((action) => action.screenshot).filter(Boolean) as string[];
}

function describeDecision(decision: LiveActionDecision): string {
  return [decision.action, decision.targetId, decision.valueKey, decision.reason].filter(Boolean).join(" ");
}
