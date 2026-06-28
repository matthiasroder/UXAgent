import path from "node:path";
import { REVIEWER_CONTRACT, type Reviewer, type ReviewerInput, type ReviewerResult } from "./contracts.js";
import type { AggregateReport, ReviewFinding, SessionReview, UXAgentConfig } from "../types.js";

const severityRank = { low: 1, medium: 2, high: 3 } as const;

export class EvidenceReviewer implements Reviewer {
  readonly name = "evidence-reviewer";
  readonly contract = REVIEWER_CONTRACT;

  async reviewSession(input: ReviewerInput): Promise<ReviewerResult> {
    const { session } = input;
    const findings = createFindings(session.sessionId, session.metadata.task.title, session.outcome);
    const review: SessionReview = {
      sessionId: session.sessionId,
      personaId: session.metadata.persona.id,
      taskId: session.metadata.task.id,
      outcome: session.outcome,
      findings,
    };

    return {
      review,
      markdown: renderSessionReview(review, input.config.reviewer.minSeverity),
    };
  }

  async aggregate(config: UXAgentConfig, reviews: SessionReview[]): Promise<{ report: AggregateReport; markdown: string }> {
    const report: AggregateReport = {
      runName: config.runName,
      runId: config.runId,
      generatedAt: new Date().toISOString(),
      taskMatrix: reviews.map((review) => ({
        sessionId: review.sessionId,
        personaId: review.personaId,
        taskId: review.taskId,
        status: review.outcome.status,
        summary: review.outcome.summary,
      })),
      findings: reviews.flatMap((review) => review.findings),
    };

    return {
      report,
      markdown: renderAggregateReport(report, config.reviewer.minSeverity),
    };
  }
}

function createFindings(sessionId: string, taskTitle: string, outcome: SessionReview["outcome"]): ReviewFinding[] {
  if (outcome.status === "passed") {
    return [
      {
        id: `${sessionId}-confirmation`,
        severity: "low",
        affectedJourney: taskTitle,
        evidence: outcome.evidence,
        suggestedFix: "Keep the successful confirmation path visible and compare this run against future design changes.",
        summary: "The task reached a confirmation state in the demo run.",
      },
    ];
  }

  return [
    {
      id: `${sessionId}-${outcome.status}`,
      severity: outcome.status === "error" ? "high" : "medium",
      affectedJourney: taskTitle,
      evidence: outcome.evidence,
      suggestedFix:
        outcome.status === "error"
          ? "Fix the blocking browser or page error before judging the interface."
          : "Make the task path expose clearer controls, progress feedback, or confirmation copy.",
      summary: outcome.summary,
    },
  ];
}

function renderSessionReview(review: SessionReview, minSeverity: keyof typeof severityRank): string {
  const visibleFindings = review.findings.filter((finding) => severityRank[finding.severity] >= severityRank[minSeverity]);
  const lines = [
    `# Session Review: ${review.sessionId}`,
    "",
    `Outcome: ${review.outcome.status}`,
    "",
    review.outcome.summary,
    "",
    "## Findings",
    "",
  ];

  if (visibleFindings.length === 0) {
    lines.push(`No findings at or above ${minSeverity} severity.`);
  } else {
    for (const finding of visibleFindings) {
      lines.push(`- ${finding.severity.toUpperCase()}: ${finding.summary}`);
      lines.push(`  Affected journey: ${finding.affectedJourney}`);
      lines.push(`  Evidence: ${finding.evidence.map((item) => path.basename(item)).join(", ") || "none"}`);
      lines.push(`  Suggested fix: ${finding.suggestedFix}`);
    }
  }

  return lines.join("\n");
}

function renderAggregateReport(report: AggregateReport, minSeverity: keyof typeof severityRank): string {
  const visibleFindings = report.findings.filter((finding) => severityRank[finding.severity] >= severityRank[minSeverity]);
  const lines = [
    `# UXAgent Aggregate Report: ${report.runName}`,
    "",
    "## Task Matrix",
    "",
    "| Session | Persona | Task | Status | Summary |",
    "| --- | --- | --- | --- | --- |",
    ...report.taskMatrix.map(
      (row) => `| ${row.sessionId} | ${row.personaId} | ${row.taskId} | ${row.status} | ${escapeTable(row.summary)} |`,
    ),
    "",
    "## Findings",
    "",
  ];

  if (visibleFindings.length === 0) {
    lines.push(`No findings at or above ${minSeverity} severity.`);
  } else {
    for (const finding of visibleFindings) {
      lines.push(`- ${finding.severity.toUpperCase()}: ${finding.summary}`);
      lines.push(`  Affected journey: ${finding.affectedJourney}`);
      lines.push(`  Evidence: ${finding.evidence.join(", ") || "none"}`);
      lines.push(`  Suggested fix: ${finding.suggestedFix}`);
    }
  }

  return lines.join("\n");
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
