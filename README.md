# Final Buzzer

Every official paid at the final buzzer. A youth basketball tournament's money, run by an agent on PayPal.

**Live demo: https://finalbuzzer.jonathansolvesproblems.com** (the board) · [/score.html](https://finalbuzzer.jonathansolvesproblems.com/score.html) (score a game and watch the agent pay) · [/money.html](https://finalbuzzer.jonathansolvesproblems.com/money.html) (every payout and invoice). PayPal sandbox, test money.

Sam runs a youth basketball association. Its invitational is 88 games over a weekend, two referees and a table official on every game, 52 teams paying an entry fee. After last year's tournament the officials were paid by hand, one e-transfer at a time, and some teams never paid at all.

Final Buzzer is the association's treasurer as an agent. When a game goes final on the scorer's phone, the agent reads the game sheet, the rate card and PayPal's own record, decides whether to pay now, hold for Sam, or fold into an end-of-day batch, and pays the officials through PayPal Payouts. Before the tournament it invoices every team through PayPal Invoicing and chases the ones that stall: a reminder, a deposit-and-balance split, or the spot released to the waitlist. When a gym closes it re-plans the day against the schedule's own rules and refunds, pro rata, the games that cannot be played. Claude makes each of those choices; code enforces the rate card; PayPal confirms the money.

Sam and Northside Youth Basketball are a labelled composite. The role is real: one volunteer who scores games from a phone and settles the money afterwards. The association, its venues and its teams are not real; the tournament's shape follows a real 88-game invitational.

Built for the PayPal AI Hackathon, November 2026, by [Jonathan Andrei](https://jonathansolvesproblems.com).

## How to run it

Node 24 (it runs the TypeScript directly, no build step). Checked on a clean clone, 7 November 2026:

```
git clone https://github.com/JonathanSolvesProblems/final-buzzer.git
cd final-buzzer
npm install
npm test          # 31 tests: the money gate, the feed, the re-plan rules, Sam's tap
npm run board     # http://localhost:4173/  the board, /score.html, /money.html
```

With no keys the board serves the committed results read-only. To have the agent pay live on the PayPal sandbox, add a sandbox app and a Claude key (`copy .env.example .env`, steps in `docs/SANDBOX-SETUP.md`), then run `node src/cli/watch.ts` beside the board and score a game on `/score.html`. Every other command is under [All commands](#all-commands).

## What the agent decides, and where

| Moment | The model chooses between | Code |
|---|---|---|
| A game goes final | pay now, hold for Sam, fold into the end-of-day batch | `src/agent/buzzer.ts`, prompt in `src/agent/prompts/buzzer.md` |
| An entry fee stalls | wait, remind, split into deposit and balance, release the spot, hold | `src/agent/invoices.ts`, prompt in `src/agent/prompts/invoices.md` |
| A gym closes | where each affected game goes, or that it cannot be played | `src/agent/replan.ts`, prompt in `src/agent/prompts/replan.md` |
| Sam taps a held game | pay in full, pay the show-up fee, pay nobody | `src/agent/resolve.ts` |

The decision is a tool call with a schema (`src/agent/decision.ts`), never prose parsed afterwards. Every decision passes through `src/agent/guards.ts` before PayPal is called: amounts must equal the rate card to the cent, people must be on the sheet, caps hold, and a forfeit or a missing official cannot be paid at full rate by anyone but Sam. A re-plan is re-checked move by move against the schedule's rules (team rest, playoff order, free courts) before anything changes. A blocked decision is recorded as a block, with the reason, never rewritten.

## Built on PayPal

- **Payouts** (REST, `src/paypal/payouts.ts`): one batch per game, one item per official. The `sender_batch_id` is one per game and PayPal refuses a repeat for thirty days, so a re-saved score cannot pay twice even if the agent's own ledger were lost.
- **PayPal MCP server** (`@paypal/mcp` over stdio, `src/paypal/mcp.ts`): the agent's hands for invoicing, refunds and transaction search. Each agent gets an allowlist, enforced in code.
- **Invoicing** (REST, `src/paypal/invoicing.ts`): recording e-transfers against an invoice, which is how most clubs still pay.
- **Webhooks** (`src/webhooks.ts`): payout batches and invoice payments update the ledger as PayPal reports them, signature-verified when a webhook id is configured.
- **Claude** (`@anthropic-ai/sdk`, `src/agent/loop.ts`): the loop runs on `stop_reason`, with a terminal decision tool.
- **Bryntum Scheduler** (`web/board.js`): the court-by-time board. Every game is a flap tile whose face is its money state, read from the agent's ledger every few seconds. A tile opens its game: who was paid, how much, the PayPal batch; a held tile opens Sam's decision; a game not started links to the scorer's page. "Close a gym" sends the agent's re-plan back onto the same grid.
- **AG Grid** (`web/money.js`): the treasurer's money board, every payout, hold and invoice. Rows keep their identity across polls, so a payout that lands while Sam watches flashes in place; a pinned total row carries the dollars and the median seconds; one search runs across all three grids; "Export for the accountant" writes the officials' pay and the entry fees to CSV; a row opens its game on the board.
- **Hosting** (`Dockerfile`, `deploy/`): two containers from one image on a small VPS behind Traefik with HTTPS. One serves the board, the money board, the scorer's page and the PayPal webhook receiver; the other is the agent on duty, paying as games go final. A daily cap on agent runs keeps a public demo from spending without limit.

Everything runs on the PayPal sandbox with test money. Nothing here has touched a real balance.

## All commands

```
copy .env.example .env         # the sandbox app and the Claude key, see docs/SANDBOX-SETUP.md
node src/cli/build-sheet.ts    # the officials' sheet for the 88 games
node src/cli/build-teams.ts    # the teams to invoice

npm run board                  # the board, the money board and the scorer's phone on http://localhost:4173/
node src/cli/watch.ts                    # the agent on duty: pays as games go final on /score.html
node src/cli/live.ts --game 17           # one game from the terminal: final, decide, pay, measure
node src/cli/replay.ts --day 2026-05-16  # Saturday's 34 games through the agent, in order
node src/cli/settle.ts --day 2026-05-16 --run-id <run>   # the end-of-day batch
node src/cli/invoice.ts                  # invoice every team
node src/cli/chase.ts --from 2026-04-10 --to 2026-05-10  # the chase, day by day
node src/cli/replan.ts --court "Gym D" --from 14:00      # a gym closes at 14:00
node src/cli/reconcile.ts                # read the money back from PayPal's transaction search

npm test                       # the guards, the feed, the re-plan rules
npm run check                  # fails when this file's numbers disagree with results/
```

Ablations: `replay.ts --paypal off` runs the same day with PayPal removed (the agent decides, nothing can be paid), and `replay.ts --scripted` replaces the model with a fixed rule.

## What is real and what is staged

- The tournament document (`data/tournament-2026.json`) has the shape of a real 88-game invitational: 8 divisions, 12 courts, 52 teams, pools and playoffs, the real start times. Names are the composite's.
- The officials' sheet is generated (`data/officials-2026.json`) and says so: Officials A to X with sandbox addresses, four of whom asked to be paid once a day.
- The rate card (`data/rate-card.json`) and the entry fee (`data/fees.json`) are placeholders marked `provisional: true`, and the board says so.
- Two game cases are staged and labelled in the sheet file: one forfeit, one game with no table official. The chase replay stages when teams pay, one manager's reply and one waitlisted team, labelled in `data/teams-2026.json`.
- Scores in the replay are replay values. Seconds from buzzer to payout are PayPal's completion time against the moment the score was saved.
- The Bryntum build is the trial and prints its watermark.

## What it cannot do

It cannot pay an amount that is not on the rate card. It cannot pay a forfeit's show-up fee until the card carries one. It cannot pay a game PayPal already shows paid, not even on Sam's tap: the board offers only "nothing more", and `src/agent/resolve.ts` refuses a second payment. It cannot report a payout PayPal has not confirmed. It cannot move a game onto a team that played within two hours, or a pool game past its division's first playoff.

## Results

Officials paid a median of 40.2 s after the final buzzer: Saturday's 34 games replayed live through the agent and the PayPal sandbox, 2 November 2026 (`results/buzzer-replay.json`).

| | Result |
|---|---|
| Games paid | 28 of Saturday's 34, 81 officials, $3,145 CAD paid out |
| Buzzer to payout | median 40.2 s, fastest 38.7 s, slowest 45.8 s. About 7 s is the agent deciding; the rest is PayPal completing the batch |
| Held for Sam | 3: a game PayPal already showed paid (a re-saved score), the staged forfeit, the game with no table official |
| End-of-day batch | 12 shares folded during the day, paid that evening as one payout per official, $420 (`results/settle-2026-05-16.json`) |
| Errors | 0 |
| Model cost | about $1.40 for the 34 games |

Seconds are PayPal's batch completion time minus the moment the score was saved. Amounts are test money on a provisional rate card.

**Read back from PayPal, not from the agent's ledger** (`results/reconcile.json`, through the MCP server's `list_transactions`): all 99 payout items the ledger holds appear in PayPal's transaction search, matched by item id, across 30 games and the four evening batches: $3,795 CAD, with $31.68 in PayPal payout fees. That total covers the replay, the evening batch and the two single-game runs.

**With PayPal switched off** (`results/ablation-no-paypal.json`): the agent held all 34 games. It could not check PayPal's record of a game, so it paid nobody rather than risk paying twice.

**With a fixed rule in place of the agent** (`results/ablation-scripted.json`, a dry run from the same starting state): the rule would have paid the re-saved game a second time, and ignored the four officials who asked to be paid once a day. The forfeit and the missing official it could not pay either, because the code gate refuses them whoever decides: those two catches belong to the gate, the duplicate and the end-of-day preference to the agent.

**Entry fees** (`results/chase.json`, `results/invoices.json`): all 52 teams invoiced through PayPal's MCP server, then the chase replayed day by day from 10 April to 12 May against the sandbox, with staged payments recorded on each invoice as e-transfers.

| | Result |
|---|---|
| Teams paid | 50 of 52 by the deadline or soon after |
| Reminders | 32, sent through PayPal's `send_invoice_reminder`, never more than three per invoice, never two within three days |
| Split | 1: the manager asked to pay in two parts, so the invoice was cancelled and replaced by a deposit (paid two days later) and a $175 balance, which was then chased on its own due date |
| Released | 1: a manager who never answered three reminders, a week past the deadline, with a team waiting in that division. The invoice was cancelled and the waitlisted team invoiced |
| Held for Sam | 0 |
| Model cost | about $2.25 for 114 model calls |

A first run of the chase found two faults, both fixed before this run: after a split the agent kept reading the cancelled original invoice, and it split a manager who had never asked for a plan.

**A gym closes** (`results/replan.json`): Gym E closes at 9:00 on Sunday. Gym EF is the same floor with the divider down, so its eight games go too: ten games in all, four of them finals.

| | Result |
|---|---|
| Games moved | 9 of 10: the finals and the semi-final to Gym F (the half of the floor still open) at their original times, both quarter-finals to 12:45 so they end before the 14:00 semi, one pool game across town to Lakeside |
| Cannot be played | 1: a Mini Boys pool game at 9:00. Every court is taken before the division's 10:15 playoffs, and a pool game cannot land after them |
| Refunds | 2 × $175 CAD, one per team, by the fee rule (entry fee divided by the games the team was scheduled to play), paid through PayPal Payouts because both teams had paid by e-transfer |

Every move is re-checked in code before anything changes: free court, both halves of a joined court, team rest of two hours, playoff order. Building this run found two gaps in those rules, both fixed with tests: joined courts sharing a floor with their halves, and playoff games depending on the games that feed them.

`npm run check` fails if any figure in this section stops matching those files.

## Licence

MIT.
