"""Functional check of the served board (web/ on src/server.ts, dry ledger).

Starts from the fixture ledger (two holds the agent wrote on the staged games), loads the board, taps "Pay in full" on the
held game (answering the treasurer's PIN prompt when .env sets SAM_PIN), and expects: the server answers
ok, the hold disappears, the tile flips to paid, the count moves. Usage: start the server with
  LEDGER=tmp/ledger-test.json TOURNAMENT_FILE=tmp/tournament-test.json PAYPAL_MODE=dry node src/server.ts
then  py tests/board.test.py        (tmp/run-board-test.sh does both)
"""
import json, os, re, shutil, sys
from playwright.sync_api import sync_playwright

def sam_pin():
    if os.environ.get("SAM_PIN"): return os.environ["SAM_PIN"]
    try: m = re.search(r"^SAM_PIN=(.*)$", open(".env", encoding="utf-8").read(), re.M); return m.group(1).strip() if m else ""
    except OSError: return ""
PIN = sam_pin()
shutil.copyfile("tests/fixtures/ledger-holds.json", "tmp/ledger-test.json")
fails = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 720})
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:4173/"); pg.wait_for_timeout(2500)
    tiles = pg.locator(".courts .flap").count()
    held_before = pg.locator(".courts .flap.held").count(); paid_before = int(pg.inner_text("#paid-n"))
    if tiles != 34: fails.append(f"expected 34 Saturday tiles, got {tiles}")
    if held_before < 1: fails.append("no held tile to decide on")
    if pg.locator("#held-card").is_hidden(): fails.append("held card hidden although a hold exists")
    title = pg.inner_text("#held-title")
    pg.click("#pay-full"); pg.wait_for_timeout(1500)
    if pg.locator("#sam-pin .pin input").count():   # the public board asks for Sam's PIN first
        if not PIN: fails.append("the board asked for a PIN but none is known to the test")
        pg.fill("#sam-pin .pin input", PIN); pg.click("#sam-pin .pin button"); pg.wait_for_timeout(1500)
    note = pg.inner_text("#held-note")
    if "would pay" not in note and "paid" not in note.lower(): fails.append(f"unexpected answer after the tap: {note}")
    pg.wait_for_timeout(3000)
    if pg.locator(".courts .flap.held").count() != held_before - 1: fails.append("held tile count did not drop by one")
    if int(pg.inner_text("#paid-n")) != paid_before + 1: fails.append("games paid did not move by one")
    led = json.load(open("tmp/ledger-test.json", encoding="utf-8"))
    hugh = [v for v in led["payouts"].values() if v.get("decidedBy") == "treasurer"]
    if not hugh: fails.append("ledger has no payout decided by Sam")
    # a tile opens its game: a paid one in the game card, a held one on the held card
    pg.locator(".courts .flap.paid").first.click(); pg.wait_for_timeout(400)
    if pg.locator("#game-card").is_hidden() or "Paid $" not in pg.inner_text("#game-card"): fails.append("a paid tile did not open its game card")
    pg.click("#game-close"); pg.wait_for_timeout(300)
    if not pg.locator("#game-card").is_hidden(): fails.append("the game card did not close")
    pg.locator(".courts .flap.held").first.click(); pg.wait_for_timeout(400)
    if "Game 30" not in pg.inner_text("#held-title"): fails.append(f"a held tile did not open on the held card: {pg.inner_text('#held-title')}")
    pg.locator(".courts .flap.scheduled").first.click(); pg.wait_for_timeout(400)
    if pg.locator("#game-card a[href^='/score.html#']").count() != 1: fails.append("a game not started has no link to score it")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    if not pg.locator("#game-card").is_hidden(): fails.append("Esc did not close the game drawer")
    if pg.locator("#days .day").count() != 4: fails.append("four day tabs expected")
    pg.click("#days .day >> nth=1"); pg.wait_for_timeout(2500)
    fri = pg.locator(".courts .b-sch-event-wrap").count()
    if fri != 14: fails.append(f"Friday should show 14 tiles, got {fri}")
    if errors: fails.append("page errors: " + "; ".join(errors))
    pg.screenshot(path="tmp/board-after-tap.png"); b.close()
print("held", held_before, "paid", paid_before, "|", title, "|", note)
print("FAIL: " + " | ".join(fails) if fails else "PASS: tiles, held card, Sam's tap through the server, ledger, day tabs, no page errors")
sys.exit(1 if fails else 0)
