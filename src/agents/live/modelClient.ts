import type { ActionLogEntry, LiveActionDecision, LivePageSnapshot, PersonaConfig, TaskConfig } from "../../types.js";

export interface LiveActionPrompt {
  persona: PersonaConfig;
  task: TaskConfig;
  page: LivePageSnapshot;
  recentActions: ActionLogEntry[];
  allowedActions: string[];
  testDataKeys: string[];
}

export interface LiveModelClient {
  chooseAction(prompt: LiveActionPrompt): Promise<LiveActionDecision>;
}
