import { createHash } from "node:crypto";
import path from "node:path";

export function safeId(input: string, fallbackPrefix = "id"): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (normalized.length > 0) {
    return normalized;
  }

  const hash = createHash("sha256").update(input).digest("hex").slice(0, 8);
  return `${fallbackPrefix}-${hash}`;
}

export function sessionId(personaId: string, taskId: string): string {
  return `${safeId(personaId, "persona")}__${safeId(taskId, "task")}`;
}

export function runRoot(outDir: string, runName: string, runId?: string): string {
  return path.resolve(outDir, safeId(runId ?? runName, "run"));
}
