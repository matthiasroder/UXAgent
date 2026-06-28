import path from "node:path";
import { ensureDir, writeJson, writeText } from "./artifacts.js";
import { EvidenceReviewer } from "./agents/reviewer.js";
import { DemoUserAgent } from "./agents/demoUserAgent.js";
import { REVIEWER_CONTRACT, USER_AGENT_CONTRACT } from "./agents/contracts.js";
import { loadConfig } from "./config.js";
import { runRoot, sessionId } from "./ids.js";
import { runSession } from "./browser/runSession.js";
import type { ActionLogEntry, PersonaConfig, SessionArtifact, SessionReview, TaskConfig, TaskOutcome, UXAgentConfig } from "./types.js";

export interface RunOptions {
  configPath: string;
  outDir: string;
}

export interface RunResult {
  config: UXAgentConfig;
  runDir: string;
  exitCode: number;
  reviews: SessionReview[];
}

export class UnsupportedModeError extends Error {
  constructor(mode: string) {
    super(`Mode "${mode}" is not implemented yet. Use "demo" for the deterministic local MVP.`);
    this.name = "UnsupportedModeError";
  }
}

export async function runUxAgent(options: RunOptions): Promise<RunResult> {
  const config = await loadConfig(options.configPath);
  if (config.mode === "live") {
    throw new UnsupportedModeError(config.mode);
  }

  const runDir = runRoot(options.outDir, config.runName, config.runId);
  await ensureDir(runDir);

  await writeJson(path.join(runDir, "run-metadata.json"), {
    runName: config.runName,
    runId: config.runId,
    targetUrl: config.targetUrl,
    mode: config.mode,
    startedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
    },
    counts: {
      personas: config.personas.length,
      tasks: config.tasks.length,
      sessions: config.personas.length * config.tasks.length,
    },
    contracts: {
      userAgent: USER_AGENT_CONTRACT,
      reviewer: REVIEWER_CONTRACT,
    },
  });

  const userAgent = new DemoUserAgent();
  const reviewer = new EvidenceReviewer();
  const reviews: SessionReview[] = [];
  let exitCode = 0;

  for (const persona of config.personas) {
    for (const task of config.tasks) {
      let session: SessionArtifact;
      try {
        session = await runSession({
          config,
          persona,
          task,
          runDir,
          userAgent,
        });
      } catch (error) {
        session = await createSessionExceptionArtifact(config, persona, task, runDir, error);
      }

      try {
        const result = await reviewer.reviewSession({ config, session });
        reviews.push(result.review);
        await writeJson(path.join(session.sessionDir, "review.json"), result.review);
        await writeText(path.join(session.sessionDir, "review.md"), result.markdown);
      } catch (error) {
        const fallback = fallbackReview(session, error);
        reviews.push(fallback);
        await writeJson(path.join(session.sessionDir, "review.json"), fallback);
        await writeText(path.join(session.sessionDir, "review.md"), `# Session Review: ${session.sessionId}\n\nReviewer failed: ${errorMessage(error)}\n`);
        exitCode = 1;
      }

      if (session.outcome.status === "error") {
        exitCode = 1;
      }
    }
  }

  const aggregate = await reviewer.aggregate(config, reviews);
  await writeJson(path.join(runDir, "aggregate-report.json"), aggregate.report);
  await writeText(path.join(runDir, "aggregate-report.md"), aggregate.markdown);

  return { config, runDir, exitCode, reviews };
}

async function createSessionExceptionArtifact(
  config: UXAgentConfig,
  persona: PersonaConfig,
  task: TaskConfig,
  runDir: string,
  error: unknown,
): Promise<SessionArtifact> {
  const id = sessionId(persona.id, task.id);
  const sessionDir = path.join(runDir, "sessions", id);
  const timestamp = new Date().toISOString();
  const outcome: TaskOutcome = {
    status: "error",
    summary: `Session failed before normal artifact completion: ${errorMessage(error)}`,
    evidence: [],
    error: errorMessage(error),
  };
  const actions: ActionLogEntry[] = [
    {
      step: 0,
      type: "error",
      timestamp,
      note: outcome.summary,
    },
  ];
  const artifact: SessionArtifact = {
    sessionId: id,
    sessionDir,
    metadata: {
      sessionId: id,
      persona: {
        id: persona.id,
        name: persona.name,
        profile: persona.profile,
      },
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        successCriteria: task.successCriteria,
      },
      targetUrl: task.resolvedUrl ?? config.targetUrl,
      startedAt: timestamp,
      endedAt: timestamp,
      status: "error",
    },
    actions,
    outcome,
    thinkAloud: [`Session failed before normal browser execution completed: ${errorMessage(error)}`],
  };

  await ensureDir(sessionDir);
  await writeJson(path.join(sessionDir, "metadata.json"), artifact.metadata);
  await writeJson(path.join(sessionDir, "actions.json"), artifact.actions);
  await writeJson(path.join(sessionDir, "outcome.json"), artifact.outcome);
  await writeText(path.join(sessionDir, "think-aloud.md"), `# Think-Aloud Notes: ${persona.name}\n\n- ${artifact.thinkAloud[0]}\n`);

  return artifact;
}

function fallbackReview(session: SessionArtifact, error: unknown): SessionReview {
  return {
    sessionId: session.sessionId,
    personaId: session.metadata.persona.id,
    taskId: session.metadata.task.id,
    outcome: session.outcome,
    findings: [
      {
        id: `${session.sessionId}-review-error`,
        severity: "high",
        affectedJourney: session.metadata.task.title,
        evidence: session.outcome.evidence,
        suggestedFix: "Fix the reviewer or artifact write failure, then rerun this session.",
        summary: `Reviewer failed: ${errorMessage(error)}`,
      },
    ],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
