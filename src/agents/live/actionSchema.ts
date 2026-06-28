import { z } from "zod";
import type { LiveActionDecision } from "../../types.js";

export const liveActionSchema = z.object({
  action: z.enum(["observe", "click", "type", "scroll", "wait", "back", "finish", "fail"]),
  targetId: z.string().optional(),
  valueKey: z.string().optional(),
  amount: z.number().int().min(-3000).max(3000).optional(),
  reason: z.string().min(1),
  summary: z.string().optional(),
}).strict();

export const liveActionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "reason"],
  properties: {
    action: {
      type: "string",
      enum: ["observe", "click", "type", "scroll", "wait", "back", "finish", "fail"],
    },
    targetId: {
      type: "string",
      description: "Element id from the supplied page snapshot. Required for click and type.",
    },
    valueKey: {
      type: "string",
      description: "Key from configured testData. Required for type.",
    },
    amount: {
      type: "number",
      description: "Scroll delta or wait milliseconds when relevant.",
    },
    reason: {
      type: "string",
      description: "Short reason for this action from the persona's perspective.",
    },
    summary: {
      type: "string",
      description: "Final task summary for finish or fail.",
    },
  },
} as const;

export function parseLiveAction(value: unknown): LiveActionDecision {
  return liveActionSchema.parse(value);
}
