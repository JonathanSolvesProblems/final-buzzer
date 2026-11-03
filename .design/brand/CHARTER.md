# Final Buzzer brand charter

Every screen obeys these. Each law is checkable and carries its reason. Machine-checked part
in `charter.json`, run with `lint_brand.py` after every build step.

## Colour
1. **The canvas is the painted block wall of a gym, flat light grey (#E9EAEC).** No grain, no
   sheen, no paper. Never pure white, never pure black, never a blue slate. Because the board
   hangs on the gym wall, and it is the only object there. (3 Nov: the lit maple and the warm
   olive-black were dropped at the owner's request; he did not like the brown.)
2. **One theme: a neutral scoreboard-black board (#16171A) on the wall.** Black with no hue,
   neither warm brown nor console blue, and nothing on it emits light. A dark-room variant was
   built and cut on 27 Oct: the board stays dark either way, so the variant changed only the
   margin and four critics read it as unfinished.
3. **Yellow flaps carry the one number that matters, and nothing else**: seconds from the
   buzzer to the payout. White flaps count. Yellow is a printed flap with dark numerals, only
   ever on the housing, never text on maple, never a button, a border or a state. Because on
   the flip board the "to win" row uses yellow flaps: two colours of flap mean two kinds of
   number (found detail 6). (Replaces ballpoint blue, which read as link blue.)
4. **The association's colour stays on the association's own pages** (the association's own pages
   checkout and schedule), never on this board. The club and event names are printed on the
   housing in body type. Because a decorative stripe of it read as filler to two critics,
   and the board belongs to every club at the tournament, not only the host.
5. **No hue carries a state.** Money state is which face of the flap shows. Because a ref
   with red-green colour blindness must read the board from the bench.
6. **No red LED, no green LED, no glow.** Because that is the arena board, the attractor this
   design refuses (anti-brief 1).

## Type
7. **Numerals are Alumni Sans with tabular figures, in fixed-width columns**: amounts, times,
   scores, game numbers, seconds. Body text never carries a number that compares. Because
   boards and scorebooks align digits so a glance compares them (found detail 12).
8. **Alumni Sans is for the wordmark and numerals only.** Every word (tabs, court names,
   headings, buttons, labels) is Schibsted Grotesk, sentence case. No tracked-caps
   micro-labels over numbers. Because one condensed face on everything shouts evenly and
   reads as the stock sports pairing (blind critics, rounds 11 and 12).
9. **Titles carry no comma and no full stop; a question keeps its mark.** Sentence case. No
   Title Case, no italic emphasis word.

## The tile and the device
10. **On the board, a game is always a flap tile with a split line and chamfered corners.** On a phone, games in play and next up are single rows (matchup, time and court, division), and finals are small flaps. Never a card,
    never a pill, never a row with a coloured dot. Four states, each with its own shape:
    ghost (housing colour inside a keyline): not started. Black face with a cream rim: in
    play. Cream face: final and paid. Caught mid-flip (top cream, bottom black, dropped 2 px): held for Sam. A paid tile draws its payout speed as a bar on a 60 second scale.
    Because the flaps on the table already tell the gym the state (found details 2, 6).
11. **Whose decision it is is said in words**, once, in the header: "Next decision: Sam, 1
    game". No badge counts, no red dots, no bells, no triangles (critics read the possession
    triangle as a play icon in three rounds running).
12. **Progress through a day is the board itself**: the count of cream faces, and the line
    "16 of 34 games paid". Never a progress bar, never a percentage ring.
13. **A count is a number set in Alumni beside its heading or on a flap.** Never a numeric
    badge, never a row of dots on a tile (three dots read as an overflow menu; round 11).
14. **The headline number lives on the yellow flaps**, once, and is the only number on
    flaps; every other count is a line of numerals. The baseline it beats is printed beside
    it in body type once Sam gives it. It is never repeated as a stat card, and an unmeasured
    number is shown as the words "not yet measured", never as a dash or a zero.

## Depth, edges, motion
15. **Depth is material, never blur**: a split line on every flap, two-tone flap halves, a 2 px hard drop under the housing and under the counter digits. `box-shadow`
    and `drop-shadow` blur are always 0. In the dark theme, elevation is one lightness step.
16. **Corners: flaps and buttons are chamfered 4 px (3 px on small controls), the housing is
    rounded 14 px with a 2 px hard drop, inputs are square.** No pill radius anywhere, no
    frame inside a frame. Because the flaps in the photo have dog-eared corners and the
    housing is rounded (found details 1, 6).
17. **One orchestrated motion per screen: the flip.** Flaps flip with weight (420 ms: the
    old top drops 180 ms, the new bottom rises 240 ms with a slight overshoot), counters flip digit by digit, tiles settle into place on
    arrival with a 12 ms stagger. Nothing fades up on scroll, nothing moves on exit, nothing
    loops near text. With reduced motion the face changes instantly and nothing rotates.

## Illustration, voice, interdits
18. **Illustrations are cut-felt pieces from the kit, and never sit on the board screen.**
    They belong to empty, error and first-run states, the share image and the brand sheet,
    placed directly on the maple, never on a disc or plate. Any screen that carries one has
    the footer credit "Illustrations made with AI, held to one art direction".
19. **The agent's trace reads as scorer's entries**: short lines in ink, time first,
    "Paid game 41, $45 and $45 and $25, on the rate card." Never a chat bubble, never an
    avatar, never "I", never a model's name.
20. **Nothing on screen shows a child.** Teams are names; officials are "Official A" until
    they are real people who agreed.
21. **The reader's words only**: game, court, final, sheet, rate card, paid, owed, held, ref,
    table official, refund, receipt. Never: payout batch, transaction, orchestration,
    AI-powered, seamless, leverage, workflow, sandbox (except once, in the footer, as "test
    money").
