export type Severity = "low" | "medium" | "high";
export type RunMode = "demo" | "live";
export type TaskStatus = "passed" | "failed" | "error";

export interface PersonaConfig {
  id: string;
  name: string;
  profile: string;
  goals: string[];
  constraints: string[];
}

export interface TaskConfig {
  id: string;
  title: string;
  description: string;
  successCriteria: string[];
  startPath?: string;
  resolvedUrl?: string;
}

export interface ExecutionLimits {
  maxSteps: number;
  actionDelayMs: number;
  navigationTimeoutMs: number;
  recordVideo: boolean;
}

export interface ReviewerConfig {
  minSeverity: Severity;
}

export interface UXAgentConfig {
  runName: string;
  runId?: string;
  targetUrl: string;
  mode: RunMode;
  limits: ExecutionLimits;
  personas: PersonaConfig[];
  tasks: TaskConfig[];
  reviewer: ReviewerConfig;
}

export interface ActionLogEntry {
  step: number;
  type: string;
  target?: string;
  value?: string;
  screenshot?: string;
  timestamp: string;
  note: string;
}

export interface TaskOutcome {
  status: TaskStatus;
  summary: string;
  evidence: string[];
  error?: string;
}

export interface SessionMetadata {
  sessionId: string;
  persona: Pick<PersonaConfig, "id" | "name" | "profile">;
  task: Pick<TaskConfig, "id" | "title" | "description" | "successCriteria">;
  targetUrl: string;
  startedAt: string;
  endedAt?: string;
  status: TaskStatus;
  video?: string;
}

export interface SessionArtifact {
  sessionId: string;
  sessionDir: string;
  metadata: SessionMetadata;
  actions: ActionLogEntry[];
  outcome: TaskOutcome;
  thinkAloud: string[];
}

export interface ReviewFinding {
  id: string;
  severity: Severity;
  affectedJourney: string;
  evidence: string[];
  suggestedFix: string;
  summary: string;
}

export interface SessionReview {
  sessionId: string;
  personaId: string;
  taskId: string;
  outcome: TaskOutcome;
  findings: ReviewFinding[];
}

export interface AggregateReport {
  runName: string;
  runId?: string;
  generatedAt: string;
  taskMatrix: Array<{
    sessionId: string;
    personaId: string;
    taskId: string;
    status: TaskStatus;
    summary: string;
  }>;
  findings: ReviewFinding[];
}
