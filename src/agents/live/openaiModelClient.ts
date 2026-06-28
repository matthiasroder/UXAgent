import OpenAI from "openai";
import { ZodError } from "zod";
import type { LiveActionDecision, LiveConfig } from "../../types.js";
import { liveActionJsonSchema, parseLiveAction } from "./actionSchema.js";
import type { LiveActionPrompt, LiveModelClient } from "./modelClient.js";

export class MissingOpenAIKeyError extends Error {
  constructor(envName: string) {
    super(`Live mode requires ${envName} to be set for the OpenAI provider.`);
    this.name = "MissingOpenAIKeyError";
  }
}

export class OpenAIModelClient implements LiveModelClient {
  private readonly client: OpenAI;
  private readonly config: LiveConfig;

  constructor(config: LiveConfig) {
    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) {
      throw new MissingOpenAIKeyError(config.apiKeyEnv);
    }
    this.client = new OpenAI({ apiKey });
    this.config = config;
  }

  async chooseAction(prompt: LiveActionPrompt): Promise<LiveActionDecision> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxActionRepairs; attempt += 1) {
      try {
        const raw = await this.requestAction(prompt, lastError);
        return parseLiveAction(JSON.parse(raw));
      } catch (error) {
        lastError = error;
        if (attempt >= this.config.maxActionRepairs) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async requestAction(prompt: LiveActionPrompt, previousError: unknown): Promise<string> {
    const text = buildPrompt(prompt, previousError);
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text }];
    if (prompt.page.screenshotDataUrl) {
      content.push({ type: "input_image", image_url: prompt.page.screenshotDataUrl });
    }

    const response = await this.client.responses.create({
      model: this.config.model,
      input: [
        {
          role: "system",
          content:
            "You are UXAgent's simulated user. Choose exactly one browser action. Never invent element ids. Do not request unsafe actions.",
        },
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "uxagent_live_action",
          schema: liveActionJsonSchema,
          strict: false,
        },
      },
    } as any);

    const outputText = (response as any).output_text;
    if (typeof outputText === "string" && outputText.trim().length > 0) {
      return outputText;
    }

    throw new Error("OpenAI response did not include output_text.");
  }
}

function buildPrompt(prompt: LiveActionPrompt, previousError: unknown): string {
  const elementLines = prompt.page.elements
    .map((element) =>
      [
        element.id,
        element.role ?? element.tagName,
        element.text || element.label || element.placeholder || "(no text)",
        element.href ? `href=${element.href}` : "",
        element.isSubmit ? "submit-like" : "",
        element.isDestructive ? "destructive-looking" : "",
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");

  const repair = previousError
    ? `\nPrevious action was invalid: ${previousError instanceof ZodError ? previousError.message : String(previousError)}\nReturn a corrected action.`
    : "";

  return [
    `Persona: ${prompt.persona.name}`,
    `Profile: ${prompt.persona.profile}`,
    `Goals: ${prompt.persona.goals.join("; ") || "none"}`,
    `Constraints: ${prompt.persona.constraints.join("; ") || "none"}`,
    "",
    `Task: ${prompt.task.title}`,
    prompt.task.description,
    `Success criteria: ${prompt.task.successCriteria.join("; ") || "not specified"}`,
    "",
    `Current URL: ${prompt.page.url}`,
    `Page title: ${prompt.page.title}`,
    `Visible text sample: ${prompt.page.bodyTextSample}`,
    "",
    `Allowed actions: ${prompt.allowedActions.join(", ")}`,
    `Available testData keys for typing: ${prompt.testDataKeys.join(", ") || "none"}`,
    "",
    "Visible elements:",
    elementLines || "No interactive elements detected.",
    "",
    "Recent actions:",
    prompt.recentActions
      .slice(-6)
      .map((action) => `${action.step}. ${action.type}: ${action.note}`)
      .join("\n") || "none",
    repair,
  ].join("\n");
}
