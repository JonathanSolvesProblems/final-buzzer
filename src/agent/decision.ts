/** The decision the model must reach, as a tool schema: structure comes from tool use, not prose. */

export interface Decision {
  choice: "pay_now" | "hold" | "fold";
  reason: string;
  items?: Array<{ official_id: string; role: "referee" | "table"; amount: number }> | null;
  fold_official_ids?: string[] | null;
  question_for_treasurer?: string | null;
  flags: {
    forfeit: boolean;
    official_missing: boolean;
    already_paid: boolean;
    amount_uncertain: boolean;
    reopened_score: boolean;
  };
}

export const decideTool = {
  name: "decide",
  description:
    "Record the decision for this game. Call it exactly once, after you have read the sheet, the rate card and PayPal. " +
    "pay_now: pay the listed items through PayPal Payouts now; list every official on the sheet except the ones in fold_official_ids, each with the role and the exact amount from the rate card. " +
    "hold: pay nobody and put the game in front of Sam with one plain question. " +
    "fold: pay nobody now; every official on this game goes into their end-of-day batch. " +
    "The flags are a self-check: set each one from what you observed, not from what you assume.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["choice", "reason", "flags"],
    properties: {
      choice: { type: "string", enum: ["pay_now", "hold", "fold"] },
      reason: { type: "string", description: "One or two sentences in the scorer's words, naming what you observed." },
      items: {
        type: ["array", "null"],
        description: "For pay_now only: who is paid now and how much. Omit officials you are folding.",
        items: {
          type: "object", additionalProperties: false, required: ["official_id", "role", "amount"],
          properties: {
            official_id: { type: "string" },
            role: { type: "string", enum: ["referee", "table"] },
            amount: { type: "number", description: "Exactly the rate card figure for this role, e.g. 45 or 25." },
          },
        },
      },
      fold_official_ids: { type: ["array", "null"], items: { type: "string" }, description: "Officials whose pay for this game waits for their end-of-day batch." },
      question_for_treasurer: { type: ["string", "null"], description: "For hold only: the one question Sam answers with a tap." },
      flags: {
        type: "object", additionalProperties: false,
        required: ["forfeit", "official_missing", "already_paid", "amount_uncertain", "reopened_score"],
        properties: {
          forfeit: { type: "boolean" },
          official_missing: { type: "boolean" },
          already_paid: { type: "boolean", description: "PayPal already holds a payout for this game." },
          amount_uncertain: { type: "boolean", description: "You could not compute an amount from the card." },
          reopened_score: { type: "boolean", description: "The score was final before and has been changed." },
        },
      },
    },
  },
} as const;
