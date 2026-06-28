import type { Page } from "playwright";
import type {
  ActionLogEntry,
  AggregateReport,
  ExecutionLimits,
  PersonaConfig,
  SessionArtifact,
  SessionReview,
  TaskConfig,
  TaskOutcome,
  UXAgentConfig,
} from "../types.js";

export const USER_AGENT_CONTRACT = [
  "Role: simulated user.",
  "Drive the rendered browser page through visible interactions only.",
  "Return actions, task outcome, and think-aloud notes.",
  "Do not produce UX critique findings; that belongs to the reviewer role.",
].join("\n");

export const REVIEWER_CONTRACT = [
  "Role: UX reviewer.",
  "Review immutable evidence artifacts after the simulated user session is complete.",
  "Produce severity, affected journey, evidence references, and suggested fixes.",
  "Do not drive browser actions or modify session evidence.",
].join("\n");

export interface UserAgentInput {
  page: Page;
  persona: PersonaConfig;
  task: TaskConfig;
  limits: ExecutionLimits;
  captureEvidence: (label: string) => Promise<string>;
}

export interface UserAgentResult {
  actions: ActionLogEntry[];
  outcome: TaskOutcome;
  thinkAloud: string[];
}

export interface UserAgent {
  readonly name: string;
  readonly contract: string;
  run(input: UserAgentInput): Promise<UserAgentResult>;
}

export interface ReviewerInput {
  config: UXAgentConfig;
  session: SessionArtifact;
}

export interface ReviewerResult {
  review: SessionReview;
  markdown: string;
}

export interface Reviewer {
  readonly name: string;
  readonly contract: string;
  reviewSession(input: ReviewerInput): Promise<ReviewerResult>;
  aggregate(config: UXAgentConfig, reviews: SessionReview[]): Promise<{
    report: AggregateReport;
    markdown: string;
  }>;
}
