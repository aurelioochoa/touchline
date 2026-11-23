# Player career — verification

Design: `docs/game-design/designs/touchline-player-career.md` in the kidtopiaplay.com repo
(§15 recommendations approved). Everything below was measured on this machine on 2026-11-22.

## Gates

| Gate | Command | Result |
|---|---|---|
| Tests | `npm test` | RESULT_TESTS |
| Build | `npm run build` | type-check, production build, then `all gates passed` (licence, zero assets, no live network) |
| Smoke | `npm run smoke` | the existing club smoke (`smoke.mjs`, RESULT_CLUB_SMOKE) then `smoke-career.mjs`: `smoke: OK` |

Bundle: 1,214.2 kB before (35ed2af) → 1,280.9 kB after, **+67 kB minified, +20 kB gzip**, inside
the design's +60–90 KB budget. No new runtime dependency; Playwright 1.65.0 is a pinned
devDependency for the smoke, using the browser already in `~/.cache/ms-playwright`.

## What the tests prove

- **Engine seam** (`src/sim/player/moments.test.ts`): answering every key moment with "let him
  play" reproduces the uncontrolled match exactly (score, shots, scorers, cards); a recorded
  `(tick, choice)` list replays to the same match, and a different list gives a different one;
  a pass to an opponent or an aim 12 m wide is refused and the moment stays open; a starter
  gets 6–10 moments on a ladder of eight role/strength pairings (ST, AML, AMR, AMC, MC; 90–130
  against 130–90); a benched hero comes on between 75' and 80' and still gets 2–5 moments.
- **Career** (`src/sim/player/career.test.ts`): the signing is 16 with PA 160–190 in the chosen
  shirt; the week takes three slots and no more; forty three-star drills never lift him past
  his potential; a substitute appearance counts and moves the rings; a hero at a club far above
  him is still in the matchday squad, and is offered a club where he would start (as loans,
  being young). **Twenty seasons on autopilot**: same hero through every `pruneRetired`, a year
  older each season, always in his own number, never released or retired by the world, never
  above potential; the pyramid keeps its gradient; the twenty-season player save is under the
  same 1.4 MB budget and round-trips with `mode: 'player'`; Legacy converts the slot in one
  write and reloads as a Club career with the framed legend.
- **Save migration 4 → 5**: an old save gains `mode: 'club'` and nothing else changes. The
  existing save, season, engine and UI tests are untouched and still pass.
- **Drills**: a played session never scores below "let the coach run it"; every gap-run row
  leaves exactly one way through (200 seeds × 3 rows); placing a shot away from the keeper
  scores more than three times as often as shooting at him; the trial reads ST/MC/winger.

## What the browser smoke proves (`scripts/smoke-career.mjs`, real dist, Playwright Chromium)

1. **Desktop 1280×720, keyboard only**: menu → New → Player career; the training ground paints
   (luminance spread > 12); the three trial moments by arrows/Enter, the first through the aim
   grid; the signing; the locker's three rings; a kick-about and a played Hoops drill (five
   shots by keys, stars awarded); a match: `N` to the next moment, two moments answered by keys,
   Escape → "Play the rest for me" → post-match card; reload → Continue → same career.
2. **Phone 360×780, touch**: the same path by taps — tap the goal, tap a zone to aim, tap it
   again to shoot; every moment button and every locker control measured ≥ 56 px; no horizontal
   overflow; an extra session, a match moment answered by tap, Back, the post-match card.
3. **Iframe** with the site's exact `sandbox` and `allow`: the trial by keyboard inside the frame
   and the save written to the frame's localStorage.
4. **`?blank=1`**: the trial, a week (rest + a coach-run drill), and a match with a moment, with
   every button carrying an icon when its words are blank.

It fails on any console error, page error, failed request or external request.

## Screenshots looked at (`/tmp/touchline-shots/`)

SCREENSHOTS

## Deliberate differences from the design

- **No camera ease at the freeze.** Over the shoulder, the team-mates he could pass to are
  behind the lens and their buttons would have nowhere true to sit. The match keeps the chosen
  camera and instead drops to 4× while the ball travels to him and runs 1× for three seconds
  after each choice. The trial and drills do use the over-the-shoulder `player` camera.
- **Celebrations are a picked emblem over the picture**, not a 3D pose: the four poses unlock
  from the shelf and are offered after his goals (never with reduced motion).
- **Gap run is three arrow choices**, one per row of defenders, rather than a dragged path, so
  it is the same control as a match dribble and fully keyboard-operable.
- **National team deferred** (§15 q3 had no recommendation): no call-ups or caps.
- **The name is offered and re-rolled with a dice**, never typed: no free text in the mode.
- **Not built**: the ultras raising his number and the barra chanting on his touches as Fans
  rise (cosmetic; Fans already decides offers); an ageing winger being offered central roles;
  direct free kicks handed to a trusted hero (penalties are).
- **The hero's boot colour shows in the locker only**, not on the 3D figure.
- **A reload mid-match restarts that fixture**, exactly as the Club career already does; the
  design's "a freeze is engine state" save-anywhere was never true of matches in this game.
- **Back in a career match asks first** ("Keep playing" / "Play the rest for me"): the Club
  career's Back detaches the match, but a player career has no club screen to watch it from.

## Club career unchanged

The manager mode reaches none of the new paths: `MatchEngine` without `control` behaves as
before (the "let him play" identity test is the proof that even with control nothing is
drawn differently), selection, the market and the season roll only branch on `world.hero`, and
the existing club smoke still passes. `RenderClient.dispose` now also calls
`forceContextLoss()`, so a torn-down match returns its GL context at once instead of at GC.
