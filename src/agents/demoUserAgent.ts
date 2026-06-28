import type { Locator } from "playwright";
import { USER_AGENT_CONTRACT, type UserAgent, type UserAgentInput, type UserAgentResult } from "./contracts.js";
import type { ActionLogEntry, TaskOutcome } from "../types.js";

export class DemoUserAgent implements UserAgent {
  readonly name = "deterministic-demo-user";
  readonly contract = USER_AGENT_CONTRACT;

  async run(input: UserAgentInput): Promise<UserAgentResult> {
    const actions: ActionLogEntry[] = [];
    const thinkAloud: string[] = [];
    const taskText = `${input.task.title} ${input.task.description} ${input.task.successCriteria.join(" ")}`.toLowerCase();
    let step = 1;

    const record = async (type: string, note: string, target?: string, value?: string): Promise<void> => {
      const screenshot = await input.captureEvidence(`step-${step}-${type}`);
      actions.push({
        step,
        type,
        target,
        value,
        screenshot,
        timestamp: new Date().toISOString(),
        note,
      });
      step += 1;
      if (input.limits.actionDelayMs > 0) {
        await input.page.waitForTimeout(input.limits.actionDelayMs);
      }
    };

    const visibleSummary = await summarizeVisiblePage(input.page);
    thinkAloud.push(`${input.persona.name}: I am checking whether this page supports my task.`);
    thinkAloud.push(`${input.persona.name}: I can see ${visibleSummary || "no clear headings or controls yet"}.`);
    await record("observe", `Visible page summary: ${visibleSummary || "empty"}`);

    if (!hasStepsRemaining(step, input.limits.maxSteps)) {
      return result(actions, thinkAloud, failed("Step limit reached after observation.", actions));
    }

    if (!isSafeInteractionUrl(input.page.url())) {
      await input.page.mouse.wheel(0, 900);
      thinkAloud.push(`${input.persona.name}: I stayed in observation mode because this is not a local target.`);
      await record("scroll", "Scrolled without clicking or typing because demo mode only interacts with local targets.");
      return result(actions, thinkAloud, failed("Demo mode captured evidence but did not interact with a non-local target.", actions));
    }

    if (isNewsletterTask(taskText)) {
      const email = `demo+${input.persona.id}@example.test`;
      const emailInput = input.page.locator("input[type='email'], input[name*='email' i]").first();
      if (await isUsable(emailInput)) {
        await emailInput.fill(email);
        thinkAloud.push(`${input.persona.name}: I found an email field and entered a test address.`);
        await record("type", "Entered a deterministic email address.", "email input", email);
      }

      if (!hasStepsRemaining(step, input.limits.maxSteps)) {
        return result(actions, thinkAloud, failed("Step limit reached before newsletter submission.", actions));
      }

      const subscribe = input.page.getByRole("button", { name: /subscribe|newsletter|sign up|join/i }).first();
      if (await isUsable(subscribe)) {
        await subscribe.click();
        thinkAloud.push(`${input.persona.name}: I clicked the subscription call to action.`);
        await record("click", "Clicked newsletter subscription control.", "subscribe button");
      }

      const text = (await input.page.locator("body").innerText()).toLowerCase();
      const passed = text.includes("subscribed") || text.includes("thanks") || text.includes("thank you");
      return result(actions, thinkAloud, {
        status: passed ? "passed" : "failed",
        summary: passed ? "Newsletter task reached a confirmation state." : "Newsletter controls were explored but no confirmation was visible.",
        evidence: actions.map((action) => action.screenshot).filter(Boolean) as string[],
      });
    }

    if (isBuyingTask(taskText)) {
      const buyControl = input.page.getByRole("button", { name: /buy|add to cart|cart|order/i }).first();
      if (await isUsable(buyControl)) {
        await buyControl.click();
        thinkAloud.push(`${input.persona.name}: I used the most relevant buying control I could find.`);
        await record("click", "Clicked buying/cart control.", "buy button");
      }

      const text = (await input.page.locator("body").innerText()).toLowerCase();
      const passed = text.includes("cart") || text.includes("added") || text.includes("checkout");
      return result(actions, thinkAloud, {
        status: passed ? "passed" : "failed",
        summary: passed ? "Buying task exposed cart or checkout feedback." : "Buying task did not expose clear cart or checkout feedback.",
        evidence: actions.map((action) => action.screenshot).filter(Boolean) as string[],
      });
    }

    if (isEventTask(taskText)) {
      const eventControl = input.page.getByRole("link", { name: /event|program|ticket|rsvp|details/i }).first();
      if (await isUsable(eventControl)) {
        await eventControl.click();
        thinkAloud.push(`${input.persona.name}: I followed the event-related navigation.`);
        await record("click", "Clicked event-related link.", "event link");
      }

      const text = (await input.page.locator("body").innerText()).toLowerCase();
      const passed = text.includes("event") && (text.includes("ticket") || text.includes("date") || text.includes("location"));
      return result(actions, thinkAloud, {
        status: passed ? "passed" : "failed",
        summary: passed ? "Event task found event details." : "Event task did not reveal enough event detail.",
        evidence: actions.map((action) => action.screenshot).filter(Boolean) as string[],
      });
    }

    await input.page.mouse.wheel(0, 900);
    thinkAloud.push(`${input.persona.name}: I scrolled to look for more task-relevant information.`);
    await record("scroll", "Scrolled down to inspect additional content.");

    return result(actions, thinkAloud, failed("No deterministic demo strategy matched this task; evidence was captured without claiming success.", actions));
  }
}

function result(actions: ActionLogEntry[], thinkAloud: string[], outcome: TaskOutcome): UserAgentResult {
  return { actions, thinkAloud, outcome };
}

function failed(summary: string, actions: ActionLogEntry[]): TaskOutcome {
  return {
    status: "failed",
    summary,
    evidence: actions.map((action) => action.screenshot).filter(Boolean) as string[],
  };
}

async function summarizeVisiblePage(page: UserAgentInput["page"]): Promise<string> {
  const values = await page
    .locator("h1, h2, h3, a, button")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.textContent?.trim())
        .filter((text): text is string => Boolean(text))
        .slice(0, 8),
    );
  return values.join("; ");
}

async function isUsable(locator: Locator): Promise<boolean> {
  try {
    return (await locator.count()) > 0 && (await locator.isVisible()) && (await locator.isEnabled());
  } catch {
    return false;
  }
}

function isNewsletterTask(text: string): boolean {
  return /newsletter|subscribe|email/.test(text);
}

function isBuyingTask(text: string): boolean {
  return /buy|purchase|gift|book|cart|order/.test(text);
}

function isEventTask(text: string): boolean {
  return /event|visit|ticket|program|rsvp/.test(text);
}

function hasStepsRemaining(nextStep: number, maxSteps: number): boolean {
  return nextStep <= maxSteps;
}

export function isSafeInteractionUrl(value: string): boolean {
  const url = new URL(value);
  if (url.protocol === "file:") {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
}
