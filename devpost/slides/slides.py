"""The gallery slides, in order. Every figure here is one `npm run check` verifies or one read from a
results file; every quote is the agent's own, from the ledger or results/trace. One hero per slide, the
caption kept for Devpost's own field, numerals in Alumni only when they stand alone (charter 7, 13)."""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
URL = "finalbuzzer.jonathansolvesproblems.com"


def figures_checked():
    """How many figures `npm run check` verified, read from the check itself so the slide cannot go stale."""
    r = subprocess.run(["node", "src/cli/check-claims.ts"], cwd=ROOT, capture_output=True, text=True, shell=sys.platform == "win32")
    m = re.search(r"(\d+) figures checked", r.stdout + r.stderr)
    if not m:
        sys.exit("check-claims did not report a figure count:\n" + r.stdout + r.stderr)
    return int(m.group(1))


FIGURES = figures_checked()
F = lambda s: f'<span class="fig">{s}</span>'

# ---- the cover -------------------------------------------------------------------------------------
COVER = (
    '<div class="cover-hero"><div class="digits"><span class="digit">4</span><span class="digit">0</span></div>'
    '<div><p class="cover-say">seconds after the final buzzer, the officials are paid</p>'
    '<p class="cover-sub">The median of Saturday’s 28 paid games on PayPal’s clock: 81 officials, $3,145, every payout confirmed by PayPal.</p></div></div>'
    '<div class="cover-board"><img src="{IMAGE}" alt=""></div>'
)

# ---- game 44: the path from the buzzer to the money -----------------------------------------------
def ruler(secs, labels):
    pct = lambda s: f"{s / 60 * 100:.2f}%"
    ticks = "".join(f'<span class="tick{" y" if i == len(secs) - 1 else ""}" style="left:{pct(s)}">{("<span>" + str(s) + " s</span>") if i else ""}</span>' for i, s in enumerate(secs))
    legend = " · ".join(f'{F(str(s) + " s")} {t}' for s, t in labels)
    return (
        '<div class="ruler-wrap">'
        f'<div class="ruler"><span class="fill" style="width:{pct(secs[-1])}"></span>{ticks}<span class="end" style="left:0">0</span><span class="end" style="left:50%;transform:translateX(-50%)">30 s</span><span class="end" style="right:0">60 s</span></div>'
        f'<p class="ruler-legend">{legend}</p>'
        '</div>'
    )

DRAWER = (
    '<div class="two" style="grid-template-columns:470px 1fr;gap:60px"><div class="shot"><img src="{IMAGE}" alt=""></div><div class="right">'
    '<div class="hero-line"><span class="flap-y">39.4<small>s</small></span><p>from the saved score to PayPal’s confirmation, game 44, Ridgeway v Harbour</p></div>'
    + ruler([0.0, 1.6, 5.9, 39.4], [(1.6, "the agent asks for the sheet, the rate card, PayPal’s record and the officials’ day"), (5.9, "it chooses to pay now and the gate checks every amount"), (39.4, "PayPal confirms all three paid")])
    + '<p class="small" style="margin:22px 0 0;font-size:18px">Tap any paid tile on the board for this drawer: the agent’s run from the ledger’s own record, who was paid, and the PayPal batch to copy.</p>'
    '</div></div>'
)

# ---- the agent's own words, on the housing ---------------------------------------------------------
WORDS = [
    (18, "paid", "6.6", "PayPal shows nothing paid for this game yet.", "Game 18 is final at 58 to 48, and it was not a forfeit. The sheet has all three: two refs (D, E) and a table official (F). All three get paid after each game. Paying from the card: $45 per ref and $25 for the table official."),
    (24, "folded", "10.6", "All three asked to be paid at the end of the day and all have game 32 at 12:45 later today, so their pay for this game waits for the end-of-day payout.", "Game 24 is final, 41 to 35, not a forfeit. The sheet is full: refs V and W and table official X. PayPal shows nothing paid for this game."),
    (30, "held", "4.3", "Nobody is paid until Sam confirms who was on the table.", "Game 30 (Pinecrest v Glenview) is final at 47 to 41, but the sheet has only two refs, P and Q, and no table official."),
]
WORDS_HTML = '<div class="words">' + "".join(
    f'<div class="word"><div class="word-h"><span class="lbl">Game {n}</span><span class="lbl">{c}</span><span class="when">decided in {F(s + " s")}</span></div>'
    f'<p class="said">{hi}</p><p class="rest">{rest}</p></div>' for n, c, s, hi, rest in WORDS
) + '<p class="word-foot">Each decision is a schema-checked tool call (src/agent/decision.ts); the reason is the agent’s own, kept in results/trace.</p></div>'

# ---- the three holds, in the board's words ---------------------------------------------------------
def hold(label, sentence, buttons, note=""):
    acts = "".join(f'<span class="btn{" ghost" if i else ""}">{b}</span>' for i, b in enumerate(buttons))
    return f'<div class="hold"><div class="face"><b>{label}</b>{sentence}</div><div class="acts">{acts}{("<small>" + note + "</small>") if note else ""}</div></div>'

HELD = (
    '<div class="holds">'
    + hold("Game 17, Bantam boys, Gym EF, 9:00", "PayPal already shows this game paid: $115 to 3 officials. Nothing more was sent.<span class=was>Decided in 5.8 s after reading PayPal’s record of the game. Reading PayPal before it pays is the agent’s own work; the server refuses a second payment even if asked.</span>", ["Right, nothing more"])
    + hold("Game 26, Mini boys, Gym D, 11:30", "Lakeshore 2 v Beacon was a forfeit. The rate card pays a show-up fee for a forfeit, but has no amount for it yet.<q>The card pays only a show-up fee for a forfeit, but it doesn’t say how much, so I can’t work out what to pay.</q>", ["Pay in full, $115", "Pay nobody"], "the code gate stops it too")
    + hold("Game 30, Gym CD, 12:45", "Pinecrest v Glenview has no table official on the sheet. Pay the 2 who are on it now, or nobody until the sheet says who sat at the table.<q>Nobody is paid until Sam confirms who was on the table.</q>", ["Pay the 2 on the sheet, $90", "Pay nobody"], "the code gate stops it too")
    + '</div>'
    '<p class="small" style="margin:26px 0 10px;font-size:17px">On the board, behind the treasurer’s PIN. Game 17 as Sam sees it:</p>'
    '<div class="shot fixed" style="height:165px;width:876px"><img src="{IMAGE}" alt=""></div>'
)

# ---- how it is built: a flow with arrows -----------------------------------------------------------
def node(title, text, code):
    return f'<div class="node"><h3>{title}</h3><p>{text}<code>{code}</code></p></div>'

ARROW = '<span class="arrow"></span>'
FLOW = (
    '<div class="flow">'
    + node("The scorer’s phone", "A table official saves the final score. Nothing to install, no account.", "/score.html")
    + ARROW
    + node("The agent (Claude)", "Reads the game sheet, the rate card, PayPal’s record of this game and the officials’ day, then chooses: pay now, hold for Sam, or fold into the evening payout.", "src/agent/buzzer.ts · decide, a schema-checked tool call · the loop runs on stop_reason")
    + ARROW
    + node("The gate (code)", "Every amount equals the rate card to the cent; only people on the sheet; one batch id per game, so PayPal refuses a repeat.", "src/agent/guards.ts")
    + ARROW
    + node("PayPal sandbox", "Payouts, one batch per game. Invoicing through the MCP server. Transaction Search and Webhooks.", "POST /v1/payments/payouts · @paypal/mcp · verify-webhook-signature")
    + ARROW
    + node("Where it lands", "Each official’s pay at PayPal and on their own page, the board, the money page, and one tap on Sam’s phone for a held game.", "/official.html · Bryntum Scheduler · AG Grid")
    + '</div>'
    '<div class="band">Two more loops on the same stack: the entry fees before the weekend <code>src/agent/invoices.ts</code> and a gym closure on the day <code>src/agent/replan.ts</code></div>'
)

# ---- the live payout of 9 November: the webhooks are the proof --------------------------------------
WEBHOOKS = [
    ("01:30:37", "PAYMENT.PAYOUTSBATCH.PROCESSING", "the batch is being processed", False),
    ("01:30:46", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "Official D’s $45 landed in a PayPal account", True),
    ("01:30:47", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "a test address: $45 waits to be claimed", False),
    ("01:30:48", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "a test address: $25 waits to be claimed", False),
    ("01:30:56", "PAYMENT.PAYOUTSBATCH.SUCCESS", "the batch completed", False),
]
LIVE = (
    '<div class="two" style="grid-template-columns:600px 1fr;gap:48px;align-items:start">'
    '<div><div class="shot" style="height:auto;background:#fff"><img src="{IMAGE}" alt="" style="height:auto;object-fit:contain"></div>'
    '<p class="small" style="margin:14px 0 0;font-size:17px">Official D’s own PayPal account, seconds later: the payment and its note, as PayPal shows it to the person paid.</p></div>'
    '<div class="right" style="justify-content:flex-start">'
    '<div class="hero-line"><span class="flap-y">45.6<small>s</small></span><p>Game 2, Maple Hill v Northside, scored on the public site on the evening of 10 November. PayPal confirmed the batch 45.6 seconds after the saved score.</p></div>'
    '<div class="events">'
    + "".join(f'<div class="ev slim{" key" if k else ""}"><span class="t">{t}<small>Z</small></span><span class="ty">{e}</span><span class="what">{w}</span></div>' for t, e, w, k in WEBHOOKS)
    + '</div>'
    '<p class="small" style="margin:14px 0 0;font-size:16px">Five webhook events, each signature-verified against the webhook registered for the live site before the ledger moves (/api/webhooks). Batch LWECCKCWTM9ZS.</p>'
    '</div></div>'
)

# ---- invoices: the chase as the hero, the grid as proof --------------------------------------------
def bar(segs, total, words=False, min_label=.03):
    out = []
    for cls, n, label in segs:
        share = n / total
        text = (f"{n} {label}" if words and share > .15 else (str(n) if share > min_label else ""))
        out.append(f'<span class="seg {cls}" style="flex:{n} 0 0">{text}</span>')
    return '<div class="bar">' + "".join(out) + '</div>'

CHASE = json.loads((ROOT / "results" / "chase.json").read_text(encoding="utf-8"))["outcomes"]
CHASE_TOTAL = sum(CHASE.values())
INVOICES = (
    f'<p class="lead">{CHASE_TOTAL} decisions over 33 days of chasing, each the agent’s choice with PayPal’s record in hand</p>'
    + bar([("wait", CHASE["waited"], "waited"), ("rem", CHASE["reminded"], "reminders"), ("split", CHASE["split"], "split"), ("rel", CHASE["released"], "released")], CHASE_TOTAL, words=True).replace('class="bar"', 'class="bar tall"')
    + f'<div class="legend big"><span class="wait">{CHASE["waited"]} waited: not due yet, or reminded this week</span><span class="rem">{CHASE["reminded"]} reminders through PayPal</span><span class="split">{CHASE["split"]} split into a deposit and a balance</span><span class="rel">{CHASE["released"]} spot released to the waitlist</span></div>'
    '<div class="shot fixed" style="height:287px;margin-top:30px"><img src="{IMAGE}" alt=""></div>'
)

# ---- the re-plan: before and after, as court lanes -------------------------------------------------
SLOTS = ["9:00", "10:15", "11:30", "12:45", "14:00", "15:15", "16:30", "17:45", "19:00", "20:15"]
LANES = ["Gym E", "Gym EF", "Gym F", "Lakeside 1", "Lakeside 2"]
# (number, slot, label) for the five courts the closure touches; from data/tournament-2026.json numbered as the agent numbers it
BEFORE = {
    "Gym E": [(54, "9:00", "Mini boys pool"), (60, "10:15", "Mini boys quarter"), (66, "11:30", "Mini boys quarter")],
    "Gym EF": [(71, "12:45", "Bantam boys pool"), (74, "14:00", "Mini boys semi"), (78, "15:15", "Bantam girls pool"), (82, "16:30", "Mini girls final"), (84, "17:45", "Bantam boys final"), (86, "19:00", "Cadet girls final"), (88, "20:15", "Juvenile boys final")],
    "Gym F": [(51, "9:00", "Mini girls pool"), (57, "10:15", "Mini boys quarter"), (63, "11:30", "Mini girls pool")],
    "Lakeside 1": [(56, "9:00", "Juvenile boys pool"), (62, "10:15", "Bantam boys pool"), (68, "11:30", "Cadet boys pool"), (72, "12:45", "Juvenile boys pool"), (76, "14:00", "Juvenile boys placement"), (80, "15:15", "Juvenile boys semi")],
    "Lakeside 2": [(55, "9:00", "Cadet girls pool"), (61, "10:15", "Cadet boys pool"), (67, "11:30", "Cadet boys pool"), (75, "14:00", "Bantam boys pool"), (79, "15:15", "Juvenile boys semi")],
}
PLAN = json.loads((ROOT / "results" / "replan.json").read_text(encoding="utf-8"))
MOVES = {a["game_number"]: (a["to"]["court"], a["to"]["start"].lstrip("0")) for a in PLAN["applied"]}
AFFECTED = set(PLAN["affected"])
DEAD = {u["game_number"] for u in PLAN["unplayable"]}


def lanes(after, only=None):
    cells = ['<span></span>'] + [f'<span class="slot-h">{s}</span>' for s in SLOTS]
    rows = [l for l in LANES if not only or l in only]
    for li, lane in enumerate(rows, start=2):
        cells.append(f'<span class="lane-h" style="grid-row:{li}">{lane}</span>')
        games = []
        if after:
            if lane in ("Gym E", "Gym EF"):
                cells.append(f'<span class="closed" style="grid-row:{li}"></span>')
            for src_lane, lst in BEFORE.items():
                for n, slot, label in lst:
                    if n in DEAD and lane == src_lane:
                        games.append((n, slot, "not played, refunded", "dead"))
                    elif n in MOVES and MOVES[n][0] == lane:
                        games.append((n, MOVES[n][1], label, "moved"))
                    elif n not in MOVES and n not in DEAD and src_lane == lane:
                        games.append((n, slot, label, "same"))
        else:
            games = [(n, slot, label, "hit" if n in AFFECTED else "same") for n, slot, label in BEFORE[lane]]
        for n, slot, label, cls in games:
            cells.append(f'<span class="tile {cls}" style="grid-row:{li};grid-column:{SLOTS.index(slot) + 2}"><span><span class="n">{n}</span>{label}</span></span>')
    return '<div class="lanes">' + "".join(cells) + '</div>'


REPLAN = (
    '<div class="housing strip"><p class="lanes-title">Sunday as scheduled<small>the 10 games on the closed floor</small></p>' + lanes(False, only=("Gym E", "Gym EF")) + '</div>'
    '<div class="housing hero"><p class="lanes-title">The agent’s plan<small>9 moved, each move checked in code against team rest, playoff order and the joined floor</small></p>' + lanes(True) + '</div>'
    '<div class="band" style="text-align:left">Game 54, Lakeshore 2 v Maple Hill, cannot be played: no slot before the division’s 10:15 playoffs. Both teams refunded $175 through PayPal Payouts <code>6GDKCDGHFPB74 · EJ7UMRX2TVNLG</code></div>'
)

# ---- reconciliation --------------------------------------------------------------------------------
RC = json.loads((ROOT / "results" / "reconcile.json").read_text(encoding="utf-8"))
_game_items = sum(1 for m in RC["matched"] if re.search(r"-g\d+-", m["item"]))
_eve_items = len(RC["matched"]) - _game_items
_eve_batches = len({m["senderBatchId"] for m in RC["matched"] if not re.search(r"-g\d+-", m["item"])})
_status = {}
for m in RC["matched"]:
    _status[m["payout_status"]] = _status.get(m["payout_status"], 0) + 1
RECON_TERM = f"""<div class="term fit" style="font-size:18px;line-height:1.8;padding:34px 40px">$ node src/cli/reconcile.ts <span class="k">&gt; results/reconcile.json</span>

<span class="k">window   </span> {RC["window"]["start"][:16].replace("T", " ")}Z to {RC["window"]["end"][:16].replace("T", " ")}Z
<span class="k">listed   </span> {RC["transactions_listed"]} transactions in PayPal's search
<span class="k">matched  </span> <span class="c">{RC["matched_items"]} of {len(RC["matched"]) + len(RC["pending"])}</span> ledger payout items, by item id
<span class="k">items    </span> {_game_items} in {RC["games_confirmed_by_paypal"]} game batches
          {_eve_items} in {_eve_batches} evening batches
<span class="k">status   </span> {_status.get("UNCLAIMED", 0)} unclaimed by test receivers, {_status.get("SUCCESS", 0)} claimed
<span class="k">dollars  </span> <span class="c">{RC["dollars_confirmed_by_paypal"]:,} CAD</span> confirmed by PayPal
<span class="k">fees     </span> {RC["payout_fees"]} CAD in PayPal payout fees
<span class="k">missing  </span> <span class="c">{RC["not_yet_in_transaction_search"]}</span>

<span class="k">note      dollars and games come from PayPal's
          transaction search and payout records,
          not from the agent's ledger</span></div>"""
RECON = (
    '<div class="two" style="grid-template-columns:1fr 1fr;gap:60px;align-items:center">' + RECON_TERM + '<div class="right">'
    f'<p class="bigfig">{RC["matched_items"]}<small>of</small>{len(RC["matched"]) + len(RC["pending"])}</p>'
    '<p class="bigcap">payout items the ledger holds were found in PayPal’s own transaction search, matched by item id, through the MCP server’s <code class="mono" style="font-size:.85em">list_transactions</code></p>'
    '</div></div>'
)

# ---- the two comparisons ---------------------------------------------------------------------------
def run(title, sub, segs, note):
    return f'<div class="run"><h3>{title}<small>{sub}</small></h3><div>{bar(segs, 34, words=True)}<p>{note}</p></div></div>'

ABLATIONS = (
    '<div class="runs">'
    + run("The agent with PayPal", "results/buzzer-replay.json", [("paid", 28, "paid"), ("fold", 3, "folded"), ("held", 3, "held")], "28 paid at the buzzer, 3 folded into the evening payout as the officials asked, 3 held for Sam")
    + run("The agent with PayPal switched off", "results/ablation-no-paypal.json", [("held", 34, "held")], "It could not read PayPal’s record of any game, so it paid nobody rather than risk paying twice")
    + run("A fixed rule in place of the model", "results/ablation-scripted.json", [("paid", 32, "would pay"), ("gate", 2, "stopped")], "Pays everyone on the sheet the moment a game ends; the code gate still stops the forfeit and the missing official; nobody folds, nobody asks Sam")
    + '</div>'
    '<div class="legend"><span class="paid">paid</span><span class="fold">folded into the evening payout</span><span class="held">held for Sam</span><span class="gate">stopped by the code gate</span></div>'
    f'<div class="band"><code>npm run check</code> reads every figure in the write-up back from the results files and fails when one disagrees: {FIGURES} figures, and a list of claims it refuses to let the write-up make</div>'
)

# ---- why ------------------------------------------------------------------------------------------
WHY = (
    '<p class="attrib" style="margin:-4px 0 30px">Wyatt Gustafson, part-time referee, Minnesota, on colleagues paid months late or never. Prep Network, March 2026.</p>'
    '<div class="cols3">'
    f'<div class="card">{F("18.3<small>%</small>")}<div>of 35,813 officials said they are paid what they are worth. 59% agreed that most new officials quit within their first three years.</div><small>2023 National Officiating Survey, NASO, reported by the NFHS, November 2023</small></div>'
    '<div class="card"><div>Referees wait up to two weeks for a cheque to clear, so the commission will try cash in pay envelopes this basketball season.</div><small>Central Blair Recreation and Park Commission, Altoona, Pennsylvania. Altoona Mirror, September 2026</small></div>'
    '<div class="card"><span class="lbl">What’s next</span><div>On 8 November 2026 I wrote to the Central Blair Recreation and Park Commission to offer a sandbox run of Final Buzzer on its basketball schedule.</div><small>Every number and quote on this page is traced in devpost/sources.md</small></div>'
    '</div>'
)

# ---- the phones -----------------------------------------------------------------------------------
PHONES = (
    '<div class="phones"><div class="pair"><div class="phone"><div class="frame"><img src="{IMAGE}" alt=""></div></div><div class="phone"><div class="frame"><img src="{IMAGE_2}" alt=""></div></div></div><div class="plain">'
    '<p>Any table official scores from a phone. Nothing to install, no account. About 40 seconds later the officials are paid through PayPal Payouts.</p>'
    '<p class="small" style="font-size:19px">Behind it, Official D’s own page: every game worked, what it paid, how soon after the buzzer PayPal confirmed it, and what is next on the sheet. It updates as the agent pays.</p>'
    '</div></div>'
)


def build():
    return [
        {
            "id": "board", "badge": "PayPal sandbox · Saturday replayed 2 Nov 2026",
            "html": COVER, "image": "tmp/shots/slide-board.png", "crop": [0, 366, 1212, 320],
            "caption": "Saturday's 34 games replayed live through the agent and the PayPal sandbox: 28 paid, 81 officials, $3,145, a median of 40.2 seconds from the saved score to PayPal's confirmation. Every tile on the board is a game and its face is its money state. Live at " + URL + ".",
        },
        {
            "id": "drawer", "badge": "PayPal sandbox · batch S9C26657WUH3J",
            "headline": "From the saved score to the money in 39.4 seconds",
            "html": DRAWER, "image": "tmp/shots/slide-drawer-44-only.png", "crop": [0, 52, 440, 702],
            "caption": "Tap a paid tile and the drawer shows the path from the buzzer to the money, from the ledger's own record of the run: 0.0 s the score is saved, 1.6 s the agent asks for the sheet, the rate card, PayPal's record and the officials' day, 5.9 s it chooses to pay and the gate checks every amount, 39.4 s PayPal confirms all three officials paid. Who was paid, how much, and the PayPal batch to copy.",
        },
        {
            "id": "phones", "badge": "Live site · PayPal sandbox",
            "headline": "Scored from the table official’s phone and paid before the teams leave the gym",
            "html": PHONES, "image": "tmp/shots/slide-score-phone.png", "image_2": "tmp/shots/slide-official-phone.png",
            "caption": "The scorer's page on a phone, and Official D's own page: every game worked, what it paid, how soon after the buzzer PayPal confirmed it, the folds into the evening payout, and what is next on the sheet. Score a game that has not started on the live site and watch its officials get paid.",
        },
        {
            "id": "held", "badge": "The ledger · 2 Nov 2026",
            "kicker": "Three games held for Sam. The agent’s note on the first, whose score was saved a second time:",
            "headline": "“PayPal already shows it paid at 20:47:17Z: 45, 45 and 25 CAD, all still unclaimed. So I held it and sent nothing more.”",
            "html": HELD, "image": "tmp/shots/slide-held-17.png", "crop": [0, 0, 866, 163],
            "caption": "Three of Saturday's 34 games were held for Sam: a score saved twice, which PayPal already showed paid (the agent sent nothing more); a forfeit, whose show-up fee the rate card does not carry yet; and a game with no table official on the sheet. Each shows one sentence and the choices that make sense; Sam's tap pays through the same gate and the same PayPal call as the agent.",
        },
        {
            "id": "words", "badge": "results/trace · replayed 2 Nov 2026", "dark": True,
            "headline": "The agent’s own words on three games",
            "html": WORDS_HTML,
            "caption": "Each decision is a schema-checked tool call (src/agent/decision.ts) with a reason in the scorer's words. Three of Saturday's 34, as recorded: a plain payment after reading PayPal's record, a fold for officials who asked to be paid once a day, and a question for Sam about a missing table official.",
        },
        {
            "id": "how", "badge": "src/agent · PayPal sandbox",
            "headline": "Claude chooses and code checks every cent",
            "html": FLOW, "stage_style": "justify-content:center",
            "caption": "How it is built: a score saved on a phone, Claude reading four things and choosing one of three actions, a code gate on every amount, then PayPal Payouts, Invoicing through the MCP server, Transaction Search and Webhooks, landing at PayPal for each official, on their own pages, the board and the money page.",
        },
        {
            "id": "live", "badge": "Live site · 10 Nov 2026 · batch LWECCKCWTM9ZS",
            "headline": "Scored on the public site, and 45.6 seconds later the referee has the money",
            "html": LIVE, "image": "tmp/shots/slide-paypal-activity-g2.png", "crop": [38, 452, 872, 466], "scale": 1,
            "caption": "Game 2 was scored on the public site on 10 November 2026 with the agent on duty, and PayPal confirmed its officials' pay 45.6 seconds after the saved score. Official D is routed to a real sandbox PayPal account: the $45 shows there with the game's note. The other two officials are test addresses, so PayPal holds their items as unclaimed. Five webhook events arrived signature-verified; every one is listed at /api/webhooks.",
        },
        {
            "id": "invoices", "badge": "PayPal MCP server · results/chase.json",
            "headline": "52 teams invoiced through PayPal’s MCP server and 50 paid",
            "html": INVOICES, "image": "tmp/shots/slide-money-invoices-sorted.png", "crop": [0, 0, 1356, 284],
            "caption": "The money page's entry fees, sorted by reminders: 52 teams invoiced through PayPal's MCP server, 50 paid, 32 reminders, one invoice split into a deposit and a balance at a manager's request, one spot released to the waitlist a week after the due date. 57 decisions over 33 days, each the agent's choice with PayPal's record in hand.",
        },
        {
            "id": "replan", "badge": "results/replan.json · PayPal sandbox",
            "headline": "Gym E closes at 9:00 and 9 of 10 games find a new court",
            "html": REPLAN,
            "caption": "Sunday, Gym E closed from 9:00, 10 games affected (Gym EF shares its floor). The agent moved 9, each move checked in code against the schedule's rules (team rest, playoff order, joined courts sharing a floor), and refunded the two teams of the game that could not be played, $175 each, through PayPal Payouts. results/replan.json.",
        },
        {
            "id": "reconcile", "badge": "PayPal Transaction Search · 3 Nov 2026",
            "headline": "Every payout item read back from PayPal’s own records",
            "html": RECON,
            "caption": "Reconciliation against PayPal: all 99 payout items the ledger holds appear in PayPal's transaction search, matched by item id, across 30 games and the evening batches: $3,795 CAD confirmed, $31.68 in payout fees, nothing missing.",
        },
        {
            "id": "ablations", "badge": "Committed results · 2 Nov 2026",
            "headline": "Switch PayPal off and the agent pays nobody",
            "html": ABLATIONS,
            "caption": "Two comparisons committed in the repository, on the same 34 games: with PayPal switched off the agent held every game and paid nobody; a fixed rule in place of the model pays everyone on the sheet, loses the once-a-day folds and asks Sam nothing, while the code gate stops the forfeit and the missing official whoever decides. A script reads every figure in the write-up back from the results and fails when one disagrees.",
        },
        {
            "id": "why", "badge": "Published sources",
            "kicker": "Officials are scarce, and slow pay is part of it",
            "headline": "“There’s no job in the world that pays people three four months after they do work for you.”",
            "html": WHY,
            "caption": "Why the buzzer: in the 2023 National Officiating Survey 18.3% of officials said they are paid what they are worth; a Minnesota referee told Prep Network in March 2026 that colleagues are paid months late or never; in September 2026 a Pennsylvania recreation commission told the Altoona Mirror its referees wait two weeks for a cheque. On 8 November 2026 I wrote to that commission to offer a sandbox run.",
        },
    ]
