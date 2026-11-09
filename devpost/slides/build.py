"""Renders the Devpost gallery slides from devpost/slides/slides.py into devpost/gallery/NN-id.png (1500x1000)
and writes devpost/gallery/README.md with the caption to paste under each image, in order.
Each slide wears the board's own brand: the gym-wall grey, the scoreboard-black housing, cream flaps,
Schibsted for words, Alumni Sans for standalone figures, chamfered corners, a hard drop and no blur.
The caption is NOT drawn on the image (Devpost has its own caption field); it goes in the README.
Usage: py devpost/slides/build.py [slide-id ...]"""
import html, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import slides as S  # noqa: E402

OUT = ROOT / "devpost" / "gallery"
HTML_DIR = ROOT / "tmp" / "slides" / "html"
CROPS = ROOT / "tmp" / "slides" / "crops"
TYPE = (ROOT / ".design" / "type").as_uri()
BRAND = (ROOT / ".design" / "brand").as_uri()
URL = "finalbuzzer.jonathansolvesproblems.com"

CSS = """
@font-face { font-family: "Alumni Sans"; src: url("{TYPE}/AlumniSans.ttf") format("truetype"); font-weight: 100 900; }
@font-face { font-family: "Schibsted Grotesk"; src: url("{TYPE}/SchibstedGrotesk.ttf") format("truetype"); font-weight: 400 900; }
:root { --floor:#E9EAEC; --housing:#16171A; --rim:#2A2C31; --flap:#F4F5F2; --flap-lo:#E3E5E2; --split:#0A0B0C; --black-face:#2E3036;
  --ghost:#9EA2AA; --keyline:#5C6068; --yellow:#F2C230; --yellow-lo:#E0AE1E; --ink:#16171A; --ink-muted:#4A4E56; --hair: rgba(22,23,26,.16);
  --chamfer: polygon(5px 0, calc(100% - 5px) 0, 100% 5px, 100% calc(100% - 5px), calc(100% - 5px) 100%, 5px 100%, 0 calc(100% - 5px), 0 5px);
  --mono: "Cascadia Mono", "Consolas", monospace; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1500px; height: 1000px; overflow: hidden; }
body { background: var(--floor); color: var(--ink); font-family: "Schibsted Grotesk", sans-serif; font-size: 20px; line-height: 1.4; }
/* Standalone figures are Alumni (charter 7, 13); a number inside a sentence stays in the sentence's own face. */
.fig { font-family: "Alumni Sans", sans-serif; font-weight: 700; line-height: 1; letter-spacing: 0; }
.slide { width: 1500px; height: 1000px; padding: 52px 64px 40px; display: flex; flex-direction: column; }
.top { display: flex; align-items: center; justify-content: space-between; }
.top img { height: 36px; width: auto; display: block; }
.badge { background: var(--housing); color: var(--flap); font-size: 16px; font-weight: 600; padding: 9px 14px; clip-path: var(--chamfer); }
h1 { margin: 26px 0 24px; font-size: 46px; line-height: 1.1; font-weight: 700; max-width: 1300px; text-wrap: balance; letter-spacing: -.005em; }
.kicker { margin: 26px 0 0; font-size: 19px; font-weight: 600; color: var(--ink-muted); }
h1.quote-h { margin-top: 10px; font-size: 44px; max-width: 1372px; }
/* One slide in the set goes dark: the agent's words in ink on the housing */
body.dark { background: var(--housing); color: var(--flap); }
body.dark .top img { filter: invert(1) brightness(1.05); }
body.dark .badge { background: var(--flap); color: var(--housing); }
body.dark .url { color: var(--keyline); }
.stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.foot { display: flex; justify-content: flex-end; margin-top: 14px; }
.url { font-size: 15px; color: var(--ghost); white-space: nowrap; }
.shot { min-height: 0; border-radius: 12px; overflow: hidden; box-shadow: 0 3px 0 var(--split); outline: 1px solid var(--hair); background: var(--housing); }
.shot img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.shot.fixed { flex: none; }
.two { flex: 1; min-height: 0; display: grid; grid-template-columns: 440px 1fr; grid-template-rows: minmax(0, 1fr); gap: 52px; align-items: stretch; }
.two > .shot { height: 100%; }
.two > .shot img { height: 100%; object-fit: contain; object-position: top; }
.right { display: flex; flex-direction: column; justify-content: center; min-height: 0; }
.small { font-size: 16px; color: var(--ink-muted); line-height: 1.4; }
.mono { font-family: var(--mono); }
/* The cover */
.cover-hero { display: grid; grid-template-columns: auto 1fr; gap: 54px; align-items: center; margin: 22px 0 30px; }
.digits { display: inline-flex; gap: 8px; filter: drop-shadow(0 4px 0 var(--split)); }
.digit { position: relative; width: 186px; height: 258px; background: linear-gradient(180deg, var(--yellow) 0 50%, var(--yellow-lo) 50%); color: var(--housing); font-family: "Alumni Sans", sans-serif; font-weight: 800; font-size: 246px; line-height: 274px; text-align: center; clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px); }
.digit::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; background: var(--split); }
.digit.unit { width: 118px; font-family: "Schibsted Grotesk", sans-serif; font-size: 132px; font-weight: 800; line-height: 262px; }
.cover-say { margin: 0; font-size: 64px; line-height: 1.06; font-weight: 700; letter-spacing: -.008em; text-wrap: balance; }
.cover-sub { margin: 18px 0 0; font-size: 24px; line-height: 1.4; color: var(--ink-muted); max-width: 980px; }
.cover-hero { margin: 30px 0 36px; }
.cover-board { border-radius: 12px; overflow: hidden; box-shadow: 0 3px 0 var(--split); background: var(--housing); }
.cover-board img { width: 100%; display: block; }
/* The yellow flap: the one number that matters, seconds from the buzzer (charter 3, 14) */
.flap-y { display: inline-block; position: relative; background: linear-gradient(180deg, var(--yellow) 0 50%, var(--yellow-lo) 50%); color: var(--housing); font-family: "Alumni Sans", sans-serif; font-weight: 800; font-size: 118px; line-height: 1; padding: 14px 24px 8px; clip-path: var(--chamfer); filter: drop-shadow(0 3px 0 var(--split)); }
.flap-y::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 3px; margin-top: -1px; background: var(--split); }
.flap-y small { font-family: "Schibsted Grotesk", sans-serif; font-size: 34px; font-weight: 700; margin-left: 6px; }
.hero-line { display: flex; align-items: center; gap: 28px; margin-bottom: 26px; }
.hero-line p { margin: 0; font-size: 26px; line-height: 1.3; font-weight: 500; max-width: 560px; text-wrap: pretty; }
.ruler-wrap { background: var(--housing); color: var(--flap); border-radius: 12px; padding: 48px 30px 26px; box-shadow: 0 3px 0 var(--split); }
.ruler { position: relative; height: 18px; background: var(--black-face); border-radius: 3px; margin: 0 0 34px; }
.ruler .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--flap); border-radius: 3px 0 0 3px; }
.ruler .tick { position: absolute; top: -9px; width: 3px; height: 36px; background: var(--flap); }
.ruler .tick.y { background: var(--yellow); width: 6px; }
.ruler .tick span { position: absolute; top: -32px; left: 50%; transform: translateX(-50%); font-family: "Alumni Sans", sans-serif; font-weight: 700; font-size: 22px; white-space: nowrap; color: var(--flap); }
.ruler .tick.y span { color: var(--yellow); }
.ruler .end { position: absolute; top: 26px; font-size: 14px; color: var(--ghost); }
.ruler-legend { margin: 0; font-size: 18px; line-height: 1.5; color: #C9CCD2; }
.ruler-legend .fig { color: var(--flap); font-size: 24px; }
.steps { margin: 18px 0 0; padding: 0; list-style: none; }
.steps li { display: grid; grid-template-columns: 112px 1fr; gap: 20px; align-items: baseline; padding: 11px 0; border-top: 1px solid var(--hair); font-size: 21px; line-height: 1.3; }
.steps li .fig { font-size: 34px; text-align: right; }
.steps li.y .fig { background: linear-gradient(180deg, var(--yellow) 0 50%, var(--yellow-lo) 50%); clip-path: var(--chamfer); padding: 4px 8px 0; justify-self: end; }
/* Phones beside plain statements: the scorer's phone whole, the official's page behind it */
.phones { flex: 1; min-height: 0; display: grid; grid-template-columns: auto 1fr; gap: 56px; align-items: center; }
.pair { display: flex; align-items: flex-end; height: 100%; max-height: 720px; }
.phone .frame { background: var(--housing); border-radius: 46px; padding: 14px; box-shadow: 0 4px 0 var(--split); }
.phone img { height: 640px; width: auto; border-radius: 34px; display: block; }
.pair .phone:first-child { position: relative; z-index: 1; }
.pair .phone:nth-child(2) { margin-left: 14px; transform: scale(.8); transform-origin: bottom left; margin-right: -78px; }
.pair .phone:nth-child(2) .frame { outline: 1px solid var(--hair); }
.plain p { margin: 0; padding: 20px 0; border-top: 1px solid var(--hair); font-size: 30px; line-height: 1.3; font-weight: 500; }
.plain p:first-child { border-top: 0; padding-top: 0; }
.plain p small { display: block; margin-top: 8px; font-size: 16px; font-weight: 400; color: var(--ink-muted); }
/* A quote as the hero */
.quote { margin: 0 0 10px; font-size: 44px; line-height: 1.25; font-weight: 600; max-width: 1340px; text-wrap: balance; letter-spacing: -.005em; }
.attrib { margin: 0 0 26px; font-size: 17px; color: var(--ink-muted); }
/* Held games drawn from the ledger */
.holds { flex: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; align-content: start; margin-top: 8px; }
.hold { border-radius: 10px; overflow: hidden; box-shadow: 0 3px 0 var(--split); display: flex; flex-direction: column; }
.hold .face { background: var(--flap); padding: 24px 26px 26px; font-size: 23px; line-height: 1.35; flex: 1; }
.hold .face b { display: block; font-size: 15px; font-weight: 600; color: var(--ink-muted); margin-bottom: 8px; }
.hold .face q { display: block; margin-top: 18px; font-size: 19px; line-height: 1.4; color: var(--ink-muted); quotes: "\\201C" "\\201D"; }
.hold .face .was { display: block; margin-top: 18px; font-size: 19px; line-height: 1.4; color: var(--ink-muted); }
.hold .acts { background: var(--housing); padding: 16px 18px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; min-height: 104px; align-content: center; }
.btn { background: var(--flap); color: var(--housing); padding: 10px 15px; font-size: 16px; font-weight: 600; clip-path: var(--chamfer); }
.btn.ghost { background: transparent; color: var(--flap); box-shadow: inset 0 0 0 1px var(--keyline); }
.acts small { color: var(--ghost); font-size: 14px; margin-left: auto; }
/* The agent's own record, in ink on the housing */
.term { flex: 1; background: var(--housing); color: #B9BDC5; border-radius: 12px; box-shadow: 0 3px 0 var(--split); padding: 30px 36px; font-family: var(--mono); font-size: 19px; line-height: 1.5; white-space: pre-wrap; overflow: hidden; }
.term .k { color: var(--ghost); } .term .c { color: var(--flap); font-weight: 700; } .term .hi { color: var(--flap); font-weight: 700; }
.term .row { display: block; margin-bottom: 20px; }
.term.fit { flex: none; align-self: start; }
/* The agent's words on the dark slide */
.words { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 30px; max-width: 1040px; }
.word-h { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.lbl { background: var(--flap); color: var(--housing); font-size: 16px; font-weight: 700; padding: 6px 11px; clip-path: var(--chamfer); }
.card .lbl { background: var(--housing); color: var(--flap); }
.word-h .when { color: var(--ghost); font-size: 17px; margin-left: 8px; }
.word-h .when .fig { color: var(--flap); font-size: 22px; }
.said { margin: 0 0 8px; font-size: 30px; line-height: 1.25; font-weight: 600; color: var(--flap); text-wrap: pretty; }
.rest { margin: 0; font-size: 17px; line-height: 1.45; color: var(--ghost); }
.word-foot { margin: 6px 0 0; font-size: 15px; color: var(--keyline); }
/* Webhook events as the proof */
.events { display: grid; gap: 10px; margin-top: 10px; }
.ev { display: grid; grid-template-columns: 150px 440px 1fr auto; gap: 22px; align-items: center; background: var(--flap); padding: 17px 22px; clip-path: var(--chamfer); box-shadow: 0 2px 0 var(--split); font-size: 20px; }
.ev .t { font-family: "Alumni Sans", sans-serif; font-size: 30px; font-weight: 700; line-height: 1; }
.ev .t small { font-family: "Schibsted Grotesk", sans-serif; font-size: 15px; font-weight: 600; color: var(--ink-muted); margin-left: 2px; }
.ev .ty { font-family: var(--mono); font-size: 18px; font-weight: 600; }
.ev .what { color: var(--ink-muted); }
.ev .ok { font-size: 15px; font-weight: 600; color: var(--ink-muted); white-space: nowrap; }
.ev.key { background: var(--housing); color: var(--flap); }
.ev.key .what, .ev.key .ok { color: var(--ghost); }
.lead { margin: 0 0 14px; font-size: 24px; font-weight: 600; line-height: 1.3; }
/* The flow */
.flow { display: grid; grid-template-columns: 1fr 30px 1.3fr 30px 1fr 30px 1fr 30px 1fr; gap: 0 8px; align-items: stretch; flex: none; }
.flow .arrow { align-self: start; }
.node { display: flex; flex-direction: column; height: 100%; }
.node p { flex: 1; display: flex; flex-direction: column; }
.node p code { margin-top: auto; padding-top: 12px; }
.node h3 { margin: 0 0 14px; display: inline-block; background: var(--housing); color: var(--flap); padding: 7px 11px; clip-path: var(--chamfer); font-size: 18px; font-weight: 600; }
.node p { margin: 0 0 16px; font-size: 21px; line-height: 1.3; font-weight: 600; }
.node p code { display: block; margin-top: 12px; font-family: var(--mono); font-size: 14px; font-weight: 400; color: var(--ink-muted); line-height: 1.45; }
.arrow { justify-self: center; margin-top: 12px; width: 16px; height: 16px; border-top: 3px solid var(--ink); border-right: 3px solid var(--ink); transform: rotate(45deg); }
.loops { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px; }
.say { background: var(--flap); color: var(--housing); padding: 18px 22px; clip-path: var(--chamfer); font-size: 20px; line-height: 1.3; font-weight: 500; box-shadow: 0 2px 0 var(--split); }
.say code { font-family: var(--mono); font-size: 15px; color: var(--ink-muted); }
.band { background: var(--housing); color: var(--flap); padding: 16px 24px; margin-top: 20px; font-size: 21px; font-weight: 600; clip-path: var(--chamfer); text-align: center; line-height: 1.35; }
.band code { font-family: var(--mono); font-weight: 400; color: var(--ghost); font-size: 17px; }
/* Stacked bars, lightness only, never hue (charter 5) */
.bar { display: flex; height: 72px; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 0 var(--split); background: var(--black-face); }
.bar.tall { height: 120px; }
.seg { display: flex; align-items: center; justify-content: center; font-family: "Alumni Sans", sans-serif; font-weight: 700; font-size: 30px; white-space: nowrap; overflow: hidden; }
.bar.tall .seg { font-size: 40px; }
.seg.paid, .seg.rem { background: var(--flap); color: var(--housing); box-shadow: inset 0 0 0 1px var(--hair); }
.seg.fold, .seg.wait { background: var(--ghost); color: var(--housing); }
.seg.held { background: var(--keyline); color: var(--flap); }
.seg.gate { background: repeating-linear-gradient(45deg, var(--housing) 0 8px, var(--keyline) 8px 11px); color: var(--flap); }
.seg.rel { background: var(--housing); color: var(--flap); }
.seg.split { background: repeating-linear-gradient(45deg, var(--housing) 0 8px, var(--keyline) 8px 11px); color: var(--flap); }
.legend { display: flex; gap: 26px; margin-top: 12px; font-size: 16px; color: var(--ink-muted); flex-wrap: wrap; }
.legend.big { font-size: 18px; gap: 22px; }
.legend span::before { content: ""; display: inline-block; width: 15px; height: 15px; margin-right: 8px; vertical-align: -1px; border-radius: 2px; }
.legend .paid::before, .legend .rem::before { background: var(--flap); box-shadow: inset 0 0 0 1px var(--keyline); }
.legend .fold::before, .legend .wait::before { background: var(--ghost); }
.legend .held::before { background: var(--keyline); }
.legend .gate::before, .legend .split::before { background: repeating-linear-gradient(45deg, var(--housing) 0 4px, var(--keyline) 4px 6px); }
.legend .rel::before { background: var(--housing); }
.runs { display: grid; gap: 38px; flex: none; margin-top: 30px; }
.run { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 30px; align-items: center; }
.run > div { min-width: 0; }
.run h3 { margin: 0; font-size: 26px; font-weight: 700; line-height: 1.2; }
.run h3 small { display: block; margin-top: 6px; font-size: 16px; font-weight: 400; color: var(--ink-muted); line-height: 1.35; }
.run p { margin: 10px 0 0; font-size: 19px; line-height: 1.4; color: var(--ink-muted); }
/* Court lanes for the re-plan */
.housing { background: var(--housing); color: var(--flap); border-radius: 12px; padding: 12px 18px 14px; box-shadow: 0 3px 0 var(--split); }
.lanes-title { margin: 0 0 6px; font-size: 16px; font-weight: 700; color: var(--flap); }
.lanes-title small { font-weight: 400; color: var(--ghost); margin-left: 8px; }
.lanes { display: grid; grid-template-columns: 92px repeat(10, 1fr); gap: 4px 5px; }
.lane-h { font-size: 14px; font-weight: 600; color: var(--ghost); align-self: center; }
.slot-h { font-family: "Alumni Sans", sans-serif; font-size: 15px; color: var(--ghost); text-align: left; padding-left: 4px; }
.closed { grid-column: 2 / -1; background: repeating-linear-gradient(45deg, transparent 0 7px, rgba(244,245,242,.07) 7px 9px); border-radius: 4px; position: relative; }
.closed::after { content: "Closed from 9:00"; position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 13px; color: var(--ghost); }
.tile { height: 44px; clip-path: var(--chamfer); padding: 2px 7px 2px; font-size: 11.5px; line-height: 1.1; overflow: hidden; display: flex; align-items: center; position: relative; z-index: 1; }
.housing.strip { margin-bottom: 14px; }
.housing .tile { height: 54px; font-size: 14px; padding: 4px 10px; }
.housing .tile .n { font-size: 21px; }
.housing .lanes { gap: 6px 6px; }
.housing .lane-h { font-size: 16px; }
.tile.same { color: #C9CCD2; }
.tile > span:last-child { display: block; }
.tile .n { font-family: "Alumni Sans", sans-serif; font-size: 17px; font-weight: 700; line-height: 1; margin-right: 5px; display: inline; vertical-align: -1px; }
.tile.same { box-shadow: inset 0 0 0 1px var(--keyline); color: var(--ghost); }
.tile.hit { background: var(--black-face); color: var(--flap); box-shadow: inset 0 0 0 1px var(--flap); }
.tile.moved { background: linear-gradient(180deg, var(--flap) 0 50%, var(--flap-lo) 50%); color: var(--housing); }
.tile.dead { background: var(--housing); color: var(--flap); box-shadow: inset 0 0 0 1px var(--ghost); }
/* Big figures beside proof */
.bigfig { font-family: "Alumni Sans", sans-serif; font-weight: 800; font-size: 250px; line-height: .86; letter-spacing: -.01em; margin: 0; white-space: nowrap; }
.bigfig small { font-family: "Schibsted Grotesk", sans-serif; font-weight: 700; font-size: 84px; letter-spacing: 0; margin: 0 16px; vertical-align: .34em; }
.bigcap { margin: 26px 0 0; font-size: 28px; font-weight: 500; line-height: 1.3; max-width: 600px; }
.facts { margin: 26px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.facts li { font-size: 20px; color: var(--ink-muted); padding-top: 10px; border-top: 1px solid var(--hair); }
.facts li .fig { font-size: 30px; color: var(--ink); margin-right: 6px; }
/* Cards (the why slide) */
.cols3 { flex: none; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; margin-top: 0; align-items: stretch; }
.card .lbl { align-self: flex-start; }
.card { background: var(--flap); color: var(--housing); padding: 34px 36px; clip-path: var(--chamfer); box-shadow: 0 2px 0 var(--split); font-size: 28px; line-height: 1.3; font-weight: 500; display: flex; flex-direction: column; gap: 20px; }
.card.dark { background: var(--housing); color: var(--flap); }
.card .fig { font-size: 112px; line-height: .9; display: block; font-weight: 800; }
.card .fig small { font-family: "Schibsted Grotesk", sans-serif; font-size: 48px; font-weight: 700; }
.card small { font-size: 17px; color: var(--ink-muted); font-weight: 400; line-height: 1.35; margin-top: auto; }
.card.dark small { color: var(--ghost); }
""".replace("{TYPE}", TYPE)


def image(slide, key="image", crop=None):
    """The slide's image as a file URI; `crop` is [x, y, w, h] in CSS pixels of a capture at `scale`."""
    src = ROOT / slide[key]
    crop = crop or slide.get("crop")
    if crop:
        from PIL import Image
        x, y, w, h = crop
        scale = slide.get("scale", 2)
        CROPS.mkdir(parents=True, exist_ok=True)
        out = CROPS / f"{slide['id']}-{Path(slide[key]).stem}.png"
        im = Image.open(src)
        im.crop((x * scale, y * scale, (x + w) * scale, (y + h) * scale)).save(out)
        src = out
    return src.as_uri()


def render(slide):
    body = slide["html"]
    for key in [k for k in slide if k == "image" or k.startswith("image_")]:
        body = body.replace("{" + key.upper() + "}", image(slide, key, slide.get("crop" + key[5:])))
    kicker = f'<p class="kicker">{slide["kicker"]}</p>' if slide.get("kicker") else ""
    h1 = f'<h1{" class=quote-h" if slide.get("kicker") else ""}>{slide["headline"]}</h1>' if slide.get("headline") else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><style>{CSS}</style></head><body class="{"dark" if slide.get("dark") else ""}">
<div class="slide">
  <div class="top"><img src="{BRAND}/wordmark.svg" alt="Final Buzzer"><span class="badge">{slide["badge"]}</span></div>
  {kicker}{h1}
  <div class="stage" style="{slide.get("stage_style", "")}">{body}</div>
  <div class="foot"><span class="url">{URL}</span></div>
</div></body></html>"""


def main():
    only = set(sys.argv[1:])
    slides = S.build()
    OUT.mkdir(parents=True, exist_ok=True); HTML_DIR.mkdir(parents=True, exist_ok=True)
    if not only:
        for old in OUT.glob("*.png"):
            old.unlink()
    lines = ["# Devpost gallery", "", "Rendered by `devpost/slides/build.py` from live captures and the results files. Upload in this order; paste each caption under its image (the caption is not drawn on the slide).", ""]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1500, "height": 1000}, device_scale_factor=1)
        for i, s in enumerate(slides, 1):
            name = f"{i:02d}-{s['id']}.png"
            lines.append(f"{i}. **{name}**: {html.unescape(re.sub('<[^>]+>', '', s['caption']))}")
            if only and s["id"] not in only:
                continue
            f = HTML_DIR / f"{i:02d}-{s['id']}.html"; f.write_text(render(s), encoding="utf-8")
            pg.goto(f.as_uri()); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(250)
            over = pg.evaluate("Math.max(0, document.querySelector('.slide').scrollHeight - 1000)")
            stage_over = pg.evaluate("(() => { const s = document.querySelector('.stage'); return Math.max(0, s.scrollHeight - s.clientHeight); })()")
            pg.screenshot(path=str(OUT / name))
            print(name, "ok" if not (over or stage_over) else f"OVERFLOW slide {over} stage {stage_over}")
        b.close()
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
