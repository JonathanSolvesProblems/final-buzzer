"""Functional check of the served board (web/ on src/server.ts, dry ledger).

Starts from the fixture ledger (two holds the agent wrote on the staged games), loads the board, taps "Pay in full" on the
held game, and expects: the server answers ok, the hold disappears, the tile flips to paid, the count
moves. Usage: start the server with
  LEDGER=tmp/ledger-test.json TOURNAMENT_FILE=tmp/tournament-test.json PAYPAL_MODE=dry node src/server.ts
then  py tests/board.test.py
"""
import json, shutil, sys
from playwright.sync_api import sync_playwright

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
    note = pg.inner_text("#held-note")
    if "would pay" not in note and "paid" not in note.lower(): fails.append(f"unexpected answer after the tap: {note}")
    pg.wait_for_timeout(3000)
    if pg.locator(".courts .flap.held").count() != held_before - 1: fails.append("held tile count did not drop by one")
    if int(pg.inner_text("#paid-n")) != paid_before + 1: fails.append("games paid did not move by one")
    led = json.load(open("tmp/ledger-test.json", encoding="utf-8"))
    hugh = [v for v in led["payouts"].values() if v.get("decidedBy") == "treasurer"]
    if not hugh: fails.append("ledger has no payout decided by Sam")
    if pg.locator("#days .day").count() != 4: fails.append("four day tabs expected")
    pg.click("#days .day >> nth=1"); pg.wait_for_timeout(2500)
    fri = pg.locator(".courts .b-sch-event-wrap").count()
    if fri != 14: fails.append(f"Friday should show 14 tiles, got {fri}")
    if errors: fails.append("page errors: " + "; ".join(errors))
    pg.screenshot(path="tmp/board-after-tap.png"); b.close()
print("held", held_before, "paid", paid_before, "|", title, "|", note)
print("FAIL: " + " | ".join(fails) if fails else "PASS: tiles, held card, Sam's tap through the server, ledger, day tabs, no page errors")
sys.exit(1 if fails else 0)
