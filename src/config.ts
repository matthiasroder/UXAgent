import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { safeId } from "./ids.js";
import type { UXAgentConfig } from "./types.js";

const idSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, underscores, or dashes and start with a letter or number.");

const urlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:" || protocol === "file:";
}, "targetUrl must use http, https, or file.");

const configSchema = z.object({
  runName: z.string().min(1),
  runId: idSchema.optional(),
  targetUrl: urlSchema,
  mode: z.enum(["demo", "live"]).default("demo"),
  limits: z.preprocess(
    (value) => value ?? {},
    z.object({
      maxSteps: z.number().int().positive().max(100).default(12),
      actionDelayMs: z.number().int().min(0).max(10_000).default(0),
      navigationTimeoutMs: z.number().int().positive().max(120_000).default(30_000),
      recordVideo: z.boolean().default(false),
    }),
  ),
  personas: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().min(1),
        profile: z.string().min(1),
        goals: z.array(z.string().min(1)).default([]),
        constraints: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
  tasks: z
    .array(
      z.object({
        id: idSchema,
        title: z.string().min(1),
        description: z.string().min(1),
        successCriteria: z.array(z.string().min(1)).default([]),
        startPath: z.string().optional(),
      }),
    )
    .min(1),
  reviewer: z.preprocess(
    (value) => value ?? {},
    z.object({
      minSeverity: z.enum(["low", "medium", "high"]).default("low"),
    }),
  ),
  live: z
    .object({
      provider: z.enum(["openai"]).default("openai"),
      model: z.string().min(1).default("gpt-5.5"),
      apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY"),
      allowedOrigins: z.array(z.string().url()).min(1),
      includeScreenshots: z.boolean().default(true),
      maxActionRepairs: z.number().int().min(0).max(3).default(1),
      permissions: z.preprocess(
        (value) => value ?? {},
        z.object({
          allowClicks: z.boolean().default(true),
          allowTyping: z.boolean().default(true),
          allowFormSubmit: z.boolean().default(false),
          allowExternalNavigation: z.boolean().default(false),
          allowDestructiveClicks: z.boolean().default(false),
        }),
      ),
      testData: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function loadConfig(configPath: string): Promise<UXAgentConfig> {
  let raw: unknown;

  try {
    raw = normalizeRawConfig(JSON.parse(await fs.readFile(configPath, "utf8")), configPath);
  } catch (error) {
    throw new ConfigError(`Could not read config ${configPath}: ${errorMessage(error)}`);
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid UXAgent config:\n${details}`);
  }

  return validateAndResolveConfig(parsed.data);
}

function validateAndResolveConfig(config: UXAgentConfig): UXAgentConfig {
  validateSafeIdSet("personas", config.personas.map((persona) => persona.id));
  validateSafeIdSet("tasks", config.tasks.map((task) => task.id));
  validateLiveConfig(config);

  const base = new URL(config.targetUrl);
  const tasks = config.tasks.map((task) => {
    if (task.startPath === undefined) {
      return { ...task, resolvedUrl: config.targetUrl };
    }

    if (task.startPath.includes("\0")) {
      throw new ConfigError(`tasks.${task.id}.startPath contains a null byte.`);
    }

    if (base.protocol === "file:") {
      throw new ConfigError(`tasks.${task.id}.startPath is not supported for file targetUrl values.`);
    }

    const resolved = new URL(task.startPath, config.targetUrl);
    if (resolved.origin !== base.origin) {
      throw new ConfigError(`tasks.${task.id}.startPath must stay on the targetUrl origin.`);
    }

    return { ...task, resolvedUrl: resolved.toString() };
  });

  return { ...config, tasks };
}

function validateLiveConfig(config: UXAgentConfig): void {
  if (config.mode !== "live") {
    return;
  }

  if (!config.live) {
    throw new ConfigError("mode live requires a live configuration block.");
  }

  const targetProtocol = new URL(config.targetUrl).protocol;
  if (targetProtocol !== "http:" && targetProtocol !== "https:") {
    throw new ConfigError("mode live requires an http(s) targetUrl. Use demo mode for file:// fixtures.");
  }

  const targetOrigin = originOf(config.targetUrl);
  const allowedOrigins = config.live.allowedOrigins.map((origin) => normalizeOrigin(origin));
  if (!allowedOrigins.includes(targetOrigin)) {
    throw new ConfigError(`live.allowedOrigins must include targetUrl origin ${targetOrigin}.`);
  }
}

function originOf(value: string): string {
  const url = new URL(value);
  if (url.protocol === "file:") {
    return "file://";
  }
  return url.origin;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("live.allowedOrigins must use http(s) origins.");
  }
  return url.origin;
}

function validateSafeIdSet(label: string, ids: string[]): void {
  const seen = new Map<string, string>();
  for (const id of ids) {
    if (id.includes("__")) {
      throw new ConfigError(`${label}.${id}: IDs may not contain "__" because it is reserved for session paths.`);
    }

    const safe = safeId(id);
    const existing = seen.get(safe);
    if (existing) {
      throw new ConfigError(`${label}: IDs "${existing}" and "${id}" collide as filesystem path "${safe}".`);
    }
    seen.set(safe, id);
  }
}

function normalizeRawConfig(raw: unknown, configPath: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  const value = raw as Record<string, unknown>;
  if (typeof value.targetUrl !== "string") {
    return raw;
  }

  const configDir = path.dirname(path.resolve(configPath));
  const prefix = "${CONFIG_DIR}/";
  if (value.targetUrl.startsWith(prefix)) {
    return {
      ...value,
      targetUrl: pathToFileURL(path.resolve(configDir, value.targetUrl.slice(prefix.length))).toString(),
    };
  }

  return raw;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
