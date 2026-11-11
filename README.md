# Final Buzzer

Every official paid at the final buzzer. A youth basketball tournament's money, run by an agent on PayPal.

**Live demo: https://finalbuzzer.jonathansolvesproblems.com** (the board) · [/score.html](https://finalbuzzer.jonathansolvesproblems.com/score.html) (score a game and watch the agent pay) · [/money.html](https://finalbuzzer.jonathansolvesproblems.com/money.html) (every payout and invoice) · [/official.html](https://finalbuzzer.jonathansolvesproblems.com/official.html) (one official's weekend, as they see it). PayPal sandbox, test money.

Sam runs a youth basketball association. Its invitational is 88 games over a weekend, two referees and a table official on every game, 52 teams paying an entry fee. After last year's tournament the officials were paid by hand, one e-transfer at a time, and some teams never paid at all.

Final Buzzer is the association's treasurer as an agent. When a game goes final on the scorer's phone, the agent reads the game sheet, the rate card and PayPal's own record, decides whether to pay now, hold for Sam, or fold into an end-of-day batch, and pays the officials through PayPal Payouts. Before the tournament it invoices every team through PayPal Invoicing and chases the ones that stall: a reminder, a deposit-and-balance split, or the spot released to the waitlist. When a gym closes it re-plans the day against the schedule's own rules and refunds, pro rata, the games that cannot be played. Claude makes each of those choices; code enforces the rate card; PayPal confirms the money.

The schedule is real: Montreal United's 2026 Lindsay A. Burnett Invitational in Montreal, 88 games in 8 divisions over four days, with the team and venue names changed. I build the club's website and the app that runs its tournaments. Sam and "Northside Youth Basketball" are a labelled composite: the role is real, one volunteer who scores games from a phone and settles the money afterwards, but the club's founder, Hugh Scarlett, has not reviewed Final Buzzer, and the officials, rate card and entry fee are placeholders.

Why the buzzer: officials are scarce and leaving. In the 2023 National Officiating Survey (35,813 officials, NASO, reported by the NFHS in November 2023), 18.3% said they are paid what they are worth, and 59% agreed that most new officials quit within their first three years. Slow pay is part of it. Prep Network reported in March 2026 that Wyatt Gustafson, a part-time referee in Minnesota, saw colleagues "get paid for assignments months late, and sometimes never get paid at all"; in his words, "There's no job in the world that pays people three four months after they do work for you." In September 2026 the Central Blair Recreation and Park Commission in Altoona, Pennsylvania, told the Altoona Mirror that its referees wait up to two weeks for a cheque to clear, and that it will try cash in pay envelopes this basketball season to recruit and retain them, a step its executive director called "a big red flag" to be hedged with safeguards. The tools an association can buy today each do one side of this: SportsEngine and LeagueApps collect registration payments from families and teams, assignr schedules the referees, and ArbiterPay sends officials their pay once the association has approved it; Refr Sports, which that referee went on to co-found, assigns games and pays within seven days of the assignment. As far as their public pages say, none of them reads the game sheet and PayPal's own record at the final buzzer and decides. Every number and product claim in this file is traced in [devpost/sources.md](devpost/sources.md).

Built for the PayPal AI Hackathon, November 2026, by [Jonathan Andrei](https://jonathansolvesproblems.com).

## How to run it

Node 24 (it runs the TypeScript directly, no build step). Checked on a clean clone with no keys, 10 November 2026:

```
git clone https://github.com/JonathanSolvesProblems/final-buzzer.git
cd final-buzzer
npm install
npm test          # 36 tests: the money gate, the feed, the re-plan rules, Sam's tap, the daily cap, the webhooks
npm run board     # http://localhost:4173/  the board, /score.html, /money.html, /official.html
```

`npm run board` keeps the terminal and prints the address. With no keys the board shows the committed results: Sam's taps and gym closures are refused, and a score saved on `/score.html` is written to `data/tournament-2026.json` with no agent to act on it (`git checkout -- data` undoes it). To have the agent pay live on the PayPal sandbox, add a sandbox app and a Claude key (`cp .env.example .env`, or `copy` on Windows; steps in `docs/SANDBOX-SETUP.md`), then run `node src/cli/watch.ts` beside the board and score a game on `/score.html`. A public copy also sets `SAM_PIN` (the board asks for it before a tap pays or a gym closes; scoring stays open) and `MODEL_RUNS_PER_DAY`. Every other command is under [All commands](#all-commands).

The public checks: `npx newman run postman/final-buzzer.postman_collection.json` runs 11 requests and 31 assertions against the live site, read-only: every successful payout carries a PayPal batch id and a completion time, every amount is on the rate card, the agent's run is kept with its payouts, every webhook in the public log was signature-verified (an event whose signature fails is rejected and kept out of it), and Sam's tap and a gym closure are refused without the PIN. The last run is committed as `results/postman-run.txt`, 0 failures.

## What the agent decides, and where

| Moment | The model chooses between | Code |
|---|---|---|
| A game goes final | pay now, hold for Sam, fold into the end-of-day batch | `src/agent/buzzer.ts`, prompt in `src/agent/prompts/buzzer.md` |
| An entry fee stalls | wait, remind, split into deposit and balance, release the spot, hold | `src/agent/invoices.ts`, prompt in `src/agent/prompts/invoices.md` |
| A gym closes | where each affected game goes, or that it cannot be played | `src/agent/replan.ts`, prompt in `src/agent/prompts/replan.md` |
| Sam taps a held game | pay in full, pay the show-up fee, pay nobody | `src/agent/resolve.ts` |

The decision is a tool call with a schema (`src/agent/decision.ts`), never prose parsed afterwards. Every decision passes through `src/agent/guards.ts` before PayPal is called: amounts must equal the rate card to the cent, people must be on the sheet, caps hold, and a forfeit or a missing official cannot be paid at full rate by anyone but Sam. A re-plan is re-checked move by move against the schedule's rules (team rest, playoff order, free courts) before anything changes. A blocked decision is recorded as a block, with the reason, never rewritten.

The agent's run stays with the record (`agent` on each ledger payout and hold: what it asked for and when, when it chose). On the board, tapping a paid tile opens the game's drawer with that run on a 60-second ruler: the sheet, the rate card, PayPal's record and the officials' day asked for at about 1.6 s, the choice at about 6 s, the gate's check, and PayPal's confirmation. Records from before this field existed were given theirs from the committed traces (`node src/cli/backfill-agent.ts`).

## How the money moves

- **Payouts** (REST, `src/paypal/payouts.ts`): one batch per game, one item per official. The `sender_batch_id` is one per game within a deployment (the public site runs as `public`) and PayPal refuses a repeat for thirty days, so inside a deployment a re-saved score cannot pay twice even if the agent's own ledger were lost. Across deployments the agent reads the game's recorded batch back from PayPal before it decides, which is how the replay's re-saved game 17 was caught.
- **PayPal MCP server** (`@paypal/mcp` over stdio, `src/paypal/mcp.ts`): the agent's tool layer for invoicing (create, send, remind, cancel, record a payment), transaction search, and refunds for a team that paid through PayPal. Each agent gets an allowlist, enforced in code. The committed re-plan's two refunded teams had paid by e-transfer, so their refunds went out as payouts. On 10 November one team's entry fee was paid through PayPal on its invoice and the same closure was run again: that team's $175 came back through the MCP server's `create_refund` against PayPal's capture of the payment (refund `8XF64638PY750900U`, COMPLETED, `results/replan-paypal-refund.json`). The other team's payout in that run was refused for lack of sandbox balance, and the file says so.
- **Invoicing** (REST, `src/paypal/invoicing.ts`): a payment made outside PayPal (the composite's teams paid by e-transfer) recorded against its invoice, so the invoice is the one record of who has paid.
- **Webhooks** (`src/webhooks.ts`): payout batches and invoice payments update the ledger as PayPal reports them, signature-verified against the webhook registered for the live site on 8 November 2026. Every event the receiver has seen is listed at [/api/webhooks](https://finalbuzzer.jonathansolvesproblems.com/api/webhooks); until the sandbox app had a webhook, the seconds were read by polling the payout.
- **Claude** (`@anthropic-ai/sdk`, `src/agent/loop.ts`): the loop runs on `stop_reason`, with a terminal decision tool.
- **Bryntum Scheduler** (`web/board.js`): the court-by-time board. Every game is a flap tile whose face is its money state, read from the agent's ledger every few seconds. A tile opens its game: who was paid, how much, the PayPal batch; a held tile opens Sam's decision; a game not started links to the scorer's page. "Close a gym" sends the agent's re-plan back onto the same grid. Drag a game that has not started to another court or time and the drop is checked by `POST /api/check-move` against the same rules the agent's moves are held to (a floor shared by joined courts, two hours between a team's starts, playoff order); the answer is shown on the board and nothing is saved.
- **AG Grid** (`web/money.js`): the treasurer's money board, every payout, hold and invoice. Rows keep their identity across polls, so a payout that lands while Sam watches flashes in place; a pinned total row carries the dollars and the median seconds; one search runs across all three grids; "Export for the accountant" writes the officials' pay and the entry fees to CSV; a row opens its game on the board.
- **Hosting** (`Dockerfile`, `deploy/`): two containers from one image on a small VPS behind Traefik with HTTPS. One serves the board, the money board, the scorer's page and the PayPal webhook receiver; the other is the agent on duty, paying as games go final and writing a heartbeat the board shows. A daily cap on agent runs keeps a public demo from spending without limit, and a tap that pays, or a gym closing, asks for the treasurer's PIN.

Everything runs on the PayPal sandbox with test money. Nothing here has touched a real balance.

## All commands

```
cp .env.example .env           # the sandbox app and the Claude key, see docs/SANDBOX-SETUP.md
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

Ablations: `replay.ts --paypal off` runs the same day with PayPal removed (the agent decides, nothing can be paid), and `replay.ts --scripted` replaces the model with a fixed rule. Both need the sandbox keys and write over the committed files in `results/`; `replay.ts --limit 5 --paypal dry` is the look that sends nothing.

## What is real and what is staged

- The tournament document (`data/tournament-2026.json`) is Montreal United's 2026 Lindsay A. Burnett Invitational: 8 divisions, 12 courts, 52 teams, pools and playoffs, the real start times. Every name and id is replaced.
- The officials' sheet is generated (`data/officials-2026.json`) and says so: Officials A to X with sandbox addresses, four of whom asked to be paid once a day.
- The rate card (`data/rate-card.json`) and the entry fee (`data/fees.json`) are placeholders marked `provisional: true`, and the board says so.
- Two game cases are staged and labelled in the sheet file: one forfeit, one game with no table official. The chase replay stages when teams pay, one manager's reply and one waitlisted team, labelled in `data/teams-2026.json`.
- "Paid" means PayPal completed the payout batch. The officials are test addresses, so PayPal holds each item as unclaimed until that address opens an account; an official routed to a real sandbox PayPal account shows the money received (Official D, game 2, 10 November: $45 in the account 45.6 seconds after the saved score, with the game's note).
- Scores in the replay are replay values. Seconds from buzzer to payout are PayPal's completion time against the moment the score was saved.
- The Bryntum build is the trial and prints its watermark.
- Not built, though planned: checkout for family registration (Orders and the JS SDK), subscriptions for program fees, disputes, and a rate-card editor so the forfeit hold resolves on the board.

## What it cannot do

It cannot pay an amount that is not on the rate card. It cannot pay a forfeit's show-up fee until the card carries one. It cannot pay a game PayPal already shows paid, not even on Sam's tap: the board offers only "nothing more", and `src/agent/resolve.ts` refuses a second payment. It cannot report a payout PayPal has not confirmed. It cannot move a game onto a team that played within two hours, or a pool game past its division's first playoff. If it cannot run on a game at all (the public demo's daily cap, or a failure), the game is held for Sam with the reason on the board, never left on "agent working" or unpaid in silence.

## Results

Officials paid a median of 40.2 s after the final buzzer: Saturday's 34 games replayed live through the agent and the PayPal sandbox, 2 November 2026 (`results/buzzer-replay.json`).

| | Result |
|---|---|
| Games paid | 28 of Saturday's 34, 81 payments to 24 officials, $3,145 CAD paid out |
| Buzzer to payout | median 40.2 s, fastest 38.7 s, slowest 45.8 s. About 7 s is the agent deciding; the rest is PayPal completing the batch |
| Held for Sam | 3: a game PayPal already showed paid (a re-saved score), the staged forfeit, the game with no table official |
| End-of-day batch | 12 shares folded during the day, paid that evening as one payout per official, $420 (`results/settle-2026-05-16.json`) |
| Errors | 0 |
| Model cost | about $1.40 for the 34 games |

Seconds are PayPal's batch completion time minus the moment the score was saved. Amounts are test money on a provisional rate card.

**Read back from PayPal, not from the agent's ledger** (`results/reconcile.json`, through the MCP server's `list_transactions`): all 99 payout items the ledger holds appear in PayPal's transaction search, matched by item id, across 30 games and the four evening batches: $3,795 CAD, with $31.68 in PayPal payout fees. That total covers the replay, the evening batch and the two single-game runs.

**With PayPal switched off** (`results/ablation-no-paypal.json`): the agent held all 34 games. It could not check PayPal's record of a game, so it paid nobody rather than risk paying twice.

**With a fixed rule in place of the agent** (`results/ablation-scripted.json`, a dry run from the same starting state): the rule pays everyone on the sheet at the card rate the moment a game ends. It ignored the four officials who asked to be paid once a day. The forfeit and the missing official it could not pay either, because the code gate refuses them whoever decides. The rule as written does not read PayPal's record, so it is no test of the duplicate: a rule that did read it would catch the re-saved game too, and inside one deployment the per-game `sender_batch_id` catches it anyway. What the model alone added on this day is narrower than the three refusals suggest: the four folds, the hold on game 17 after reading PayPal's record, and one plain question for Sam on each held game.

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

`npm run check` reads every figure in this section back from those files (the model cost estimates excepted: they are priced from token counts, not measured) and fails when one disagrees.

## Licence

MIT.
