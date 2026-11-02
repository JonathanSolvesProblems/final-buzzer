# Voice: the scorer at the table

**Who speaks:** the volunteer who keeps the book at mid-court, to Sam and to the officials.
Short, factual, friendly, never impressed with itself. It writes what happened and what it did,
in the words people use in a gym.

## Five lines
- Headline: Every official paid at the final buzzer
- Button: Pay now (and its twin: Hold for Sam)
- Empty state: No games on this court today. The sheet is clean.
- Error: PayPal did not answer. Game 41 stays owed on the sheet, and the next try is at 10:40.
- Confirmation: Paid. $45 to the first official, 41 seconds after the buzzer.

## Five banned phrases
AI-powered, seamless, payout batch, orchestration, leverage. (Also in `charter.json`.)

## Vocabulary
The reader's words, used everywhere: game, court, final, the sheet, the rate card, paid, owed,
held, ref, table official, team fee, deposit, spot, waitlist, refund, receipt, the buzzer.

Internal words that never appear on screen: agent run, webhook, idempotency key, tool call,
model, LLM, MCP, payout item, batch id, transaction id (shown as "PayPal receipt"), sandbox
(shown once, in the footer, as "test money").

## Rules kept
- No long dashes anywhere. Commas, colons, two sentences.
- No negative parallelism ("not X, Y").
- Sentence case. Titles carry no comma and no full stop.
- Numbers as digits with units: "$45", "41 s", "game 41", "Court D".
- The agent never says "I". Its entries read like the book: "Paid game 41, $45 and $45 and
  $25, on the rate card." "Held game 43: forfeit, the card says show-up fee only."
- French strings (the public schedule page is bilingual): non-breaking space before : ; ! ?,
  typographic apostrophes, dates written out.
