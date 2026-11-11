# Sources

Every number the product shows or the write-up states, and where it comes from. Measurements are the
committed results files; `npm run check` reads the README's figures back from them and fails when one
disagrees. Placeholders are marked as such in the data files and on the board.

## Measured in this build (`results/`)

| Figure | Used in | File and field |
|---|---|---|
| Median 40.2 s from buzzer to payout; fastest 38.7 s, slowest 45.8 s | README, Devpost, the board | `buzzer-replay.json`, `seconds_from_buzzer`: PayPal's `time_completed` on the batch minus the moment the score was saved |
| 28 of Saturday's 34 games paid, 81 officials, $3,145 CAD | README, Devpost | `buzzer-replay.json`, `payouts` |
| 3 games held: a re-saved score PayPal already showed paid, the staged forfeit, the game with no table official | README, Devpost, the board | `buzzer-replay.json`, `outcomes.held` and `holds` |
| 12 shares folded during the day, paid that evening as 4 payouts, $420 | README | `settle-2026-05-16.json`, `settled[].items` |
| All 99 ledger payout items found in PayPal's transaction search: 30 games, $3,795 CAD, $31.68 in fees | README, Devpost | `reconcile.json`, through the MCP server's `list_transactions` |
| With PayPal switched off, all 34 games held | README, Devpost | `ablation-no-paypal.json` |
| A fixed rule ignores the four once-a-day preferences; the forfeit and the missing official are stopped by the code gate whoever decides (the rule as written does not read PayPal, so it says nothing about the duplicate) | README, Devpost | `ablation-scripted.json` |
| 52 teams invoiced, 50 paid, 32 reminders, 1 split, 1 released | README, Devpost, the money page | `invoices.json` (`records`), `chase.json` (`outcomes`) |
| 9 of 10 games moved, 1 cannot be played, 2 refunds of $175 | README, Devpost | `replan.json` |
| First live payout, game 17, 40.2 s, 2 November 2026 | README | `first-live-run.json` |
| Live payouts on the public site: game 10 in 40.6 s (3 November), game 1 in 39.2 s (7 November), Friday's game g002 in 41.2 s with five signature-verified payout webhooks (9 November, batch YYXSX844BZZ5J), Thursday's game 2 in 45.6 s with Official D's $45 received in a sandbox PayPal account (10 November, batch LWECCKCWTM9ZS, item webhook PAYMENT.PAYOUTS-ITEM.SUCCEEDED) | the board, the money page, Devpost | the deployed ledger, `/api/ledger`; `/api/webhooks` |
| The agent's run on each payout and hold (the reads at about 1.6 s, the choice at about 6 s) | the drawer on the board | `agent` on each ledger record, written by `buzzer.ts`; older records backfilled from `results/agent-runs.json` (extracted from the committed traces) |
| The public checks: requests and assertions against the live site, 0 failures | README, Devpost | `postman/final-buzzer.postman_collection.json`, last run `results/postman-run.txt` |
| $4,025 paid to officials across all days | the money page | the deployed ledger, `/api/ledger` |
| About $1.40 and $2.25 of model cost | README | token counts in `buzzer-replay.json` and `chase.json` at the model's list price: an estimate, not a measurement |

## The composite's data (`data/`)

| Figure | Used in | Where it comes from |
|---|---|---|
| 88 games, 12 courts, 8 divisions, 52 teams, the start times and the playoff order | everywhere | `tournament-2026.json`: the shape of a real 88-game invitational with every name and id replaced |
| $45 a referee and $25 a table official per game | the rate card, every payout | `rate-card.json`, marked `provisional`: a placeholder until an association supplies its own card. For scale, the Central Blair Recreation and Park Commission pays $20 to $24 US per event (Altoona Mirror, below) |
| $350 entry fee; "$17,500 entry fees in" on the money page | invoices, refunds, the money page | `fees.json`, marked `provisional`; 50 paid teams at $350 |
| A refund through the MCP server's `create_refund`, $175, COMPLETED, 10 November 2026 | the write-up, the README | `results/replan-paypal-refund.json`: invoice NYB26C-015-PP paid through PayPal by a sandbox buyer, refund `8XF64638PY750900U` against capture `27C4904956561835U`. The same file records the other team's payout refused for lack of sandbox balance |
| Refund when a game cannot be played: entry fee divided by the games the team was scheduled to play | the re-plan | `fees.json`, placeholder wording until an association's own policy |
| Officials A to X, four of them paid once a day; one staged forfeit; one staged missing table official | the sheet, the board | `officials-2026.json`, labelled generated and staged |

## Published sources

- National Association of Sports Officials, 2023 National Officiating Survey, released 2 October 2023 (35,813 respondents, average age 56.68): https://www.naso.org/35813-individuals-respond-to-national-officiating-survey/. The pay and attrition figures as reported by the National Federation of State High School Associations, "NASO Survey Indicates Concerns with Sportsmanship, Shortage of Officials", 8 November 2023: 0.4% said they are overpaid, 18.3% paid what they are worth, about 21% underpaid and dissatisfied, 60% underpaid but accepting of budget constraints; nearly 59% agreed that "most new officials quit within the first 1-3 years". https://www.nfhs.org/stories/naso-survey-indicates-concerns-with-sportsmanship-shortage-of-officials
- The products named beside Final Buzzer, each from its own public page (read 9 November 2026): SportsEngine lists "Online registration & payments" among its products (https://www.sportsengine.com/); LeagueApps' payments page is about helping youth sports organizations "collect registration payments" through invoices and installment plans (https://leagueapps.com/youth-sports-management-platform/payments/); assignr describes itself as "Referee Scheduling Software" (https://www.assignr.com/); ArbiterPay, per the ArbiterSports article on Wikipedia, "facilitates secure, automated payments to officials" with electronic disbursement, audit tracking and reporting (https://en.wikipedia.org/wiki/ArbiterSports; arbitersports.com refused automated reads). None of those pages describes a decision taken at the final buzzer from the game sheet and PayPal's record, which is the only claim the write-up makes about them.
- Prep Network, "Meet the Referee Fighting for the Future of Youth Sports Officials", 3 March 2026 (no byline on the page). Wyatt Gustafson, a part-time referee in Minnesota (youth baseball and softball umpire, hockey referee) and co-founder of Refr Sports, saw colleagues "get paid for assignments months late, and sometimes never get paid at all"; "There's no job in the world that pays people three four months after they do work for you"; softball umpires "still haven't been paid for tournament games that happened in October". The same article says Refr Sports pays officials "within seven days of their assignment", which is why it is named among the incumbents. https://prepnetwork.com/?p=9289
- TMJ4 (Milwaukee), "MPS athletics: TMJ4 investigation reveals sports officials are being paid late or not at all", 22 October 2024, reporter Jenna Rae. Curtis Rediske, an MPS sports official, timer and scorekeeper for more than a decade, had not been paid for games he worked on 5 September, 2 October and 4 October 2024; the district said it was investigating. Kept here as a second dated case, not quoted on the page. https://www.tmj4.com/news/milwaukee-county/mps-athletics-tmj4-investigation-reveals-sports-officials-are-being-paid-late-or-not-at-all
- William Kibler, "Central Blair Recreation and Park Commission to try paying refs in cash", Altoona Mirror, September 2026. Referees wait up to two weeks for their cheques to be deposited; fees are $20 to $24 per event by level; one cheque per event day will be split into pay envelopes for the coming basketball season, with results due in March. Executive director Mike Hofer called cash "a big red flag" the commission would hedge with safeguards, and said it has been "struggling" to get officials, who are "aging out and stepping away". https://www.altoonamirror.com/news/local-news/2026/09/central-blair-recreation-and-park-commission-to-try-paying-refs-in-cash
