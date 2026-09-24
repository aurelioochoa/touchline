// The look: a football broadcast's control room, wrapped around a bright pitch.
//
// The world in one line: the ground is deep pitch-green, the type is crisp white, the
// ONE colour that moves is the club you manage — its kit primary is bound to `--tl-club`
// at runtime, so every accent on every screen is the shirt the eleven are wearing. A kid
// managing the red club and a kid managing the blue one are not looking at the same game.
//
// Two constraints shape this more than taste does:
//
// 1. **Zero asset files** (design §9, enforced by scripts/check-licenses.mjs). No web
//    font, no image, no icon sprite. So the display voice is the system stack pushed hard
//    — 800 weights, tight tracking and tabular numerals — and the iconography is drawn in
//    icons.ts. A sports interface is mostly numerals anyway, and numerals are the one
//    thing a system stack renders identically everywhere.
// 2. **56px hit targets and full keyboard operation** (design §10). Every control below
//    clears 56px on touch; the desktop rules shrink the chrome, never the target.
//
// Injected rather than shipped as a .css file for the same reason everything else here is
// generated: one place, one string, no asset.
//
// ONE TRAP, and it has been fallen into twice: the whole stylesheet is a JavaScript
// template literal, so a BACKTICK anywhere inside it — including inside a CSS comment,
// where quoting a property name is the natural thing to do — ends the string early. The
// error TypeScript reports for that is a syntax complaint about a line hundreds of lines
// further down, which is no help at all. Do not use backticks below this line.

const CSS = `
/* Padding and borders count INSIDE a declared width. Everything below assumes it, and for
   a long time nothing said so: the stylesheet had no reset at all, so .tl-row-item's
   width:100% plus its 32px of horizontal padding rendered 32px wider than the card holding
   it and sheared the score pill off the right edge of every fixture. It was invisible on
   the squad screen, whose rows are buttons — the browser's own sheet already gives a button
   border-box, so one class laid out correctly as a button and incorrectly as a div. */
*, *::before, *::after { box-sizing: border-box; }

:root {
  color-scheme: dark;

  /* --- ground: the pitch at dusk, which is what a control room looks out on --- */
  --tl-g0: #05130c;
  --tl-g1: #0a2015;
  --tl-g2: #10301f;
  --tl-surface: #10291c;
  --tl-surface-2: #16382642;
  --tl-raised: #17402a;

  /* Hairlines and edges. Two weights: a structural line and a whisper. */
  --tl-line: rgba(178, 231, 198, 0.14);
  --tl-line-soft: rgba(178, 231, 198, 0.07);
  --tl-line-strong: rgba(178, 231, 198, 0.26);

  /* --- ink. Tinted from the ground's hue, never grey: grey text on a green field
         reads as a rendering fault, and the craft floor is right about it. --- */
  --tl-ink: #f1f8f2;
  --tl-ink-2: #a9c7b3;
  --tl-ink-3: #789a85;

  /* --- the club. Rebound per career in theme.ts; these are the neutral fallbacks. --- */
  --tl-club: #2fa85c;
  --tl-club-soft: #2fa85c2e;
  --tl-club-ink: #04150b;
  --tl-club-2: #f2f5f7;

  /* --- semantics. Height is the primary channel and colour the second (design §D),
         so these only have to be TELLABLE APART, not self-explanatory. --- */
  --tl-good: #46e08c;
  --tl-ok: #62b9ff;
  --tl-weak: #ffab3d;
  --tl-bad: #ff6f60;

  /* --- depth. Offset plus blur, always; a zero-offset halo is not a shadow. --- */
  --tl-sh-1: 0 1px 2px rgba(0,0,0,0.32), 0 2px 8px rgba(0,0,0,0.22);
  --tl-sh-2: 0 2px 4px rgba(0,0,0,0.3), 0 10px 28px rgba(0,0,0,0.34);
  --tl-sh-3: 0 8px 16px rgba(0,0,0,0.34), 0 28px 64px rgba(0,0,0,0.46);

  --tl-r-sm: 8px;
  --tl-r: 13px;
  --tl-r-lg: 20px;
  --tl-tap: 56px;
  --tl-row-metric: 96px;

  /* Every entrance and state change shares one curve and two durations, which is what
     makes a hand-written DOM app feel like one piece of software. */
  --tl-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --tl-fast: 140ms;
  --tl-slow: 420ms;
  /* The intro's arrival beats, tokens so the two motion rules at the bottom of this file
     can flatten them without knowing what uses them. */
  --tl-enter: 380ms;
  --tl-open: 320ms;

  /* Illustration. Three values plus the club colour is the whole palette every scene in
     src/ui/art/ gets, which is what keeps them looking like each other. Dusk, because the
     3D match is lit at dusk and the two must not look like different evenings. */
  --art-sky-top: #0a1712;
  --art-sky-low: #23473a;
  --art-ink: #050d0a;
  --art-shade: #0f1f19;
  --art-grass: #1a4130;
  --art-grass-lit: #26553d;
  --art-line: #cfe9db;
  --art-paper: #e6dcc4;
  --art-paper-lit: #f6efdf;
  --art-paper-fold: #d6c9ab;
  --art-paper-ink: #5a4a30;
  --art-signature: #1b2a63;

  --tl-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-synthesis-weight: none;
}

/* ---- browser surfaces. The parts we did not draw still carry the design. ----------
   Scoped to the document, not to .tl-root. The match screen mounts OUTSIDE .tl-root — it
   has to, because it takes over the whole viewport — so anything scoped to the shell
   missed every dialog the match opens, and the substitution sheet came up with a default
   scrollbar down the side of an otherwise finished panel. */
::selection { background: var(--tl-club); color: var(--tl-club-ink); }
html { scrollbar-color: rgba(178,231,198,0.24) transparent; scrollbar-width: thin; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(178,231,198,0.2); border-radius: 99px;
  border: 3px solid transparent; background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background: rgba(178,231,198,0.34); background-clip: content-box; }
:focus-visible { outline: 3px solid var(--tl-club); outline-offset: 2px; border-radius: 6px; }
input { caret-color: var(--tl-club); }
/* The coach's ring is drawn a few pixels outside whatever it points at, and a control at
   the edge of the screen would otherwise push a scrollbar onto the match view. */
.tl-coach { overflow: hidden; }

/* ---- shell ------------------------------------------------------------------------ */
.tl-root {
  position: fixed; inset: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  font: 400 15px/1.5 var(--tl-font);
  color: var(--tl-ink);
  background:
    radial-gradient(120% 90% at 50% 0%, var(--tl-g2) 0%, var(--tl-g1) 42%, var(--tl-g0) 100%);
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
}
.tl-canvas-holder { position: absolute; inset: 0; background: #05130c; }
.tl-canvas-holder > canvas { display: block; width: 100%; height: 100%; }

/*
 * On a phone held upright the match LETTERBOXES, exactly as design §10 says it must, and
 * the reason is geometry rather than taste. A 390x844 frame is 0.46 wide for its height;
 * to fit 68 metres of pitch across it, the horizontal field of view has to be about 70
 * degrees, which forces a vertical one over 110 — and at that angle a football pitch is a
 * fisheye. Every attempt to solve it by moving the camera makes it worse, because pulling
 * back to narrow the angle also puts the far touchline 140 metres away.
 *
 * So the picture keeps a sane shape and the bands above and below it stop being wasted:
 * the scoreboard and the eleven chips move OFF the football and onto the ground colour,
 * which is a better phone layout than the full-bleed one it replaces.
 */
/* The child combinator matters: a bare descendant selector here also caught the minimap's
   canvas, lifted it out of its panel and left it hanging off the right edge of the phone. */
@media (max-aspect-ratio: 4 / 5) {
  .tl-canvas-holder > canvas {
    position: absolute; left: 0; right: 0; top: 50%;
    transform: translateY(-50%);
    width: 100%; height: auto;
    /* 0.85 fills most of the gap between the scoreboard and the strip and still keeps the
       lens under camera.ts's 1.45 gain cap, which is where a football pitch starts to
       look like a fisheye. The max-height stops it reaching either bar on a short phone. */
    aspect-ratio: 0.85;
    max-height: calc(100dvh - 200px);
  }
}

.tl-main {
  grid-row: 2;
  position: relative; z-index: 1;
  overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
  /* Room for the fixed tab bar. On desktop the bar is in the chrome and this collapses. */
  padding: 16px 14px calc(90px + env(safe-area-inset-bottom, 0px));
  scroll-behavior: smooth;
}
@media (min-width: 1080px) { .tl-main { padding: 22px 22px 40px; } }
/* The column is bounded. A league table stretched across a 27-inch monitor puts eight
   pixels of ink at each end of a two-metre line, and nothing is readable at that width. */
.tl-wrap { max-width: 1180px; margin-inline: auto; }

/* ---- topbar: the club, as a piece of broadcast furniture -------------------------- */
/* Three parts, left to right: who you are (the badge and the name, which is also the way
   home), the scorebug (where you stand and what you can spend — both change after every
   match), and the actions (the front door, settings, and Continue, the one bright thing). */
.tl-topbar {
  grid-row: 1; grid-column: 1 / -1;
  position: relative; z-index: 3;
  display: flex; align-items: center; gap: 12px;
  min-height: 76px;
  padding: 9px 14px 9px 8px;
  background: linear-gradient(180deg, rgba(8,26,17,0.96), rgba(8,26,17,0.86));
  border-bottom: 1px solid var(--tl-line);
  box-shadow: 0 1px 0 rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.22);
}
/* The kit stripe. Three pixels of the club's own colours across the top of the whole
   application — the cheapest possible statement of whose game this is. */
.tl-topbar::before {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg, var(--tl-club) 0%, var(--tl-club) 62%, var(--tl-club-2) 62%, var(--tl-club-2) 100%);
}
.tl-brand { padding-left: 8px; font: 800 18px/1 var(--tl-font); letter-spacing: -0.02em; }
.tl-top-id {
  display: flex; align-items: center; gap: 12px; min-width: 0; flex: 0 1 auto;
  min-height: var(--tl-tap); padding: 4px 14px 4px 6px;
  border: 0; border-radius: 14px; background: none; color: inherit; text-align: left;
  font: inherit; cursor: pointer;
  transition: background var(--tl-fast) var(--tl-ease);
}
.tl-top-id:hover { background: rgba(255,255,255,0.05); }
.tl-title { display: grid; gap: 2px; min-width: 0; }
.tl-club {
  font-size: 17.5px; font-weight: 760; letter-spacing: -0.02em; line-height: 1.15;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tl-sub {
  color: var(--tl-ink-2); font-size: 11.5px; font-weight: 640;
  letter-spacing: 0.05em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tl-spacer { flex: 1 1 auto; min-width: 0; }

.tl-scorebug {
  display: flex; align-items: stretch; flex: 0 0 auto;
  border: 1px solid var(--tl-line); border-radius: 12px; overflow: hidden;
  background: rgba(0,0,0,0.3);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
.tl-bug-cell {
  display: grid; grid-template-columns: auto auto; column-gap: 8px; row-gap: 3px;
  align-items: center; align-content: center;
  padding: 7px 15px 7px 12px;
}
.tl-bug-cell + .tl-bug-cell { border-left: 1px solid var(--tl-line); }
.tl-bug-cell .tl-icon { grid-row: 1 / 3; color: var(--tl-club); }
.tl-bug-cell b {
  font: 800 17px/1 var(--tl-font); letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums lining-nums;
}
.tl-bug-label {
  font: 650 9.5px/1 var(--tl-font); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--tl-ink-3); white-space: nowrap;
}

.tl-top-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.tl-btn.tl-top-icon { color: var(--tl-ink-2); border-color: transparent; }
.tl-btn.tl-top-icon:hover:not(:disabled) { color: var(--tl-ink); }
.tl-btn.tl-top-icon[aria-current="page"] { color: var(--tl-club); background: var(--tl-club-soft); }
/* Continue carries the next opponent under its label, so the button says what pressing it
   is going to lead to. Without an opponent it is a plain one-line button. */
.tl-btn.tl-top-continue {
  display: grid; grid-template-columns: auto auto; column-gap: 9px; row-gap: 3px;
  align-content: center; margin-left: 4px; padding: 0 20px 0 16px;
}
.tl-btn.tl-top-continue > .tl-icon { grid-row: 1 / 3; }
.tl-btn.tl-top-continue > span { align-self: end; text-align: left; }
.tl-btn.tl-top-continue > small {
  grid-column: 2; align-self: start; text-align: left;
  font: 700 10.5px/1 var(--tl-font); letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.72;
}
.tl-btn.tl-top-continue:not(:has(small)) > span { grid-row: 1 / 3; align-self: center; }

/* A phone: the scorebug drops to a slim strip under the name row. */
@media (max-width: 759px) {
  .tl-topbar {
    display: grid; grid-template-columns: minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    grid-template-areas: "id id id go" "bug bug menu set";
    row-gap: 6px; column-gap: 6px; min-height: 0; padding: 8px 8px 8px 4px;
  }
  .tl-top-id { grid-area: id; padding-right: 6px; gap: 10px; }
  .tl-top-id .tl-crest { width: 36px; height: 36px; }
  .tl-club { font-size: 16px; }
  .tl-top-actions { display: contents; }
  .tl-top-menu { grid-area: menu; }
  .tl-top-settings { grid-area: set; }
  .tl-top-continue { grid-area: go; }
  .tl-spacer { display: none; }
  .tl-scorebug { grid-area: bug; margin-left: 4px; border-radius: 12px; }
  .tl-bug-cell {
    flex: 1 1 0; grid-template-columns: auto 1fr; justify-items: start;
    padding: 6px 12px; column-gap: 7px;
  }
  .tl-bug-cell .tl-icon { grid-row: auto; }
  .tl-bug-cell b { font-size: 16px; }
  /* The labels go: two figures with their icons are the whole of it at this width, and the
     cells carry their names as tooltips and in the accessible text. */
  .tl-bug-label { display: none; }
  .tl-btn.tl-top-continue { padding: 0 14px 0 12px; font-size: 14px; }
  .tl-btn.tl-top-continue > small { display: none; }
  .tl-btn.tl-top-continue > span { grid-row: 1 / 3; align-self: center; }
}
@media (max-width: 389px) {
  .tl-top-id .tl-sub { display: none; }
}

/* ---- crest ------------------------------------------------------------------------ */
/* The badge is an <svg> now and carries its own outline, so nothing here may clip it: the
   rounded-box silhouette that used to live on this rule WAS the crest, and a shield drawn
   inside it came out with its point cut off. What is left is the drop shadow. */
.tl-crest { flex: 0 0 auto; display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45)); }

/* ---- the badge editor -------------------------------------------------------------- */
/* Preview on the left and controls on the right above 520px, stacked below it. The preview
   never moves and never re-renders from scratch — see crestEditor.ts. */
.tl-crest-editor { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; }
.tl-crest-stage { display: grid; gap: 10px; justify-items: center; flex: 0 0 auto; }
.tl-crest-preview { display: grid; place-items: center; min-height: 112px; }
.tl-crest-controls { flex: 1 1 300px; min-width: 0; display: grid; gap: 12px; }
.tl-crest-tabs {
  display: flex; gap: 4px; flex-wrap: wrap;
  padding: 4px; border-radius: 12px; background: rgba(255,255,255,0.05);
}
.tl-crest-tab {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  min-height: var(--tl-tap); min-width: var(--tl-tap); padding: 0 11px; border-radius: 9px;
  border: 0; background: none; color: var(--tl-ink-2);
  font: 700 12.5px/1 var(--tl-font);
}
.tl-crest-tab:hover { color: var(--tl-ink); background: rgba(255,255,255,0.06); }
.tl-crest-tab.on { background: var(--tl-club, rgba(255,255,255,0.16)); color: var(--tl-club-ink, #fff); }
.tl-crest-panel { display: grid; gap: 12px; }
.tl-crest-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.tl-crest-colours { display: grid; gap: 12px; }
/* An option IS a crest, so the button around it is only a target and a selection mark. */
.tl-crest-option {
  min-width: var(--tl-tap); min-height: var(--tl-tap);
  padding: 5px; border-radius: 11px; cursor: pointer; line-height: 0;
  border: 2px solid transparent; background: rgba(255,255,255,0.05);
}
.tl-crest-option:hover { background: rgba(255,255,255,0.1); }
.tl-crest-option.on { border-color: var(--tl-club, #fff); background: rgba(255,255,255,0.12); }
/* A "none" option still has to be a target with a shape, or the row starts with a hole. */
.tl-crest-option > svg { display: block; }
@media (max-width: 520px) {
  .tl-crest-editor { flex-direction: column; }
  .tl-crest-stage { justify-items: start; }
}

/* ---- navigation ------------------------------------------------------------------- */
/* One element, two placements. On a phone it is a tab bar fixed to the bottom, because the
   top of an 844px screen is not reachable by the thumb holding it. From 1080px it is a
   rail down the left of the grid, where seven labelled sections read as a list rather than
   as a squeezed row of buttons fighting the scorebug for the top bar. */
.tl-nav {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 6;
  display: flex; gap: 2px;
  padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(0deg, rgba(5,19,12,0.99), rgba(5,19,12,0.94));
  border-top: 1px solid var(--tl-line);
  box-shadow: 0 -6px 22px rgba(0,0,0,0.34);
}
.tl-tab {
  flex: 1 1 0; min-width: 0;
  display: grid; justify-items: center; align-content: center; gap: 4px;
  min-height: var(--tl-tap); padding: 5px 2px;
  border: 0; border-radius: var(--tl-r-sm);
  background: none; color: var(--tl-ink-3);
  font: 660 10.5px/1 var(--tl-font); letter-spacing: 0.01em;
  cursor: pointer; touch-action: manipulation;
  transition: color var(--tl-fast) var(--tl-ease);
}
/* The icon sits in a pill that fills in for the current section: a shape change, not only
   a colour one, so the answer to "where am I" survives a colour-blind eye. */
.tl-tab-ico {
  display: grid; place-items: center; width: 48px; height: 28px; border-radius: 99px;
  transition: background var(--tl-fast) var(--tl-ease), color var(--tl-fast) var(--tl-ease);
}
.tl-tab-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.tl-tab:hover { color: var(--tl-ink-2); }
.tl-tab:hover .tl-tab-ico { background: rgba(255,255,255,0.06); }
.tl-tab[aria-current="page"] { color: var(--tl-ink); }
.tl-tab[aria-current="page"] .tl-tab-ico { background: var(--tl-club); color: var(--tl-club-ink); box-shadow: var(--tl-sh-1); }

@media (min-width: 1080px) {
  .tl-root.has-nav { grid-template-columns: 232px minmax(0, 1fr); }
  .tl-root.has-nav .tl-main { grid-column: 2; }
  .tl-nav {
    position: relative; grid-row: 2; grid-column: 1; z-index: 2;
    flex-direction: column; gap: 3px;
    padding: 18px 12px;
    background: linear-gradient(90deg, rgba(4,15,10,0.72), rgba(4,15,10,0.5));
    border-top: 0; border-right: 1px solid var(--tl-line);
    box-shadow: none; overflow-y: auto;
  }
  .tl-tab {
    flex: 0 0 auto;
    grid-auto-flow: column; grid-template-columns: auto minmax(0, 1fr); justify-items: start;
    align-items: center; gap: 12px; min-height: var(--tl-tap); padding: 0 12px 0 8px;
    border-radius: 14px;
    font-size: 14.5px; font-weight: 640; letter-spacing: -0.01em; color: var(--tl-ink-2);
    transition: background var(--tl-fast) var(--tl-ease), color var(--tl-fast) var(--tl-ease);
  }
  .tl-tab-ico { width: 38px; height: 38px; border-radius: 11px; }
  .tl-tab:hover { background: rgba(255,255,255,0.045); color: var(--tl-ink); }
  .tl-tab:hover .tl-tab-ico { background: rgba(255,255,255,0.06); }
  .tl-tab[aria-current="page"] { background: rgba(255,255,255,0.07); color: var(--tl-ink); }
}
/* Keep labelled navigation below the chrome until every label fits. Narrow phones
   use two rows so all seven routes retain a 56px target without sideways scrolling. */
@media (max-width: 419px) {
  .tl-nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .tl-main { padding-bottom: calc(148px + env(safe-area-inset-bottom, 0px)); }
}

/* ---- buttons ---------------------------------------------------------------------- */
.tl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: var(--tl-tap); padding: 0 20px;
  border: 1px solid var(--tl-line-strong);
  border-radius: var(--tl-r);
  background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.035));
  color: var(--tl-ink);
  font: 650 15px/1 var(--tl-font); letter-spacing: -0.005em;
  cursor: pointer; touch-action: manipulation; text-align: center;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), var(--tl-sh-1);
  transition:
    transform var(--tl-fast) var(--tl-ease),
    background var(--tl-fast) var(--tl-ease),
    box-shadow var(--tl-fast) var(--tl-ease),
    border-color var(--tl-fast) var(--tl-ease);
}
.tl-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.06));
  border-color: rgba(178,231,198,0.36);
}
.tl-btn:active:not(:disabled) { transform: translateY(1px) scale(0.995); box-shadow: inset 0 1px 3px rgba(0,0,0,0.3); }
.tl-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.tl-btn.tl-primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--tl-club) 88%, white), var(--tl-club));
  color: var(--tl-club-ink);
  border-color: color-mix(in srgb, var(--tl-club) 70%, black);
  font-weight: 750;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.34), var(--tl-sh-2);
}
.tl-btn.tl-primary:hover:not(:disabled) {
  background: linear-gradient(180deg, color-mix(in srgb, var(--tl-club) 74%, white), color-mix(in srgb, var(--tl-club) 94%, white));
}
.tl-btn.tl-ghost { background: none; border-color: var(--tl-line); box-shadow: none; }
.tl-btn.tl-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.06); box-shadow: none; }
.tl-btn.tl-sm { min-height: var(--tl-tap); min-width: var(--tl-tap); padding: 0 13px; font-size: 13px; border-radius: var(--tl-r-sm); gap: 6px; }
.tl-btn.tl-icon-only { padding: 0; width: var(--tl-tap); }
.tl-btn.tl-sm.tl-icon-only { width: var(--tl-tap); }
.tl-btn.tl-block { width: 100%; }
.tl-btn[aria-pressed="true"] {
  background: var(--tl-club); color: var(--tl-club-ink);
  border-color: color-mix(in srgb, var(--tl-club) 70%, black);
}
.tl-icon { display: block; flex: 0 0 auto; }

/* ---- surfaces --------------------------------------------------------------------- */
.tl-card {
  position: relative;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.015)),
    var(--tl-surface);
  border: 1px solid var(--tl-line);
  border-radius: var(--tl-r-lg);
  box-shadow: var(--tl-sh-2);
  padding: 18px;
}
/* The gloss seam along the top edge. One pixel, and it is most of what separates a
   surface that was designed from a div with a background colour. */
.tl-card::before {
  content: ''; position: absolute; inset: 0 14px auto; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22) 22%, rgba(255,255,255,0.22) 78%, transparent);
}
.tl-card.tl-flush { padding: 0; overflow: hidden; }

/* The section label. A broadcast lower-third caption, which is the idiom this whole
   interface is quoting. */
.tl-h {
  display: flex; align-items: center; gap: 9px;
  margin: 0 0 14px;
  font: 700 11px/1 var(--tl-font);
  letter-spacing: 0.13em; text-transform: uppercase;
  color: var(--tl-ink-3);
}
.tl-h::after { content: ''; flex: 1 1 auto; height: 1px; background: var(--tl-line-soft); }
.tl-card.tl-flush .tl-h { margin: 18px 18px 12px; }

.tl-grid { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
.tl-grid > * { min-width: 0; }
@media (min-width: 940px) {
  .tl-grid.cols2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  /* The dashboard: a wide primary column and a rail. Not two equal halves — the next
     match and the table are not the same size of thing. */
  .tl-grid.dash { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); align-items: start; }
}

/* ---- statistics ------------------------------------------------------------------- */
.tl-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(78px, 1fr)); gap: 2px; }
.tl-stat span { overflow-wrap: anywhere; }
.tl-stat {
  display: grid; gap: 3px; padding: 12px 14px;
  background: rgba(255,255,255,0.03);
  border-radius: var(--tl-r-sm);
}
.tl-stat b {
  font: 800 27px/1 var(--tl-font); letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums lining-nums;
}
.tl-stat b sup { font-size: 0.5em; font-weight: 700; letter-spacing: 0; vertical-align: super; }
.tl-stat span {
  font: 600 10.5px/1.2 var(--tl-font); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--tl-ink-3);
}
/* The accent, not the SECOND kit colour. --tl-club-2 is whatever the club's change strip
   happens to be, which for half the world is a pale grey — so the one figure on the screen
   that is supposed to draw the eye was rendering less legible than the three beside it. */
.tl-stat.hot b { color: var(--tl-club); }

/* ---- bars ------------------------------------------------------------------------- */
.tl-bar {
  position: relative; height: 8px; border-radius: 99px;
  background: rgba(0,0,0,0.36); box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
  overflow: hidden; min-width: 44px;
}
.tl-bar-fill {
  position: absolute; inset: 0 auto 0 0; border-radius: 99px;
  background: var(--tl-club);
  /* Width, not transform. The fill is absolutely positioned inside a clipped pill, so its
     width changes nothing outside itself — and scaleX would squash the rounded right cap
     and stretch the gradient along with it, which is the whole shape of the bar. */
  transition: width var(--tl-slow) var(--tl-ease);
}
/* Except in the match strip, where a bar is live telemetry rather than an entrance. Those
   eleven are written every frame, so a 420ms transition never finishes: it restarts sixty
   times a second, costs a layout each time, and leaves the bar showing a number from a
   third of a second ago. A stamina readout has to be the stamina. */
.tl-chip .tl-bar-fill { transition: none; }
.tl-bar-fill.tone-good { background: linear-gradient(90deg, color-mix(in srgb, var(--tl-good) 72%, black), var(--tl-good)); }
.tl-bar-fill.tone-ok { background: linear-gradient(90deg, color-mix(in srgb, var(--tl-ok) 72%, black), var(--tl-ok)); }
.tl-bar-fill.tone-weak { background: linear-gradient(90deg, color-mix(in srgb, var(--tl-weak) 72%, black), var(--tl-weak)); }
.tl-bar-fill.tone-bad { background: linear-gradient(90deg, color-mix(in srgb, var(--tl-bad) 72%, black), var(--tl-bad)); }

/* An attribute: the bar and its numeral, side by side. The numeral is tabular so a
   column of them lines up, which is the whole reason to show numerals at all. */
.tl-attr { display: grid; grid-template-columns: 1fr 22px; align-items: center; gap: 8px; }
.tl-attr b {
  font: 700 12.5px/1 var(--tl-font); font-variant-numeric: tabular-nums;
  text-align: right; color: var(--tl-ink-2);
}
.tl-attr.hi b { color: var(--tl-ink); }

/* ---- pills and tags --------------------------------------------------------------- */
.tl-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 6px;
  font: 700 10.5px/1.25 var(--tl-font); letter-spacing: 0.05em; text-transform: uppercase;
  background: rgba(255,255,255,0.08); color: var(--tl-ink-2);
  white-space: nowrap;
}
.tl-pill.bad { background: color-mix(in srgb, var(--tl-bad) 22%, transparent); color: var(--tl-bad); }
.tl-pill.warn { background: color-mix(in srgb, var(--tl-weak) 22%, transparent); color: var(--tl-weak); }
.tl-pill.good { background: color-mix(in srgb, var(--tl-good) 20%, transparent); color: var(--tl-good); }
.tl-pill.club { background: var(--tl-club); color: var(--tl-club-ink); }
/* The live clock on the club screen's match card. It is the one thing on that screen that
   changes on its own, so it says so — a dot that breathes, and no dot at all once the
   match is paused, because a pulsing "PAUSE" is a contradiction. */
.tl-pill.live {
  background: color-mix(in srgb, var(--tl-club) 22%, transparent);
  color: var(--tl-club); font-variant-numeric: tabular-nums;
  display: inline-flex; align-items: center; gap: 6px;
}
.tl-pill.live::before {
  content: ''; width: 6px; height: 6px; border-radius: 99px; background: currentColor;
  animation: tl-live 1.6s var(--tl-ease) infinite;
}
.tl-pill.live.paused { background: rgba(255,255,255,0.08); color: var(--tl-ink-2); }
.tl-pill.live.paused::before { animation: none; opacity: 0.5; }
@keyframes tl-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.tl-pos { min-width: 34px; justify-content: center; font-variant-numeric: tabular-nums; }

/* Form: five results as shape AND colour, so it survives colour blindness (design §D). */
.tl-form { display: inline-flex; gap: 3px; }
.tl-form i {
  width: 16px; height: 16px; border-radius: 4px;
  display: grid; place-items: center;
  font: 800 9px/1 var(--tl-font); font-style: normal;
  background: rgba(255,255,255,0.09); color: var(--tl-ink-2);
}
.tl-form i.w { background: color-mix(in srgb, var(--tl-good) 26%, transparent); color: var(--tl-good); }
.tl-form i.d { background: rgba(255,255,255,0.11); color: var(--tl-ink-2); }
.tl-form i.l { background: color-mix(in srgb, var(--tl-bad) 24%, transparent); color: var(--tl-bad); }

/* ---- tables ----------------------------------------------------------------------- */
.tl-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.tl-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.tl-table th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 10px;
  font: 700 10px/1 var(--tl-font); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--tl-ink-3);
  background: var(--tl-surface);
  border-bottom: 1px solid var(--tl-line);
  white-space: nowrap;
}
.tl-table td { padding: 9px 10px; border-bottom: 1px solid var(--tl-line-soft); vertical-align: middle; }
.tl-table tbody tr { transition: background var(--tl-fast) var(--tl-ease); }
.tl-table tbody tr:last-child td { border-bottom: 0; }
.tl-table tbody tr[tabindex]:hover, .tl-table tbody tr.tap:hover { background: rgba(255,255,255,0.045); cursor: pointer; }
.tl-num { text-align: right; font-variant-numeric: tabular-nums lining-nums; }
/* The caption has to be told again, because .tl-table th above sets text-align:left and its
   two-part selector outranks a lone class no matter which is written first. Left to that,
   every numeral in the body sat right while its heading sat left, which put P, W, D, L, GD
   and PTS most of a column away from the figures they name. */
.tl-table th.tl-num, .tl-table td.tl-num { text-align: right; }
/* A league table is one wide column and seven narrow ones. Left to width:100% alone the
   browser shares the space evenly and puts 90px between "0" and "0", which is how the
   first version read as a spreadsheet rather than a table. */
/* These widths are the whole column, padding included — 20px of it on this breakpoint and
   14px below 599px. They were 54 and 46 when the stylesheet had no box-sizing reset and the
   numbers meant content alone; they are written out here so the table keeps the proportions
   it was drawn with rather than losing 20px per column to a rule about something else. */
.tl-table.cols-fixed { table-layout: fixed; }
.tl-table.cols-fixed th.tl-num, .tl-table.cols-fixed td.tl-num { width: 74px; }
.tl-table.cols-fixed th:first-child, .tl-table.cols-fixed td:first-child { width: 66px; }
.tl-table.cols-fixed td:nth-child(2) { overflow: hidden; }
/* A flex item will not shrink below its content unless it is told it may, and a club name
   that refuses to shrink pushes the whole fixed layout out of shape — which showed up as
   every club in the table rendering as one letter and an ellipsis. */
.tl-table .tl-name { min-width: 0; }
@media (max-width: 599px) {
  .tl-table.cols-fixed th.tl-num, .tl-table.cols-fixed td.tl-num { width: 54px; }
  .tl-table.cols-fixed th:first-child, .tl-table.cols-fixed td:first-child { width: 44px; }
  .tl-table th, .tl-table td { padding-left: 7px; padding-right: 7px; }
}
.tl-name { font-weight: 620; letter-spacing: -0.008em; }

/* The managed club, and the two lines that decide a season. A 3px marker in the rank
   column, not a coloured border down the whole row. */
.tl-table tr.is-me td { background: var(--tl-club-soft); }
.tl-table tr.is-me td:first-child { box-shadow: inset 3px 0 0 var(--tl-club); }
.tl-table tr.is-promo td:first-child { box-shadow: inset 3px 0 0 var(--tl-good); }
.tl-table tr.is-releg td:first-child { box-shadow: inset 3px 0 0 var(--tl-bad); }
.tl-table tr.is-me.is-promo td:first-child { box-shadow: inset 3px 0 0 var(--tl-good), inset 0 0 0 99px var(--tl-club-soft); }
.tl-table tr.is-me.is-releg td:first-child { box-shadow: inset 3px 0 0 var(--tl-bad), inset 0 0 0 99px var(--tl-club-soft); }

/* The legend under a table. Three words, so the two colours mean something. */
.tl-key { display: flex; flex-wrap: wrap; gap: 14px; padding: 12px 18px 2px; }
.tl-key span { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--tl-ink-3); font-weight: 600; }
.tl-key i { width: 3px; height: 13px; border-radius: 99px; }

/* Below 720px a squad table is a spreadsheet in a letterbox. The same data becomes a
   list of rows, which is the one reflow that is genuinely a different composition
   rather than the same one squeezed (design §10: reflow, do not scale). */
.tl-rows { display: grid; }
/* The column captions for the row list. The two bars at the end of a row are STACKED, so
   the captions are stacked too, in the same 96px column and the same order — a header
   whose shape does not match the thing it labels is worse than none. */
.tl-rows-head {
  display: grid; justify-content: end; gap: 4px;
  padding: 6px 16px 9px;
  font: 700 9.5px/1 var(--tl-font); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--tl-ink-3); border-bottom: 1px solid var(--tl-line);
}
.tl-rows-head span { width: var(--tl-row-metric); text-align: right; }
.tl-row-item {
  display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 12px;
  width: 100%; padding: 12px 16px; min-height: var(--tl-tap);
  background: none; border: 0; border-bottom: 1px solid var(--tl-line-soft);
  color: inherit; font: inherit; text-align: left; cursor: default;
  transition: background var(--tl-fast) var(--tl-ease);
}
.tl-row-item:last-child { border-bottom: 0; }
button.tl-row-item { cursor: pointer; }
button.tl-row-item:hover { background: rgba(255,255,255,0.045); }
.tl-row-item.is-me { background: var(--tl-club-soft); }
.tl-row-item .rk { font: 800 15px/1 var(--tl-font); font-variant-numeric: tabular-nums; color: var(--tl-ink-2); text-align: right; }
.tl-row-item .who { display: grid; gap: 4px; min-width: 0; }
.tl-row-item .who > b { font-weight: 640; letter-spacing: -0.008em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-row-item .meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.tl-row-item .end.metrics { width: var(--tl-row-metric); }
.tl-row-item .end { display: grid; gap: 5px; justify-items: end; }

/* ---- club picker ------------------------------------------------------------------ */
.tl-cards { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); }
.tl-club-card {
  position: relative; overflow: hidden;
  display: grid; gap: 9px; align-content: start;
  padding: 14px; min-height: 128px;
  border: 1px solid var(--tl-line); border-radius: var(--tl-r);
  background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012)), var(--tl-surface);
  color: var(--tl-ink); font: inherit; text-align: left; cursor: pointer;
  box-shadow: var(--tl-sh-1);
  transition: transform var(--tl-fast) var(--tl-ease), box-shadow var(--tl-fast) var(--tl-ease), border-color var(--tl-fast) var(--tl-ease);
}
/* Each card wears its own club's colours, not the theme's. Fifty-one clubs on one
   screen and every one of them different is the point of the screen. */
.tl-club-card::before {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg, var(--card-a) 0 62%, var(--card-b) 62% 100%);
}
.tl-club-card::after {
  content: ''; position: absolute; right: -46px; top: -46px; width: 150px; height: 150px;
  /* A gradient, not a flat disc. A hard-edged circle of near-transparent colour reads as a
     grey ring on a dark kit rather than as a wash, which is the whole of the effect. */
  background: radial-gradient(circle at 34% 66%, var(--card-a) 0%, transparent 68%);
  opacity: 0.24;
  transition: opacity var(--tl-fast) var(--tl-ease), transform var(--tl-slow) var(--tl-ease);
}
.tl-club-card:hover { transform: translateY(-2px); box-shadow: var(--tl-sh-2); border-color: var(--tl-line-strong); }
.tl-club-card:hover::after { opacity: 0.4; transform: scale(1.12); }
.tl-club-card .nm { font-weight: 660; font-size: 14.5px; line-height: 1.28; letter-spacing: -0.012em; }
.tl-club-card .rowtop { display: flex; align-items: center; gap: 8px; position: relative; }
.tl-club-card .abbr {
  font: 800 11px/1 var(--tl-font); letter-spacing: 0.1em; color: var(--tl-ink-3);
}

/* ---- tactics board ---------------------------------------------------------------- */
/* The board is sized from HEIGHT, not width. Given width:100% and an aspect ratio it
   grows to 580px tall inside a 500px column, which pushed the goalkeeper and the whole
   formation picker below the fold on a 720px laptop. A fixed-height flex row with the
   board deriving its width is the one arrangement where the aspect ratio survives both
   constraints. */
.tl-board-frame {
  display: flex; justify-content: center;
  padding: 28px 10px 44px;
  min-width: 0;
}
/* Two layers, and the split is load-bearing. The TURF clips — it owns the grass, the
   rounded corners and every marking, several of which are drawn deliberately past the
   edge (the centre circle is half off the top). The BOARD does not clip, because a
   player's name is printed under his token and a left-back's name is wider than the
   space between him and the touchline; with one clipping layer, "Bermudez" came out as
   "ermudez". */
.tl-board {
  position: relative; height: auto;
  width: min(100%, calc(min(560px, 100dvh - 320px) * 68 / 92));
  aspect-ratio: 68 / 92; flex: 0 0 auto;
  max-width: 100%; margin-inline: auto;
  touch-action: none;
}
.tl-board-turf {
  position: absolute; inset: 0; overflow: hidden; border-radius: var(--tl-r);
  background: repeating-linear-gradient(180deg, #2f7a3d 0 7.14%, #2a6f37 7.14% 14.28%);
  box-shadow: inset 0 0 0 2px rgba(255,255,255,0.5), inset 0 0 40px rgba(0,0,0,0.35), var(--tl-sh-2);
}
.tl-board .mk { position: absolute; border: 2px solid rgba(255,255,255,0.55); }
.tl-board .mk.fill { background: rgba(255,255,255,0.55); border: 0; }
.tl-board .mk.circ { border-radius: 50%; }
.tl-token {
  position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px;
  border-radius: 50%; border: 2px solid rgba(255,255,255,0.92);
  display: grid; place-items: center; gap: 0;
  font: 800 14px/1 var(--tl-font); font-variant-numeric: tabular-nums;
  box-shadow: 0 3px 10px rgba(0,0,0,0.45), inset 0 2px 0 rgba(255,255,255,0.24);
  cursor: grab; touch-action: none; user-select: none;
  transition: transform var(--tl-fast) var(--tl-ease), box-shadow var(--tl-fast) var(--tl-ease);
}
/* Preserve the compact shirt while its transparent pointer target reaches 56px. */
.tl-token::before { content: ''; position: absolute; inset: -7px; border-radius: 50%; }
.tl-token .lbl {
  position: absolute; top: 100%; margin-top: 3px;
  font: 700 9.5px/1 var(--tl-font); letter-spacing: 0.04em; text-transform: uppercase;
  color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  /* Capped, because two central midfielders standing a token apart have two names that
     want the same pixels. The number on the shirt is the identity here; the name is the
     enrichment, and a clipped one still tells you which of the two you are looking at. */
  max-width: 46px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The one being moved says its whole name, over the others. */
.tl-token.dragging .lbl, .tl-token:focus-visible .lbl, .tl-token:hover .lbl {
  max-width: none; z-index: 3;
}
.tl-token.dragging { cursor: grabbing; transform: scale(1.16); box-shadow: 0 10px 24px rgba(0,0,0,0.55); z-index: 2; }
.tl-shape {
  font: 800 30px/1 var(--tl-font); letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

/* ---- sliders ---------------------------------------------------------------------- */
/* Range inputs ship with three different platform appearances and none of them belong to
   this design, so all three are replaced. */
.tl-slider { display: grid; gap: 6px; }
.tl-slider > label {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font: 620 13px/1 var(--tl-font);
}
.tl-slider .val {
  font: 700 11px/1 var(--tl-font); letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--tl-ink-3);
}
.tl-range {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: var(--tl-tap); background: none; cursor: pointer; touch-action: pan-y;
}
.tl-range::-webkit-slider-runnable-track {
  height: 6px; border-radius: 99px;
  background: linear-gradient(90deg, var(--tl-club) var(--pct, 50%), rgba(0,0,0,0.4) var(--pct, 50%));
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
}
.tl-range::-moz-range-track {
  height: 6px; border-radius: 99px;
  background: linear-gradient(90deg, var(--tl-club) var(--pct, 50%), rgba(0,0,0,0.4) var(--pct, 50%));
}
.tl-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 22px; height: 22px; margin-top: -8px; border-radius: 50%;
  background: linear-gradient(180deg, #ffffff, #d9e6dd);
  border: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.45);
  transition: transform var(--tl-fast) var(--tl-ease);
}
.tl-range::-moz-range-thumb {
  width: 22px; height: 22px; border-radius: 50%; border: 0;
  background: linear-gradient(180deg, #ffffff, #d9e6dd);
  box-shadow: 0 2px 6px rgba(0,0,0,0.45);
}
.tl-range:active::-webkit-slider-thumb { transform: scale(1.16); }

/* A row of choices: the settings idiom, and the one used for quality and speed. */
.tl-choice { display: flex; gap: 4px; flex-wrap: wrap; }
.tl-choice .tl-btn { flex: 1 1 auto; min-width: 68px; }
/* Nine formation names do not divide evenly into rows, and stretching the last two across
   the full width makes the wrap look like a mistake. The tight variant sizes each button
   to its own label and lets the row end where it ends. */
.tl-choice.tight .tl-btn { flex: 0 0 auto; min-width: 0; }

.tl-set-row {
  display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; align-items: center;
  padding: 15px 0; border-bottom: 1px solid var(--tl-line-soft);
}
.tl-set-row:last-child { border-bottom: 0; }
.tl-set-row .lab { display: grid; gap: 3px; }
.tl-set-row .lab b { font-weight: 640; font-size: 14.5px; }
.tl-set-row .lab span { font-size: 12.5px; color: var(--tl-ink-3); line-height: 1.4; }
.tl-set-row.stack { grid-template-columns: 1fr; }
.tl-set-row.stack .tl-choice { max-width: 660px; }

/* ---- the match -------------------------------------------------------------------- */
/* Glass appears here and only here: over live video-like content, which is the one place
   a blurred translucent panel is doing a job rather than being a texture. */
.tl-hud {
  position: absolute; left: 0; right: 0; top: 0; z-index: 4;
  display: flex; align-items: flex-start; gap: 8px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 26px;
  background: linear-gradient(180deg, rgba(4,16,10,0.72) 0%, rgba(4,16,10,0.34) 52%, transparent 100%);
  pointer-events: none;
}
.tl-hud > * { pointer-events: auto; }
/* Under about 620px the scoreboard and five controls do not fit on one line, and what
   that looked like was a clipped club name with two buttons hanging under it. Below the
   breakpoint it is two rows ON PURPOSE — and on a letterboxed phone both rows sit above
   the picture rather than over it. */
@media (max-width: 619px) {
  .tl-hud {
    flex-direction: column; align-items: stretch; gap: 8px;
    padding-bottom: 14px;
  }
  .tl-hud .tl-spacer { display: none; }
  .tl-hud-btns { justify-content: center; }
  .tl-score { align-self: center; max-width: 100%; }
}

/* The scoreboard. A real one: two abbreviations, the score between them in the two clubs'
   colours, the clock in its own compartment. */
.tl-score {
  display: flex; align-items: stretch;
  border-radius: 10px; overflow: hidden;
  background: rgba(4,16,10,0.62);
  border: 1px solid rgba(255,255,255,0.16);
  box-shadow: var(--tl-sh-2);
  backdrop-filter: blur(12px) saturate(1.3);
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
}
.tl-score { min-width: 0; }
.tl-score .side {
  display: flex; align-items: center; gap: 7px; padding: 0 11px;
  font: 750 14px/1 var(--tl-font); letter-spacing: 0.06em;
  min-width: 0;
}
.tl-score .side > span {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tl-score .side i { width: 4px; align-self: stretch; margin: 5px 0; border-radius: 99px; }
.tl-score .goals {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: rgba(0,0,0,0.34);
  font: 800 22px/1 var(--tl-font); font-variant-numeric: tabular-nums; letter-spacing: 0.02em;
}
.tl-score .goals em { font-style: normal; opacity: 0.42; font-size: 15px; }
.tl-clock {
  display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 3px;
  padding: 0 12px; min-width: 58px;
  background: rgba(255,255,255,0.09);
  font: 700 14px/1 var(--tl-font); font-variant-numeric: tabular-nums;
}
.tl-clock .p {
  font: 700 8.5px/1 var(--tl-font); letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--tl-ink-3); white-space: nowrap;
}
.tl-clock .p:empty { display: none; }
.tl-clock.stoppage .t { color: var(--tl-weak); }
/* The side you manage is marked on the scoreboard, so "which one are we" is never a
   question — a small club-coloured underline beneath the abbreviation. */
.tl-score .side.mine > span { box-shadow: inset 0 -2px 0 var(--tl-club); padding-bottom: 2px; }
.tl-score .goals .n { display: inline-block; min-width: 0.62em; text-align: center; }
.tl-score .goals .n.bump { animation: tl-bump 900ms var(--tl-ease) both; }
@keyframes tl-bump {
  0% { transform: scale(1); color: var(--tl-ink); }
  18% { transform: scale(1.55); color: #fff; text-shadow: 0 0 18px rgba(255,255,255,0.8); }
  100% { transform: scale(1); }
}
.tl-scorewrap { display: grid; gap: 5px; min-width: 0; }

/* Controls in three groups: running the match, what you are looking at, and the panels.
   The gap between groups is wider than the gap inside one, so the eye reads three things
   rather than seven. */
.tl-hud-group { display: flex; gap: 4px; }
.tl-hud-btns { column-gap: 12px; }
@media (max-width: 619px) { .tl-hud-btns { column-gap: 6px; } }
.tl-cam-wrap { position: relative; }
.tl-cam-btn { gap: 6px; }
.tl-cam-btn .tl-cam-name { max-width: 128px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-cam-btn > .tl-icon:last-child { opacity: 0.6; margin-left: -2px; rotate: 90deg; }
@media (max-width: 859px) { .tl-cam-btn .tl-cam-name { display: none; } }
.tl-cam-menu {
  position: absolute; right: 0; top: calc(100% + 8px); z-index: 8;
  width: 252px; max-width: calc(100vw - 24px);
  display: grid; gap: 2px; padding: 6px;
  border-radius: 14px; border: 1px solid rgba(255,255,255,0.18);
  background: rgba(6,22,14,0.92);
  backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
  box-shadow: var(--tl-sh-3);
  transform-origin: top right;
  animation: tl-pop var(--tl-open) var(--tl-ease) both;
}
@media (max-width: 619px) {
  .tl-cam-menu { right: auto; left: 50%; translate: -50% 0; transform-origin: top center; }
}
.tl-cam-item {
  display: flex; align-items: center; gap: 11px; width: 100%; min-height: 44px;
  padding: 7px 10px; border: 0; border-radius: 9px;
  background: transparent; color: var(--tl-ink); font: inherit; text-align: left; cursor: pointer;
}
.tl-cam-item:hover, .tl-cam-item:focus-visible { background: rgba(255,255,255,0.08); outline: none; }
.tl-cam-item:focus-visible { box-shadow: inset 0 0 0 2px var(--tl-club); }
.tl-cam-item > .tl-icon:first-child { flex: none; color: var(--tl-ink-2); }
.tl-cam-item.on > .tl-icon:first-child { color: var(--tl-club); }
.tl-cam-item .txt { display: grid; gap: 2px; flex: 1; min-width: 0; }
.tl-cam-item b { font: 680 13px/1.2 var(--tl-font); }
.tl-cam-item small { font: 500 11px/1.3 var(--tl-font); color: var(--tl-ink-3); }
.tl-cam-item.on b { color: #fff; }
.tl-cam-item > .tl-icon:last-child:not(:first-child) { color: var(--tl-club); flex: none; }

/* The camera's name, for a moment, when it changes. */
.tl-cam-toast {
  position: absolute; left: 50%; top: 28%; z-index: 6; pointer-events: none;
  display: flex; align-items: center; gap: 9px;
  padding: 10px 16px; border-radius: 99px;
  background: rgba(4,16,10,0.74); border: 1px solid rgba(255,255,255,0.16);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--tl-sh-2);
  font: 720 14px/1 var(--tl-font); letter-spacing: 0.01em;
  translate: -50% 0;
  animation: tl-cam-toast 1.6s var(--tl-ease) both;
}
@keyframes tl-cam-toast {
  0% { opacity: 0; transform: translateY(6px) scale(0.96); }
  14% { opacity: 1; transform: none; }
  78% { opacity: 1; }
  100% { opacity: 0; }
}

/* Paused: said in the middle of the picture, where the eyes already are, and pressable. A
   pause shown only as a changed icon in a corner is one a kid thinks is a frozen game. */
.tl-paused {
  position: absolute; left: 50%; top: 50%; z-index: 5;
  display: none; flex-direction: column; align-items: center; gap: 6px;
  padding: 18px 26px 14px; border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(4,16,10,0.7);
  backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: var(--tl-sh-3);
  color: var(--tl-ink); font: 800 18px/1 var(--tl-font); letter-spacing: 0.02em; cursor: pointer;
  translate: -50% -50%;
}
.tl-paused > .tl-icon {
  width: 30px; height: 30px; padding: 12px; box-sizing: content-box; border-radius: 99px;
  background: var(--tl-club); color: var(--tl-club-ink); margin-bottom: 4px;
}
.tl-paused small { font: 600 11.5px/1 var(--tl-font); color: var(--tl-ink-2); letter-spacing: 0.02em; }
.tl-paused:hover > .tl-icon { transform: scale(1.06); }
.tl-paused:focus-visible { outline: 2px solid var(--tl-club); outline-offset: 3px; }
.tl-canvas-holder.tl-is-paused .tl-paused { display: flex; animation: tl-pop var(--tl-open) var(--tl-ease) both; }
/* A plain translucent layer rather than a CSS filter on the canvas: a filter on a live
   WebGL canvas is an extra full-screen compositing pass on every frame. */
.tl-canvas-holder.tl-is-paused::before {
  content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: rgba(2,10,6,0.34);
}

/* Who has the ball, as a broadcast caption: their colour, their number, their name. */
.tl-onball {
  position: absolute; left: 50%; bottom: calc(104px + env(safe-area-inset-bottom, 0px)); z-index: 4;
  display: flex; align-items: stretch; overflow: hidden; pointer-events: none;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.14);
  background: rgba(4,16,10,0.72);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  box-shadow: var(--tl-sh-2);
  font: 700 13px/1 var(--tl-font);
  translate: -50% 0; opacity: 0; transform: translateY(6px);
  transition: opacity 220ms var(--tl-ease), transform 220ms var(--tl-ease);
}
.tl-onball.on { opacity: 1; transform: none; }
.tl-onball .kit { width: 5px; flex: none; }
.tl-onball .no {
  padding: 7px 8px 7px 9px; font-weight: 800; font-variant-numeric: tabular-nums;
  background: rgba(255,255,255,0.08);
}
.tl-onball .nm { padding: 7px 12px 7px 9px; white-space: nowrap; letter-spacing: 0.02em; }
.tl-onball.mine .nm { color: #fff; }
.tl-onball:not(.mine) .nm { color: var(--tl-ink-2); }
/* Under 620px the ticker owns the bottom-left and reaches the middle; the caption would
   sit on it, and the ticker says more. */
@media (max-width: 619px) { .tl-onball { display: none; } }
@media (max-aspect-ratio: 4 / 5) { .tl-onball { bottom: calc(112px + env(safe-area-inset-bottom, 0px)); } }

.tl-hud-btns { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.tl-hud .tl-btn {
  background: rgba(4,16,10,0.58); border-color: rgba(255,255,255,0.18);
  backdrop-filter: blur(12px) saturate(1.3);
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
  color: var(--tl-ink);
}
.tl-hud .tl-btn:hover:not(:disabled) { background: rgba(10,30,20,0.78); }
.tl-hud .tl-btn[aria-pressed="true"] { background: var(--tl-club); color: var(--tl-club-ink); }

/* Momentum. Which way the match is going — the sound-independent channel design §D asks
   for — as a bar under the scoreboard: home half left, away half right, filling from the
   centre notch toward whoever is on top, in their colour. */
.tl-momentum {
  position: relative; height: 4px; margin: 0 6px; border-radius: 99px; overflow: hidden;
  background: rgba(255,255,255,0.16); box-shadow: 0 1px 3px rgba(0,0,0,0.5); pointer-events: none;
}
.tl-momentum::after {
  content: ""; position: absolute; left: 50%; top: -1px; bottom: -1px; width: 2px;
  translate: -50% 0; background: rgba(255,255,255,0.55);
}
.tl-momentum i {
  position: absolute; top: 0; bottom: 0; left: 50%; right: 50%;
  background: var(--home);
  transition: left 600ms var(--tl-ease), right 600ms var(--tl-ease);
}

/* The eleven along the bottom. Horizontally scrollable rather than shrunk, because a
   chip below the thumb target is not a control (design §10). */
.tl-strip {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 4;
  display: flex; gap: 7px;
  padding: 30px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  overflow-x: auto; overscroll-behavior-x: contain;
  background: linear-gradient(0deg, rgba(4,16,10,0.8) 0%, rgba(4,16,10,0.42) 56%, transparent 100%);
  scrollbar-width: none;
}
@media (max-aspect-ratio: 4 / 5) {
  .tl-strip { padding-top: 12px; background: rgba(4,16,10,0.86); }
  .tl-hud { background: rgba(4,16,10,0.86); }
}
.tl-strip::-webkit-scrollbar { display: none; }
.tl-chip {
  flex: 0 0 auto; width: 62px; min-height: 62px;
  display: grid; gap: 5px; justify-items: center; align-content: center;
  padding: 8px 5px 7px;
  border-radius: 11px; border: 1px solid rgba(255,255,255,0.16);
  background: rgba(6,22,14,0.72);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  color: var(--tl-ink); font: inherit; cursor: pointer;
  transition: transform var(--tl-fast) var(--tl-ease), border-color var(--tl-fast) var(--tl-ease), background var(--tl-fast) var(--tl-ease);
}
.tl-chip:hover { transform: translateY(-2px); background: rgba(12,36,24,0.86); }
.tl-chip .no {
  font: 800 15px/1 var(--tl-font); font-variant-numeric: tabular-nums;
  color: var(--chip-ink, #fff);
  width: 26px; height: 26px; border-radius: 7px;
  display: grid; place-items: center;
  background: var(--chip-kit, var(--tl-club));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);
}
.tl-chip .nm {
  font: 640 9.5px/1.35 var(--tl-font); letter-spacing: 0.01em;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--tl-ink-2);
}
.tl-chip .tl-bar { height: 4px; width: 100%; min-width: 0; }
/* Tired: a ring AND a pulse. The ring alone is a colour cue, and this is the first
   decision the game ever asks a player to make (design §3). */
.tl-chip.tired { border-color: var(--tl-weak); }
.tl-chip.tired .no { animation: tl-pulse 1.5s var(--tl-ease) infinite; }
@keyframes tl-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
.tl-chip.gk .no { box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 2px rgba(255,255,255,0.5); }
/* On the ball: lifted and lit, so the strip follows the play. Not a colour alone — it
   also rises, for anyone who cannot tell the club colour from the tired orange. */
.tl-chip { position: relative; }
.tl-chip.on-ball { transform: translateY(-4px); border-color: #fff; background: rgba(14,44,28,0.92); box-shadow: 0 0 0 1px #fff, var(--tl-sh-2); }
.tl-chip.on-ball::before {
  content: ""; position: absolute; top: -9px; left: 50%; width: 8px; height: 8px; translate: -50% 0;
  border-radius: 99px; background: #fff; box-shadow: 0 0 10px rgba(255,255,255,0.8);
}
/* Booked: a yellow card in the corner, because the second one sends him off and that is
   worth knowing before deciding who to take off. */
.tl-chip.booked::after {
  content: ""; position: absolute; top: 5px; right: 6px; width: 7px; height: 10px;
  border-radius: 1.5px; background: #f2cf2e; box-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

/* The tactics drawer. Off screen until asked for — it used to be a permanently open
   panel covering the top-right quarter of the football. */
.tl-drawer {
  position: absolute; z-index: 5; right: 12px; top: 84px; width: 264px; max-width: calc(100vw - 24px);
  display: grid; gap: 14px;
  padding: 16px;
  border-radius: var(--tl-r-lg); border: 1px solid rgba(255,255,255,0.18);
  background: rgba(6,22,14,0.8);
  backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
  box-shadow: var(--tl-sh-3);
  transform-origin: top right;
  animation: tl-pop var(--tl-slow) var(--tl-ease) both;
}
@keyframes tl-pop {
  from { opacity: 0; transform: translateY(-8px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
@media (max-width: 559px) {
  .tl-drawer {
    right: 8px; left: 8px; width: auto; top: auto;
    bottom: calc(96px + env(safe-area-inset-bottom, 0px));
    transform-origin: bottom center;
  }
}

/* A goal. The full-screen colour wash design §D promises, in the scorer's colours. */
.tl-flash {
  position: absolute; inset: 0; z-index: 6; pointer-events: none;
  display: grid; place-items: center;
  animation: tl-flash 2.1s var(--tl-ease) both;
}
.tl-flash .word {
  font: 800 clamp(44px, 13vw, 118px)/0.9 var(--tl-font);
  letter-spacing: -0.05em; text-transform: uppercase;
  color: #fff; text-shadow: 0 6px 40px rgba(0,0,0,0.6);
  animation: tl-flash-word 2.1s var(--tl-ease) both;
}
@keyframes tl-flash {
  0% { background: var(--flash, #fff); opacity: 0; }
  8% { opacity: 0.9; }
  40% { opacity: 0.5; }
  100% { background: var(--flash, #fff); opacity: 0; }
}
@keyframes tl-flash-word {
  0% { opacity: 0; transform: scale(0.7); }
  12% { opacity: 1; transform: scale(1.04); }
  22% { transform: scale(1); }
  76% { opacity: 1; }
  100% { opacity: 0; transform: scale(1.06); }
}

/* The ticker: what just happened, on the pitch, in three words. */
/* --- the minimap: the match as a diagram, bottom right ------------------------- */
.tl-minimap {
  position: absolute; right: 12px; bottom: calc(96px + env(safe-area-inset-bottom, 0px));
  z-index: 4; pointer-events: none;
  padding: 5px; border-radius: 11px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(4,16,10,0.62);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  box-shadow: var(--tl-sh-2);
  animation: tl-tick-in 340ms var(--tl-ease) both;
}
.tl-minimap canvas { display: block; border-radius: 7px; }
/* Inside the tactics drawer it is part of the panel, not floating over the pitch: the
   point of it there is watching the shape move while a slider is being dragged. */
.tl-minimap.tl-minimap-inline {
  position: static; padding: 0; border: 0; background: none;
  backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none;
  animation: none; justify-self: center;
}
.tl-minimap.tl-minimap-inline canvas {
  border: 1px solid rgba(255,255,255,0.14);
}
/* On a short screen the drawer reaches the bottom right corner, and a diagram half under
   a slider panel is worse than no diagram. The drawer carries its own copy anyway. */
@media (max-height: 560px) {
  .tl-canvas-holder.tl-drawer-open .tl-minimap:not(.tl-minimap-inline) { display: none; }
}
@media (max-aspect-ratio: 4 / 5) {
  .tl-minimap:not(.tl-minimap-inline) { bottom: calc(104px + env(safe-area-inset-bottom, 0px)); }
}
/* --- the match log: everything said, scrollable ------------------------------- */
.tl-log {
  display: grid; gap: 6px; max-height: min(52vh, 420px);
  overflow-y: auto; overscroll-behavior: contain;
  padding-right: 4px;
}
.tl-log .tl-tick { animation: none; }
.tl-log .tl-tick.mine { border-color: var(--tl-club, rgba(255,255,255,0.3)); }
.tl-log .tl-tick.goal { background: rgba(60,190,120,0.16); }
.tl-log .tl-tick.card { background: rgba(232,196,60,0.14); }

/* --- the main menu: the front door ------------------------------------------- */
/* A TITLE SCREEN, not a settings page. Before this it was a heading and a card of rows, and
   the first thing a kid saw of a football game was something that looked like a form. What
   makes it read as a game is a handful of deliberate moves and nothing else: a wordmark with
   weight and an extrusion, a ribbon, floodlight beams, and save slots drawn as chunky cards
   with a press-down lip — the vocabulary of every console menu a kid has ever used.
   All of it is CSS over the existing markup: no font files, no images (design section 9). */
.tl-menu { max-width: 940px; gap: 22px; padding-bottom: 28px; }
.tl-menu-hero {
  position: relative; display: grid; justify-items: center; text-align: center;
  padding: 34px 0 6px;
}
/* Two floodlight cones from the top corners, crossing over the wordmark. They live in the
   fixed backdrop (app.ts adds them on the menu only), so they are lit from the stadium. */
.tl-menu-beams { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.tl-menu-beams::before, .tl-menu-beams::after {
  content: ''; position: absolute; top: -8vh; width: 70vw; height: 125vh;
  /* A soft cone from a point at the top: a conic gradient has no hard edge to blur, where a
     clipped polygon kept its edges however much filter was put on it. */
  background: conic-gradient(from 180deg at 50% 0,
    transparent 166deg, color-mix(in srgb, var(--tl-club) 35%, white) 180deg, transparent 194deg);
  -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 80%);
  mask-image: linear-gradient(180deg, #000 0%, transparent 80%);
  opacity: 0.14; transform-origin: 50% 0;
  animation: tl-beam 9s ease-in-out infinite alternate;
}
.tl-menu-beams::before { left: -20vw; --tl-beam-a: -26deg; transform: rotate(-26deg); }
.tl-menu-beams::after  { right: -20vw; --tl-beam-a: 20deg; transform: rotate(26deg); animation-delay: -4.5s; }
@keyframes tl-beam {
  from { transform: rotate(var(--tl-beam-a)); opacity: 0.11; }
  to   { transform: rotate(calc(var(--tl-beam-a) + 6deg)); opacity: 0.18; }
}

.tl-menu-emblem {
  display: grid; place-items: center;
  width: 84px; height: 84px; margin-bottom: 12px; border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--tl-club) 60%, white), var(--tl-club) 58%, color-mix(in srgb, var(--tl-club) 55%, black));
  box-shadow:
    0 0 0 4px rgba(255,255,255,0.9), 0 0 0 8px color-mix(in srgb, var(--tl-club) 55%, black),
    0 10px 30px rgba(0,0,0,0.5), 0 0 60px color-mix(in srgb, var(--tl-club) 55%, transparent);
}
.tl-menu-ball { width: 62px; height: 62px; filter: drop-shadow(0 3px 3px rgba(0,0,0,0.35)); animation: tl-spin 14s linear infinite; }
@keyframes tl-spin { to { transform: rotate(360deg); } }

.tl-menu-title {
  margin: 0; padding: 0 0.12em;
  font: italic 900 clamp(46px, 13vw, 96px)/0.95 var(--tl-font);
  letter-spacing: -0.02em; text-transform: uppercase;
  color: #fff;
  transform: skewX(-6deg);
  /* The extrusion: stacked hard shadows in a dark club shade, then one soft one for lift. */
  text-shadow:
    0 2px 0 color-mix(in srgb, var(--tl-club) 70%, black),
    0 4px 0 color-mix(in srgb, var(--tl-club) 58%, black),
    0 6px 0 color-mix(in srgb, var(--tl-club) 46%, black),
    0 8px 0 color-mix(in srgb, var(--tl-club) 34%, black),
    0 14px 24px rgba(0,0,0,0.55);
  -webkit-text-stroke: 1px rgba(255,255,255,0.35);
}
/* The tagline as a ribbon: a slanted club-coloured band with notched ends. */
.tl-menu-tagline {
  margin: 18px 0 0; padding: 9px 30px;
  font: 800 clamp(12px, 3.3vw, 15px)/1.25 var(--tl-font);
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--tl-club-ink);
  background: linear-gradient(180deg, color-mix(in srgb, var(--tl-club) 80%, white), var(--tl-club));
  clip-path: polygon(0 0, 100% 0, calc(100% - 12px) 50%, 100% 100%, 0 100%, 12px 50%);
  filter: drop-shadow(0 4px 0 color-mix(in srgb, var(--tl-club) 45%, black));
  max-width: min(100%, 520px);
  text-wrap: balance;
}
@media (max-width: 519px) {
  .tl-menu-hero { padding-top: 18px; }
  .tl-menu-emblem { width: 68px; height: 68px; }
  .tl-menu-ball { width: 50px; height: 50px; }
  .tl-menu-tagline { letter-spacing: 0.03em; padding: 8px 24px; }
}
.tl-menu-tagline:empty, .tl-menu-title:empty { display: none; }

/* The big button. A lip under it that it presses down into, a shine that crosses it now
   and then, and the club badge on its face. */
.tl-btn.tl-primary.tl-menu-continue {
  position: relative; overflow: hidden;
  justify-self: center; width: min(100%, 460px);
  min-height: 76px; padding: 10px 26px; gap: 14px;
  border-radius: 18px; border-width: 2px;
  font: italic 900 26px/1 var(--tl-font); letter-spacing: 0.02em; text-transform: uppercase;
  box-shadow:
    inset 0 2px 0 rgba(255,255,255,0.45),
    0 6px 0 color-mix(in srgb, var(--tl-club) 45%, black),
    0 14px 30px rgba(0,0,0,0.45),
    0 0 44px color-mix(in srgb, var(--tl-club) 40%, transparent);
  flex-wrap: wrap; row-gap: 2px;
}
.tl-btn.tl-menu-continue .tl-crest { flex: 0 0 auto; }
.tl-btn.tl-menu-continue > .tl-icon { width: 26px; height: 26px; }
.tl-menu-continue-club {
  flex-basis: 100%; order: 9; margin-top: 2px;
  font: 700 12px/1.5 var(--tl-font); font-style: normal; letter-spacing: 0.1em;
  opacity: 0.72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* With a badge the club name sits under the word rather than wrapping below the badge. */
.tl-btn.tl-menu-continue:has(.tl-crest) {
  display: grid; grid-template-columns: auto auto 1fr; justify-items: start; text-align: left;
}
.tl-btn.tl-menu-continue:has(.tl-crest) .tl-crest { grid-row: 1 / 3; }
.tl-btn.tl-menu-continue:has(.tl-crest) > .tl-icon { grid-row: 1 / 3; }
.tl-btn.tl-menu-continue:has(.tl-crest) > span { align-self: end; }
.tl-btn.tl-menu-continue:has(.tl-crest) .tl-menu-continue-club { grid-column: 3; align-self: start; margin: 0; }
.tl-btn.tl-menu-continue::after {
  content: ''; position: absolute; inset: -10% auto -10% -40%; width: 30%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent);
  transform: skewX(-20deg);
  animation: tl-shine 4.2s ease-in-out 1.2s infinite;
  pointer-events: none;
}
@keyframes tl-shine { 0% { left: -40%; } 38%, 100% { left: 130%; } }

/* Every chunky button on the front door presses into its lip. */
.tl-btn.tl-menu-continue:active:not(:disabled),
.tl-slot .tl-slot-go:active:not(:disabled) {
  transform: translateY(5px);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.3), 0 1px 0 color-mix(in srgb, var(--tl-club) 45%, black);
}

.tl-menu-careers { display: grid; gap: 12px; }
.tl-menu-section {
  display: flex; align-items: center; gap: 10px; margin: 0;
  font: 800 12px/1 var(--tl-font); letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--tl-ink-2);
}
.tl-menu-section::before, .tl-menu-section::after {
  content: ''; flex: 1 1 auto; height: 2px; border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--tl-line-strong));
}
.tl-menu-section::after { background: linear-gradient(90deg, var(--tl-line-strong), transparent); }
.tl-menu-section .tl-icon { color: var(--tl-club); }

/* The save cards. Three across once there is room; a compact badge-beside-name card on a
   phone, where three tall cards would push the third below the fold. */
.tl-slots { display: grid; gap: 14px; grid-template-columns: 1fr; }
.tl-slot {
  position: relative; isolation: isolate;
  display: grid; align-items: center; gap: 4px 14px;
  grid-template-columns: 64px minmax(0, 1fr);
  grid-template-areas: "art who" "end end";
  padding: 16px; border-radius: 20px;
  border: 2px solid var(--tl-line-strong);
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,0.028) 0 28px, transparent 28px 56px),
    linear-gradient(180deg, #17402a, #0d2819);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 6px 0 #071a10, 0 16px 30px rgba(0,0,0,0.4);
  transition: transform var(--tl-fast) var(--tl-ease), border-color var(--tl-fast) var(--tl-ease), box-shadow var(--tl-fast) var(--tl-ease);
}
/* The club's own stripe across the top of a filled card, like the kit stripe on the topbar. */
.tl-slot.filled {
  border-color: color-mix(in srgb, var(--tl-club) 55%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--tl-club) 22%, transparent), transparent 55%),
    repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 28px, transparent 28px 56px),
    linear-gradient(180deg, #17402a, #0d2819);
}
.tl-slot:not(.filled):not(.unreadable) { border-style: dashed; }
.tl-slot:hover, .tl-slot:focus-within {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--tl-club) 80%, white);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 9px 0 #071a10, 0 22px 40px rgba(0,0,0,0.45),
    0 0 34px color-mix(in srgb, var(--tl-club) 30%, transparent);
}
.tl-slot .rk {
  position: absolute; top: -11px; left: 16px; z-index: 1;
  display: grid; place-items: center; min-width: 30px; height: 24px; padding: 0 8px;
  border-radius: 8px; border: 2px solid #071a10;
  background: var(--tl-raised); color: var(--tl-ink-2);
  font: italic 900 13px/1 var(--tl-font); font-variant-numeric: tabular-nums;
}
.tl-slot.filled .rk { background: var(--tl-club); color: var(--tl-club-ink); }
.tl-slot-art { grid-area: art; display: grid; place-items: center; width: 64px; height: 64px; }
.tl-slot-art .tl-crest { filter: drop-shadow(0 4px 6px rgba(0,0,0,0.45)); }
.tl-slot-plus {
  display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%;
  border: 2px dashed var(--tl-line-strong); color: var(--tl-ink-3);
  background: rgba(255,255,255,0.03);
}
.tl-slot:hover .tl-slot-plus, .tl-slot:focus-within .tl-slot-plus { color: var(--tl-club); border-color: var(--tl-club); }
.tl-slot .who { grid-area: who; display: grid; gap: 4px; min-width: 0; }
.tl-slot .who b {
  font: italic 900 19px/1.35 var(--tl-font); text-transform: uppercase; letter-spacing: 0.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tl-slot .who .meta { color: var(--tl-ink-2); font-size: 13px; line-height: 1.35; }
.tl-slot .end { grid-area: end; display: flex; margin-top: 10px; }
.tl-slot .end:empty { display: none; }
.tl-slot .tl-slot-go {
  flex: 1 1 auto; min-height: var(--tl-tap);
  font: italic 900 16px/1 var(--tl-font); text-transform: uppercase; letter-spacing: 0.03em;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 5px 0 #06140c;
}
.tl-slot .tl-slot-go.tl-primary {
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), 0 5px 0 color-mix(in srgb, var(--tl-club) 45%, black);
}
.tl-slot .tl-slot-delete {
  position: absolute; top: 4px; right: 4px;
  border-radius: 14px;
  color: var(--tl-ink-3); border-color: transparent;
}
.tl-slot .tl-slot-delete:hover { color: #ff9c9c; }
.tl-slot.filled .who { padding-right: 44px; }

@media (min-width: 720px) {
  .tl-slots { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
  .tl-slot {
    grid-template-columns: 1fr; grid-template-areas: "art" "who" "end";
    justify-items: center; text-align: center; padding: 26px 18px 18px; gap: 10px;
  }
  .tl-slot-art { width: 88px; height: 88px; }
  .tl-slot-art .tl-crest { width: 88px; height: 88px; }
  .tl-slot-plus { width: 80px; height: 80px; }
  .tl-slot .who { justify-items: center; }
  .tl-slot.filled .who { padding-right: 0; }
  .tl-slot .end { align-self: end; width: 100%; }
}

/* Destructive, and it must not look like the primary action anywhere it appears. */
.tl-btn.tl-danger { color: #ff9c9c; border-color: rgba(255,120,120,0.4); }
.tl-btn.tl-danger:hover { background: rgba(255,90,90,0.14); border-color: rgba(255,120,120,0.7); }

/* --- the inheritance intro ---------------------------------------------------- */
.tl-intro { display: grid; justify-items: center; padding: 18px 0 40px; }
.tl-intro-card {
  width: min(560px, 100%); display: grid; gap: 16px;
  padding: 22px; border-radius: var(--tl-r-lg);
  border: 1px solid var(--tl-line); background: var(--tl-surface);
  box-shadow: var(--tl-sh-2);
}
.tl-intro-wide { width: 100%; display: grid; gap: 18px; }
.tl-intro-head h2 { margin: 0 0 6px; font: 800 26px/1.1 var(--tl-font); letter-spacing: -0.03em; }
.tl-intro-foot { display: flex; align-items: center; gap: 10px; }
.tl-intro-dots { display: flex; gap: 7px; justify-content: center; }
.tl-intro-dots i {
  width: 7px; height: 7px; border-radius: 99px; background: rgba(255,255,255,0.2);
  transition: background var(--tl-fast) var(--tl-ease);
}
.tl-intro-dots i.on { background: var(--tl-club, #fff); }

/* The letter. Warm paper against the game's cold green, so it reads as a thing that
   arrived rather than as another panel. */
.tl-letter {
  position: relative; padding: 26px 24px 22px; border-radius: 12px;
  background: linear-gradient(170deg, #f6efdf 0%, #e9dfc9 100%);
  color: #2a2216; box-shadow: inset 0 0 40px rgba(120,96,52,0.18);
}
.tl-letter h2 { margin: 0 0 10px; font: 800 22px/1.15 var(--tl-font); letter-spacing: -0.02em; }
.tl-letter p { margin: 0; font: 500 15px/1.55 var(--tl-font); color: #4a3d29; }
.tl-letter-stamp {
  position: absolute; top: 14px; right: 14px;
  width: 38px; height: 38px; display: grid; place-items: center;
  border-radius: 8px; border: 2px dashed rgba(120,96,52,0.45); color: #8a6f42;
}

.tl-identity-fields { display: grid; gap: 10px; }
.tl-field { display: grid; gap: 6px; font: 700 12px/1 var(--tl-font); }
.tl-field > span { text-transform: uppercase; letter-spacing: 0.08em; color: var(--tl-ink-3); }
.tl-input {
  min-height: var(--tl-tap); padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--tl-line); background: rgba(255,255,255,0.05);
  color: var(--tl-ink); font: 600 16px/1 var(--tl-font);
}
.tl-input:focus-visible { outline: 2px solid var(--tl-club, #fff); outline-offset: 2px; }
.tl-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.tl-swatch {
  width: var(--tl-tap); height: var(--tl-tap); border-radius: 9px; cursor: pointer;
  border: 2px solid rgba(255,255,255,0.22);
}
.tl-swatch.on { border-color: #fff; transform: scale(1.08); }
.tl-hint {
  font: 500 11.5px/1.35 var(--tl-font); text-transform: none;
  letter-spacing: 0; color: var(--tl-ink-3);
}
/* The contract, and the pen. The signature is one path whose dash offset runs to zero,
   which is the cheapest honest way to draw a line as if it were being written. */
.tl-contract {
  position: relative; padding: 18px 14px 8px; border-radius: 10px;
  background: linear-gradient(170deg, #fbf7ec 0%, #efe7d5 100%);
  box-shadow: var(--tl-sh-2);
}
.tl-contract-lines { display: block; width: 100%; height: auto; }
.tl-contract-lines rect { fill: rgba(90,74,48,0.22); }
.tl-signature {
  position: absolute; left: 0; right: 0; bottom: -10px; width: 100%; height: auto;
  pointer-events: none;
}
/* The signature line and its cross, printed on the paper rather than written on it — so the
   blank cream area under the terms reads as somewhere a name goes, before anybody signs. */
.tl-signature .rule rect { fill: rgba(90,74,48,0.42); }
.tl-signature .rule path { fill: none; stroke: rgba(90,74,48,0.55); stroke-width: 1.6; stroke-linecap: round; }
/* The dash length is set from script, measured off the real curve — see intro.ts. */
.tl-signature .ink path {
  fill: none; stroke: #1b2a63; stroke-width: 3;
  stroke-linecap: round; stroke-linejoin: round;
}
.tl-contract-meta { display: flex; gap: 20px; flex-wrap: wrap; }
.tl-contract-field { display: grid; gap: 3px; }
.tl-contract-field .k {
  font: 700 10.5px/1 var(--tl-font); text-transform: uppercase;
  letter-spacing: 0.09em; color: var(--tl-ink-3);
}
.tl-contract-done { margin: 0; min-height: 20px; }
/* The letter arriving. Four beats, and the whole point is that they are four rather than
   one: the card lands and settles, the paper unfolds, the words appear, the stamp presses
   in. A single fade tells a kid that a panel appeared; this tells them something arrived.

   Driven entirely by animation-delay on nested elements rather than by a script, so it
   costs nothing and stops dead under calmed motion — every duration below runs through
   --tl-enter, which the two motion rules at the bottom of this file set to 1ms. */
.tl-intro-card, .tl-intro-wide {
  animation: tl-card-arrive var(--tl-enter) cubic-bezier(0.22, 1.4, 0.36, 1) both;
}
@keyframes tl-card-arrive {
  from { opacity: 0; transform: translateY(28px) scale(0.94) rotate(-1.4deg); }
  to { opacity: 1; transform: none; }
}
/* The paper unfolds from its own top edge, under the card's own entrance. */
.tl-letter {
  animation: tl-letter-open var(--tl-open) var(--tl-ease) both;
  animation-delay: var(--tl-enter);
  transform-origin: top center;
}
@keyframes tl-letter-open {
  from { clip-path: inset(0 0 92% 0); transform: scaleY(0.72); }
  to { clip-path: inset(0 0 0 0); transform: none; }
}
/* Then the words, heading first. Ink does not arrive all at once either. */
.tl-letter h2, .tl-letter p {
  animation: tl-letter-ink var(--tl-slow) var(--tl-ease) both;
}
.tl-letter h2 { animation-delay: calc(var(--tl-enter) + var(--tl-open) - 60ms); }
.tl-letter p { animation-delay: calc(var(--tl-enter) + var(--tl-open) + 30ms); }
@keyframes tl-letter-ink {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: none; }
}
/* And the stamp goes on last, pressed rather than faded. */
.tl-letter-stamp {
  animation: tl-stamp var(--tl-slow) cubic-bezier(0.3, 1.6, 0.5, 1) both;
  animation-delay: calc(var(--tl-enter) + var(--tl-open) + 180ms);
}
@keyframes tl-stamp {
  from { opacity: 0; transform: scale(1.55) rotate(-11deg); }
  to { opacity: 1; transform: none; }
}


.tl-ticker {
  position: absolute; left: 12px; bottom: calc(96px + env(safe-area-inset-bottom, 0px));
  z-index: 4; display: grid; gap: 5px; pointer-events: none; max-width: min(300px, 60vw);
}
.tl-tick {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 11px 7px 8px; border-radius: 9px;
  background: rgba(4,16,10,0.72);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.13);
  font: 620 12.5px/1.2 var(--tl-font);
  animation: tl-tick-in 340ms var(--tl-ease) both;
}
.tl-tick .min {
  font: 800 11px/1 var(--tl-font); font-variant-numeric: tabular-nums;
  padding: 4px 5px; border-radius: 5px; background: rgba(255,255,255,0.1); color: var(--tl-ink-2);
}
.tl-tick.goal { border-color: var(--tl-club); background: rgba(6,30,18,0.86); }
.tl-tick.goal .min { background: var(--tl-club); color: var(--tl-club-ink); }
@keyframes tl-tick-in { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }

/* ---- overlays and sheets ---------------------------------------------------------- */
/* A dialog on a wide screen; a bottom sheet on a phone, where a centred box with a
   dismissal target at the top is the wrong shape for a thumb. */
.tl-overlay {
  position: fixed; inset: 0; z-index: 40;
  display: grid; place-items: center; padding: 20px;
  background: rgba(2,10,6,0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: tl-fade 220ms var(--tl-ease) both;
}
@keyframes tl-fade { from { opacity: 0; } to { opacity: 1; } }
.tl-sheet {
  width: 100%; max-width: 560px; max-height: min(84vh, 720px);
  display: flex; flex-direction: column;
  background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015)), var(--tl-surface);
  border: 1px solid var(--tl-line); border-radius: var(--tl-r-lg);
  box-shadow: var(--tl-sh-3);
  animation: tl-rise var(--tl-slow) var(--tl-ease) both;
  overflow: hidden;
}
@keyframes tl-rise { from { opacity: 0; transform: translateY(18px) scale(0.98); } to { opacity: 1; transform: none; } }
.tl-sheet-head {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 16px 14px; border-bottom: 1px solid var(--tl-line);
}
.tl-sheet-head h2 { margin: 0; font: 700 17px/1.2 var(--tl-font); letter-spacing: -0.015em; }
.tl-sheet-body { padding: 16px; overflow-y: auto; }
.tl-sheet-foot { padding: 14px 16px calc(14px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--tl-line); display: flex; gap: 8px; }

@media (max-width: 559px) {
  .tl-overlay { place-items: end stretch; padding: 0; }
  .tl-sheet {
    max-width: none; max-height: 88vh;
    border-radius: var(--tl-r-lg) var(--tl-r-lg) 0 0; border-bottom: 0;
    animation-name: tl-sheet-up;
  }
  @keyframes tl-sheet-up { from { transform: translateY(100%); } to { transform: none; } }
}

/* ---- the onboarding coach --------------------------------------------------------- */
/* A hole punched over the real control, not a screenshot of it. Four dimmed panes around
   a live gap: the thing being pointed at stays clickable, which is the whole idea. */
.tl-coach { position: absolute; inset: 0; z-index: 30; pointer-events: none; }
.tl-coach .pane { position: absolute; background: rgba(2,10,6,0.68); pointer-events: auto; transition: all var(--tl-slow) var(--tl-ease); }
.tl-coach .ring {
  position: absolute; border-radius: 14px; pointer-events: none;
  box-shadow: 0 0 0 3px var(--tl-club), 0 0 0 10px color-mix(in srgb, var(--tl-club) 34%, transparent);
  transition: all var(--tl-slow) var(--tl-ease);
  animation: tl-ring 1.9s var(--tl-ease) infinite;
}
@keyframes tl-ring {
  0%, 100% { box-shadow: 0 0 0 3px var(--tl-club), 0 0 0 8px color-mix(in srgb, var(--tl-club) 30%, transparent); }
  50% { box-shadow: 0 0 0 3px var(--tl-club), 0 0 0 16px color-mix(in srgb, var(--tl-club) 4%, transparent); }
}
.tl-coach .bubble {
  position: absolute; z-index: 2; pointer-events: auto;
  width: min(300px, calc(100vw - 32px));
  display: grid; gap: 12px; padding: 16px;
  border-radius: var(--tl-r-lg); border: 1px solid var(--tl-line-strong);
  background: linear-gradient(180deg, rgba(24,58,38,0.98), rgba(12,38,24,0.98));
  box-shadow: var(--tl-sh-3);
  animation: tl-rise 340ms var(--tl-ease) both;
  transition: left var(--tl-slow) var(--tl-ease), top var(--tl-slow) var(--tl-ease);
}
.tl-coach .bubble p { margin: 0; font-size: 14.5px; line-height: 1.45; }
.tl-coach .bubble .foot { display: flex; align-items: center; gap: 8px; }
/* The arrow. Drawn, so it works with every string blanked — this whole flow has to
   survive ?blank=1 (design §11). */
.tl-coach .arrow {
  position: absolute; z-index: 1; pointer-events: none;
  color: var(--tl-club);
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
  animation: tl-nudge 1.4s var(--tl-ease) infinite;
}
@keyframes tl-nudge { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(var(--nx, 0), var(--ny, 6px)); } }
.tl-dots { display: flex; gap: 5px; }
.tl-dots i { width: 6px; height: 6px; border-radius: 99px; background: rgba(255,255,255,0.24); }
.tl-dots i.on { background: var(--tl-club); }

/* ---- toast ------------------------------------------------------------------------ */
.tl-toast-host {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  z-index: 50; display: grid; gap: 8px; justify-items: center; pointer-events: none;
  width: min(420px, calc(100vw - 32px));
}
@media (min-width: 1080px) { .tl-toast-host { bottom: 28px; } }
.tl-toast {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-radius: var(--tl-r);
  background: rgba(10,32,20,0.95); color: var(--tl-ink);
  border: 1px solid var(--tl-line-strong);
  box-shadow: var(--tl-sh-3);
  font: 620 14px/1.35 var(--tl-font);
  animation: tl-toast-in 320ms var(--tl-ease) both;
}
.tl-toast .tl-icon { color: var(--tl-club); }
@keyframes tl-toast-in { from { opacity: 0; transform: translateY(14px) scale(0.96); } to { opacity: 1; transform: none; } }

/* ---- entrance -------------------------------------------------------------------- */
/* One authored moment: the screen's cards arrive in reading order, once, on navigation.
   Not a scroll effect, not on every element, and it never runs twice for the same view. */
.tl-enter > * { animation: tl-in var(--tl-slow) var(--tl-ease) both; }
.tl-enter > *:nth-child(1) { animation-delay: 0ms; }
.tl-enter > *:nth-child(2) { animation-delay: 55ms; }
.tl-enter > *:nth-child(3) { animation-delay: 105ms; }
.tl-enter > *:nth-child(4) { animation-delay: 150ms; }
.tl-enter > *:nth-child(n+5) { animation-delay: 190ms; }
@keyframes tl-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* ---- responsive presentation switch ----------------------------------------------- */
/* Some data is genuinely a different composition at a different width, not the same one
   squeezed: a squad is a table on a laptop and a list of rows on a phone. Both are
   rendered and CSS picks one, which costs a few hundred hidden nodes and buys a layout
   that never has a horizontal scrollbar under a thumb. Columns that are merely optional
   (won / drawn / lost) are dropped from the single table instead. */
.tl-wide-only { display: none; }
@media (min-width: 720px) {
  .tl-wide-only { display: block; }
  .tl-narrow-only { display: none; }
}
@media (max-width: 599px) { .tl-table .c-opt { display: none; } }

/* ---- odds and ends ---------------------------------------------------------------- */
.tl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tl-stack { display: grid; gap: 14px; }
.tl-muted { color: var(--tl-ink-3); }
.tl-lede { color: var(--tl-ink-2); font-size: 14.5px; line-height: 1.55; max-width: 62ch; }
.tl-hidden { display: none !important; }
.tl-empty { padding: 30px 18px 34px; text-align: center; color: var(--tl-ink-3); display: grid; gap: 12px; justify-items: center; }
.tl-empty .tl-icon { color: var(--tl-ink-3); opacity: 0.55; }
.tl-empty .tl-art-empty { width: 152px; height: auto; opacity: 0.75; }
.tl-vs { display: flex; align-items: center; gap: 14px; justify-content: center; padding: 6px 0 14px; }
.tl-vs .t { display: grid; gap: 8px; justify-items: center; flex: 1 1 0; min-width: 0; }
.tl-vs .t b { font-weight: 700; font-size: 14px; letter-spacing: 0.04em; }
.tl-vs .mid { font: 700 12px/1 var(--tl-font); letter-spacing: 0.14em; text-transform: uppercase; color: var(--tl-ink-3); }
.tl-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* ---- illustration ------------------------------------------------------------------ */
/* A backdrop is behind everything and touchable by nothing. It is pinned to the BOTTOM of
   the viewport rather than stretched over it, because the drawing has a horizon and a
   horizon belongs where the eye expects one. */
.tl-backdrop {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
}
/* Width, and let the height follow the drawing.
   Sizing BOTH and letting preserveAspectRatio sort it out does not work here: a 4:1 box over
   a 2:1 drawing crops to the bottom half, which threw away the hill, the stands and all four
   floodlights and left a strip of grass nobody could identify. The overflow:hidden above is
   what trims the sky, and the mask inside the drawing fades it out before it gets there. */
.tl-backdrop .tl-art {
  position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: max(1500px, 108vw); height: auto;
  /* Loud enough to be a ground, quiet enough that nobody reads it instead of the cards. */
  opacity: 0.55;
}
/* Everything the player can touch sits above it. */
/* The fixed phone navigation belongs to the topbar stacking context. Keep it above
   main, or later cards cover the tabs even though the tabs themselves have z-index:6. */
.tl-root > .tl-topbar { position: relative; z-index: 3; }
.tl-root > .tl-main { position: relative; z-index: 1; }
.tl-art { display: block; }

/* The letter itself: picture beside the words above 560px, above them below it — a 168px
   drawing and a paragraph side by side on a phone is two columns of nothing. */
.tl-letter { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.tl-letter-art { flex: 0 0 auto; width: 168px; }
.tl-letter-art .tl-art { width: 100%; height: auto; }
.tl-letter-words { flex: 1 1 240px; min-width: 0; }
@media (max-width: 559px) {
  .tl-letter { flex-direction: column; align-items: flex-start; }
  .tl-letter-art { width: 132px; align-self: center; }
}

/* ---- tooltips ---------------------------------------------------------------------- */
/* A dozen controls in this game are an icon and nothing else — pause, camera, the tactics
   drawer, the match log, Back, the career delete. Each already carries an accessible name,
   which a screen reader reads and a sighted player never sees, so dom.ts mirrors that one
   string onto data-tip and this draws it.

   NOT the title attribute: it waits a second before appearing, cannot be styled to match
   anything, and does not exist on a touch screen at all. And only under hover: hover on a
   touch screen is sticky, so a tapped button would keep its tooltip until something else
   was tapped, which is worse than having none. */
@media (hover: hover) {
  [data-tip] { position: relative; }
  [data-tip]::after {
    content: attr(data-tip);
    position: absolute; left: 50%; bottom: calc(100% + 9px);
    transform: translateX(-50%) translateY(4px);
    padding: 5px 9px; border-radius: 8px; z-index: 60;
    background: rgba(4,16,10,0.95); color: var(--tl-ink);
    border: 1px solid rgba(255,255,255,0.16);
    box-shadow: var(--tl-sh-2);
    font: 650 11.5px/1.2 var(--tl-font); letter-spacing: 0.01em;
    white-space: nowrap; pointer-events: none; opacity: 0;
    transition: opacity var(--tl-fast) var(--tl-ease), transform var(--tl-fast) var(--tl-ease);
  }
  [data-tip]:hover::after,
  [data-tip]:focus-visible::after { opacity: 1; transform: translateX(-50%) translateY(0); }
  /* Anything in a top bar has no room above it, so those flip without being told to.
     The match HUD and the club chrome are both pinned to the top edge of the viewport. */
  .tl-hud [data-tip]::after,
  .tl-topbar [data-tip]::after,
  [data-tip-side="below"]::after {
    bottom: auto; top: calc(100% + 9px);
    transform: translateX(-50%) translateY(-4px);
  }
  .tl-hud [data-tip]:hover::after,
  .tl-hud [data-tip]:focus-visible::after,
  .tl-topbar [data-tip]:hover::after,
  .tl-topbar [data-tip]:focus-visible::after,
  [data-tip-side="below"]:hover::after,
  [data-tip-side="below"]:focus-visible::after { transform: translateX(-50%) translateY(0); }
}

/* Reduced motion calms everything decorative. It never calms anything that INFORMS —
   the bars keep their transition, because a bar that jumps has told you less than a bar
   that moved (design §D, the rule Starhaven set). */
/* ---- the game skin ------------------------------------------------------------- */
/* The front door was redrawn as a title screen, and next to it the rest of the game read
   as a web dashboard. This carries the same vocabulary everywhere, through the shared parts
   rather than per screen: heavy italic display type for things with a name, section labels
   with a club-coloured tab, buttons with a lip they press into, cards that sit on the ground
   rather than float over it. Placed after the component rules so it wins on order, and
   before the motion rules so those still win over it. */

/* Display type: italic, heavy, upright capitals. One family (the system face) — no font
   files, design section 9 — so the weight and the slant are doing all the work. */
.tl-intro-head h2, .tl-sheet-head h2, .tl-brand, .tl-club,
.tl-vs .t b, .tl-stat b, .tl-hero-name, .tl-studio-title, .tl-studio-caption b,
.tl-fac-head b, .tl-bug-cell b, .tl-kv > b, .tl-money-chip {
  font-style: italic; font-weight: 900;
}
.tl-hero-name, .tl-studio-title, .tl-fac-head b { text-transform: uppercase; letter-spacing: 0.005em; }
.tl-display {
  margin: 0 0 8px; font: italic 900 clamp(26px, 5vw, 38px)/1.05 var(--tl-font);
  text-transform: uppercase; letter-spacing: -0.005em;
}
.tl-shape { font-style: italic; font-weight: 900; letter-spacing: 0; }
.tl-intro-head h2 { font-size: clamp(24px, 6vw, 32px); text-transform: uppercase; letter-spacing: -0.005em; }
.tl-sheet-head h2 { font-size: 18px; text-transform: uppercase; letter-spacing: 0.01em; }
/* Capitals with accents (UNIÓN) need the taller line, or overflow:hidden shears the accent off. */
.tl-club { text-transform: uppercase; letter-spacing: 0.005em; line-height: 1.35; }

/* The wordmark in the topbar while there is no club yet: the menu title, small. */
.tl-brand {
  font-size: 21px; line-height: 1; text-transform: uppercase; letter-spacing: -0.01em;
  display: inline-block; transform: skewX(-6deg);
  text-shadow: 0 2px 0 color-mix(in srgb, var(--tl-club) 60%, black), 0 3px 0 color-mix(in srgb, var(--tl-club) 40%, black);
}

/* Section labels: brighter ink, a club-coloured glyph, and a rule that fades out. */
.tl-h { font-weight: 800; font-size: 11.5px; letter-spacing: 0.16em; color: var(--tl-ink-2); }
.tl-h .tl-icon { color: var(--tl-club); }
.tl-h::after { height: 2px; border-radius: 2px; background: linear-gradient(90deg, var(--tl-line-strong), transparent); }

/* Cards stand on the ground: a hard shadow under the bottom edge, as the save cards do. */
.tl-card, .tl-intro-card {
  border-width: 1.5px; border-color: var(--tl-line-strong);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 5px 0 rgba(3,13,8,0.85), var(--tl-sh-2);
}

/* Buttons press into a lip. Ghost buttons stay flat — they are the quiet option, and a
   lip is exactly the thing that makes a button look like the one to press. */
.tl-btn {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 4px 0 rgba(3,13,8,0.9);
}
.tl-btn.tl-primary {
  font-style: italic; font-weight: 900; text-transform: uppercase; letter-spacing: 0.03em;
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), 0 4px 0 color-mix(in srgb, var(--tl-club) 42%, black),
    0 8px 18px rgba(0,0,0,0.3);
}
.tl-btn.tl-ghost { box-shadow: none; }
.tl-btn:active:not(:disabled) { transform: translateY(4px); box-shadow: inset 0 1px 3px rgba(0,0,0,0.3); }
.tl-btn.tl-ghost:active:not(:disabled) { transform: translateY(1px); }
/* A chosen option in a segmented row is pressed in, and stays pressed. */
.tl-btn[aria-pressed="true"] {
  transform: translateY(2px);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.3), 0 2px 0 color-mix(in srgb, var(--tl-club) 42%, black);
  font-weight: 850;
}
.tl-btn:disabled { box-shadow: none; }

/* The big one: the button that starts the match. Taller, and it catches the light. */
.tl-btn.tl-kick {
  position: relative; overflow: hidden; min-height: 64px; font-size: 19px;
}
.tl-btn.tl-kick::after {
  content: ''; position: absolute; inset: -10% auto -10% -40%; width: 30%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.4), transparent);
  transform: skewX(-20deg); pointer-events: none;
  animation: tl-shine 4.6s ease-in-out 1.5s infinite;
}

/* Stats as a scoreboard: heavy italic figures, and labels that never break inside a word.
   overflow-wrap anywhere is what printed POSITIO / N on a phone; break-word only breaks a
   word that cannot fit on a line by itself. Two across on a phone rather than four crushed. */
.tl-stats { grid-template-columns: repeat(auto-fit, minmax(min(128px, 100%), 1fr)); gap: 6px; }
.tl-stat span { overflow-wrap: break-word; }
.tl-stat {
  border: 1px solid var(--tl-line-soft);
  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015));
}
.tl-stat b { font-size: 30px; letter-spacing: -0.02em; }
/* A sheet is narrow and its labels are one short word each: four across, a size down. */
.tl-sheet .tl-stats { grid-template-columns: repeat(auto-fit, minmax(min(76px, 100%), 1fr)); }
.tl-sheet .tl-stat { padding: 10px; }
.tl-sheet .tl-stat b { font-size: 24px; }
.tl-stat.hot { border-color: color-mix(in srgb, var(--tl-club) 45%, transparent);
  background: linear-gradient(180deg, var(--tl-club-soft), rgba(255,255,255,0.015)); }

/* The topbar's badge sits in a lit ring; the club name is set like a broadcast caption. */
.tl-top-id .tl-crest { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--tl-club) 50%, transparent)) drop-shadow(0 2px 2px rgba(0,0,0,0.5)); }

/* Navigation as game tabs. The phone bar marks the current tab with a lit bar above it;
   the desktop control fills the current tab and sets every label in italic capitals. */
.tl-tab { font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; position: relative; }
@media (min-width: 1080px) {
  .tl-tab { font-style: italic; font-size: 13px; }
  .tl-tab[aria-current="page"] { box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 3px 0 rgba(3,13,8,0.85); }
  .tl-tab[aria-current="page"] .tl-tab-ico { box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 3px 0 color-mix(in srgb, var(--tl-club) 42%, black); }
}

/* Matchday: the two clubs square up. Bigger badges on a lit strip of turf and the V in a
   roundel between them, which is how every football game has ever announced a fixture. */
.tl-vs {
  position: relative; isolation: isolate;
  padding: 18px 8px 20px; margin: -2px 0 14px; border-radius: 14px;
  background:
    radial-gradient(60% 90% at 50% 0%, color-mix(in srgb, var(--tl-club) 22%, transparent), transparent 70%),
    repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 34px, transparent 34px 68px),
    linear-gradient(180deg, #1b5634, #10331f);
  border: 1px solid var(--tl-line);
  box-shadow: inset 0 -30px 40px rgba(0,0,0,0.25);
}
.tl-vs .t b { font-size: 15px; text-transform: uppercase; letter-spacing: 0.01em; text-align: center; }
.tl-vs .t .tl-crest { width: 64px; height: 64px; filter: drop-shadow(0 6px 8px rgba(0,0,0,0.5)); }
.tl-vs .mid {
  display: grid; place-items: center; flex: 0 0 auto;
  width: 44px; height: 44px; border-radius: 50%;
  background: #fff; color: #0b2416;
  font: italic 900 17px/1 var(--tl-font); letter-spacing: 0; text-transform: uppercase;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tl-club) 60%, black), 0 6px 14px rgba(0,0,0,0.45);
}
.tl-vs .mid:empty { visibility: hidden; }

/* Sheets open with the club's kit stripe across their top edge. */
.tl-sheet { border-top: 3px solid var(--tl-club); }

/* The match scoreboard, heavier. The numbers are what a kid glances at mid-match. */
.tl-score .side { font-style: italic; font-weight: 900; }
.tl-score .goals { font-style: italic; font-weight: 900; font-size: 24px; }
.tl-clock { font-weight: 850; }

/* The club cards on the picker lift toward the pointer, like the save cards. */
.tl-club-card { transition: transform var(--tl-fast) var(--tl-ease), box-shadow var(--tl-fast) var(--tl-ease), border-color var(--tl-fast) var(--tl-ease); }

/* Two rules, one body, and they cannot be merged because a selector list is thrown away
   whole if any part of it fails to parse.

   The FIRST is the operating system's preference. The SECOND is the game's own Camera
   movement setting, which is set to Calm in Settings and until now reached the match camera
   and nothing else: settings.reducedMotion was read into Game and handed to the Intro and
   the MatchScreen, but never reached the document, so every CSS animation in the game
   carried on regardless of what the player had chosen. applyMotion in theme.ts is what
   writes the attribute.

   The OS preference is scoped to :not([data-motion="full"]) so that a player who explicitly
   asks for Full gets it. Choosing something has to win over inheriting something. */
/* ---- the club screen ----------------------------------------------------------------- */
/* A match column and a rail. The match column is wider because it is the reason the screen
   exists; the rail is what a manager glances at between matches. On a phone it is one
   column in the same order, so the next match is always first under the thumb. */
.tl-dash { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
.tl-dash-main, .tl-dash-rail { display: grid; gap: 14px; align-content: start; min-width: 0; }
@media (min-width: 940px) {
  .tl-dash { grid-template-columns: minmax(0, 1.55fr) minmax(290px, 1fr); align-items: start; }
}
.tl-card-foot { padding: 12px 18px 16px; }
.tl-btn.tl-card-link { margin-top: 12px; }

/* The next match. Both clubs' shirts meet in a band across the top and wash faintly into
   their own half of the card, so the fixture is legible before a word of it is read. */
.tl-hero {
  padding: 0 0 18px; overflow: hidden;
  background:
    radial-gradient(70% 110% at 0% 0%, color-mix(in srgb, var(--home) 20%, transparent), transparent 62%),
    radial-gradient(70% 110% at 100% 0%, color-mix(in srgb, var(--away) 20%, transparent), transparent 62%),
    linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.015)),
    var(--tl-surface);
}
.tl-hero::after {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 5px;
  background: linear-gradient(90deg, var(--home) 0 50%, var(--away) 50% 100%);
}
.tl-hero-top { display: flex; align-items: center; gap: 8px; padding: 20px 18px 0; flex-wrap: wrap; }
.tl-hero-top .tl-h { flex: 1 1 auto; margin: 0; }
.tl-hero-vs {
  display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: start; gap: 6px; margin: 16px 18px 0; padding: 20px 10px 18px;
  border-radius: 14px; border: 1px solid var(--tl-line);
  /* The turf strip the fixture has always stood on: mown bands and a light from above. */
  background:
    radial-gradient(60% 90% at 50% 0%, rgba(255,255,255,0.08), transparent 70%),
    repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 34px, transparent 34px 68px),
    linear-gradient(180deg, #1b5634, #10331f);
  box-shadow: inset 0 -30px 40px rgba(0,0,0,0.25);
}
.tl-hero-side:not(.mine) .tl-hero-name { color: var(--tl-ink); opacity: 0.86; }
.tl-hero-side { display: grid; justify-items: center; gap: 8px; text-align: center; min-width: 0; }
.tl-hero-side .tl-crest { filter: drop-shadow(0 6px 10px rgba(0,0,0,0.45)); }
.tl-hero-name { font: 760 17px/1.2 var(--tl-font); letter-spacing: -0.018em; overflow-wrap: anywhere; }
.tl-hero-side.mine .tl-hero-name { color: var(--tl-ink); }
.tl-hero-side:not(.mine) .tl-hero-name { color: var(--tl-ink-2); }
.tl-hero-meta {
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px;
  font: 700 12px/1 var(--tl-font); color: var(--tl-ink-3); font-variant-numeric: tabular-nums;
}
.tl-hero-v {
  align-self: center; margin-top: -34px;
  display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%;
  background: #fff; color: #0b2416;
  font: italic 900 17px/1 var(--tl-font); text-transform: uppercase;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tl-club) 60%, black), 0 6px 14px rgba(0,0,0,0.45);
}
.tl-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 18px 0; }
.tl-hero-actions .tl-kick { flex: 2 1 180px; min-height: 64px; font-size: 16.5px; }
.tl-hero-actions .tl-ghost { flex: 1 1 130px; min-height: 64px; }
.tl-hero-venue {
  display: flex; align-items: center; gap: 7px; margin: 12px 18px 0;
  font-size: 12.5px; color: var(--tl-ink-3);
}
.tl-hero-venue .tl-icon { flex: 0 0 auto; }
@media (max-width: 480px) {
  .tl-hero-vs .tl-crest { width: 60px; height: 60px; }
  .tl-hero-name { font-size: 15px; }
}

.tl-upcoming { display: grid; }
.tl-up-row {
  display: grid; grid-template-columns: 26px auto minmax(0, 1fr) auto; align-items: center; gap: 10px;
  min-height: 48px; padding: 6px 2px; border-bottom: 1px solid var(--tl-line-soft);
}
.tl-up-row:last-child { border-bottom: 0; }
.tl-up-round { font: 700 13px/1 var(--tl-font); color: var(--tl-ink-3); font-variant-numeric: tabular-nums; text-align: right; }
.tl-up-name { font-weight: 640; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tl-league-strip {
  display: flex; justify-content: space-between; align-items: center; gap: 10px 16px; flex-wrap: wrap;
  padding: 0 18px 12px; font-size: 13px; font-weight: 600; color: var(--tl-ink-2);
  font-variant-numeric: tabular-nums;
}
.tl-league-form { display: inline-flex; align-items: center; gap: 9px; }
.tl-league-form > span:first-child {
  font: 650 10.5px/1 var(--tl-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tl-ink-3);
}

.tl-clubcard { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; min-width: 0; }
.tl-clubcard-art {
  display: flex; align-items: flex-end; gap: 4px; flex: 0 0 auto;
  padding: 10px 12px; border-radius: 16px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--card-a) 34%, transparent), color-mix(in srgb, var(--card-b) 12%, transparent));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}
.tl-clubcard-art .tl-kit-art { width: 50px; height: 78px; display: block; filter: drop-shadow(0 3px 4px rgba(0,0,0,0.35)); }
.tl-clubcard-text { display: grid; gap: 4px; min-width: 0; }
.tl-clubcard-text b { font-size: 15.5px; font-weight: 720; overflow-wrap: anywhere; }
.tl-pill.tl-nudge { justify-self: start; margin-top: 4px; text-transform: none; letter-spacing: 0; font-size: 12px; }

.tl-kvs { display: grid; margin-bottom: 14px; }
.tl-kv {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 9px 0; border-bottom: 1px solid var(--tl-line-soft);
}
.tl-kv > span { font-size: 13px; color: var(--tl-ink-2); }
.tl-kv > b { font: 800 18px/1 var(--tl-font); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tl-kv > b.hot { color: var(--tl-club); }
.tl-boardroom { display: grid; gap: 9px; }
.tl-board-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; font-weight: 620; }

.tl-scorer { display: flex; align-items: center; gap: 12px; min-width: 0; }
.tl-scorer-num {
  flex: 0 0 auto; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 13px;
  font: 800 19px/1 var(--tl-font); font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -3px 0 rgba(0,0,0,0.22), var(--tl-sh-1);
}
.tl-scorer-who { display: grid; gap: 3px; min-width: 0; }
.tl-scorer-who b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-scorer-who .tl-muted { font-size: 12.5px; }

/* ---- the club studio ------------------------------------------------------------------ */
/* A stage and an editor. The stage is the whole identity at once — ground, badge, kit,
   ball — at dusk, the same evening every other illustration in the game happens on. */
.tl-card.tl-studio { padding: 0; overflow: hidden; }
.tl-studio-head {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px 18px; flex-wrap: wrap;
  padding: 20px 20px 16px;
}
.tl-studio-title { margin: 0 0 5px; font: 800 27px/1.08 var(--tl-font); letter-spacing: -0.03em; }
.tl-studio-head p { margin: 0; font-size: 13.5px; max-width: 54ch; text-wrap: pretty; }
.tl-money-chip {
  display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 9px 16px 9px 12px; border-radius: 99px;
  background: rgba(0,0,0,0.32); border: 1px solid var(--tl-line);
  font: 800 17px/1 var(--tl-font); letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
}
.tl-money-chip .tl-icon { color: var(--tl-club); }
.tl-studio-stage {
  position: relative; width: 100%;
  aspect-ratio: 320 / 140; max-height: 340px; min-height: 190px;
  overflow: hidden;
  /* The grass line sits where the drawing's own does whenever the stage is wider than the
     drawing, which is every desktop — so the two halves of the ground meet without a seam. */
  background:
    radial-gradient(55% 60% at 50% 22%, rgba(255,240,205,0.12), transparent 70%),
    linear-gradient(180deg, var(--art-sky-top) 0%, var(--art-sky-low) 80%, var(--art-grass) 80%);
  border-top: 1px solid var(--tl-line-soft);
}
.tl-studio-ground { position: absolute; inset: 0; }
.tl-studio-ground svg { display: block; width: 100%; height: 100%; }
.tl-stadium-name { font: italic 900 6.4px/1 var(--tl-font); letter-spacing: 0.5px; }
.tl-studio-figures {
  position: absolute; inset: 0;
  display: flex; align-items: flex-end; justify-content: space-between;
  padding: 0 clamp(20px, 17%, 260px) 6%;
}
/* Everything stands on the grass and stays below the roof line, where the ground's name is. */
.tl-studio-crest { align-self: flex-end; }
.tl-studio-crest .tl-crest { width: clamp(46px, 9vw, 84px); height: auto; filter: drop-shadow(0 8px 12px rgba(0,0,0,0.5)); }
.tl-studio-kit { height: 56%; }
.tl-studio-kit svg { display: block; height: 100%; width: auto; filter: drop-shadow(0 10px 14px rgba(0,0,0,0.5)); }
.tl-studio-ball { height: 22%; }
.tl-studio-ball { filter: drop-shadow(0 5px 5px rgba(0,0,0,0.5)); }
.tl-studio-caption {
  position: absolute; left: 18px; top: 14px; display: grid; gap: 3px; max-width: 45%;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6);
}
.tl-studio-caption b { font: 800 17px/1.15 var(--tl-font); letter-spacing: -0.02em; overflow-wrap: anywhere; }
.tl-studio-caption span { font-size: 12px; color: var(--tl-ink-2); }
@media (max-width: 599px) {
  .tl-studio-caption { display: none; }
}

.tl-studio-tabs {
  display: flex; gap: 4px; padding: 4px; margin-bottom: 20px;
  border-radius: 15px; background: rgba(0,0,0,0.3); border: 1px solid var(--tl-line);
}
.tl-studio-tab {
  flex: 1 1 0; min-width: 0;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: var(--tl-tap); padding: 0 12px;
  border: 0; border-radius: 11px; background: none; color: var(--tl-ink-2);
  font: 700 14px/1 var(--tl-font); cursor: pointer;
  transition: background var(--tl-fast) var(--tl-ease), color var(--tl-fast) var(--tl-ease);
}
.tl-studio-tab span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-studio-tab:hover { background: rgba(255,255,255,0.06); color: var(--tl-ink); }
.tl-studio-tab[aria-selected="true"] { background: var(--tl-club); color: var(--tl-club-ink); box-shadow: var(--tl-sh-1); }
@media (max-width: 639px) {
  .tl-studio-tab { flex-direction: column; gap: 5px; padding: 6px 2px; font-size: 11px; }
}
.tl-studio-cols { display: grid; gap: 24px; }
@media (min-width: 760px) { .tl-studio-cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; } }
.tl-studio-col { display: grid; gap: 18px; align-content: start; min-width: 0; }
.tl-studio-sub { margin: 0; font: 750 15px/1.2 var(--tl-font); letter-spacing: -0.01em; }
.tl-studio-note { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--tl-ink-3); max-width: 62ch; }

.tl-opt-row { display: flex; flex-wrap: wrap; gap: 6px; }
.tl-opt {
  display: inline-flex; align-items: center; gap: 9px;
  min-height: var(--tl-tap); padding: 0 15px 0 10px;
  border: 1px solid var(--tl-line); border-radius: 12px;
  background: rgba(255,255,255,0.04); color: var(--tl-ink-2);
  font: 650 13.5px/1 var(--tl-font); cursor: pointer;
  transition: background var(--tl-fast) var(--tl-ease), border-color var(--tl-fast) var(--tl-ease), color var(--tl-fast) var(--tl-ease);
}
.tl-opt:hover { background: rgba(255,255,255,0.08); color: var(--tl-ink); }
.tl-opt[aria-pressed="true"], .tl-ball-opt[aria-pressed="true"] {
  border-color: var(--tl-club); background: var(--tl-club-soft); color: var(--tl-ink);
  box-shadow: inset 0 0 0 1px var(--tl-club);
}
.tl-opt-dot {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: 7px;
  box-shadow: inset 0 0 0 1.5px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.4);
}

.tl-ball-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.tl-ball-opt {
  display: grid; justify-items: center; gap: 9px; padding: 16px 8px 13px;
  border: 1px solid var(--tl-line); border-radius: 15px;
  background: rgba(255,255,255,0.04); color: var(--tl-ink-2);
  font: 650 13px/1.2 var(--tl-font); cursor: pointer;
  transition: background var(--tl-fast) var(--tl-ease), border-color var(--tl-fast) var(--tl-ease);
}
.tl-ball-opt:hover { background: rgba(255,255,255,0.08); color: var(--tl-ink); }

.tl-rename { display: flex; gap: 8px; flex-wrap: wrap; }
.tl-rename .tl-input { flex: 1 1 200px; min-width: 0; }

.tl-fac-list { display: grid; gap: 10px; }
.tl-fac {
  display: grid; grid-template-columns: 54px minmax(0, 1fr) auto; align-items: center; gap: 14px 16px;
  padding: 14px 14px 14px 12px; border-radius: 17px;
  background: rgba(255,255,255,0.035); border: 1px solid var(--tl-line-soft);
}
.tl-fac-icon {
  display: grid; place-items: center; width: 54px; height: 54px; border-radius: 15px;
  background: var(--tl-club-soft); color: var(--tl-club);
}
.tl-fac.maxed .tl-fac-icon { background: color-mix(in srgb, var(--tl-good) 16%, transparent); color: var(--tl-good); }
.tl-fac-body { min-width: 0; }
.tl-fac-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tl-fac-head b { font: 750 15.5px/1.2 var(--tl-font); letter-spacing: -0.01em; }
.tl-fac-body p { margin: 4px 0 6px; font-size: 13px; line-height: 1.45; color: var(--tl-ink-2); max-width: 60ch; }
.tl-fac-level { font: 650 10.5px/1 var(--tl-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tl-ink-3); }
.tl-pips { display: inline-flex; gap: 4px; }
.tl-pips i { width: 20px; height: 7px; border-radius: 99px; background: rgba(255,255,255,0.12); }
.tl-pips i.on { background: var(--tl-club); box-shadow: 0 0 0 1px color-mix(in srgb, var(--tl-club) 55%, black); }
.tl-fac-action .tl-btn { white-space: nowrap; font-variant-numeric: tabular-nums; }
@media (max-width: 599px) {
  .tl-fac { grid-template-columns: 46px minmax(0, 1fr); }
  .tl-fac-icon { width: 46px; height: 46px; border-radius: 13px; }
  .tl-fac-action { grid-column: 1 / -1; }
  .tl-fac-action .tl-btn { width: 100%; }
}

/* ---- emblem layers ------------------------------------------------------------------- */
/* The badge preview is a canvas you can drag on while a layer is selected. */
.tl-crest-preview { min-height: 136px; border-radius: 16px; touch-action: none; }
.tl-crest-preview.draggable {
  cursor: grab;
  background:
    linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 17px 17px,
    linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 17px 17px;
  box-shadow: inset 0 0 0 1px var(--tl-line);
}
.tl-crest-preview.draggable:active { cursor: grabbing; }
.tl-layers { display: grid; gap: 18px; }
.tl-layer-top { display: grid; gap: 10px; }
.tl-layer-stack {
  display: flex; gap: 6px; overflow-x: auto; padding: 4px;
  border-radius: 14px; background: rgba(0,0,0,0.26); border: 1px solid var(--tl-line);
  min-height: 66px; align-items: center;
}
.tl-layer-stack:empty { display: none; }
.tl-layer-chip {
  flex: 0 0 auto; position: relative;
  display: grid; place-items: center; width: var(--tl-tap); height: var(--tl-tap);
  border: 1px solid var(--tl-line); border-radius: 11px;
  background: rgba(255,255,255,0.05); color: var(--tl-ink-2); cursor: pointer;
}
.tl-layer-chip span {
  position: absolute; right: 3px; bottom: 2px;
  font: 800 9.5px/1 var(--tl-font); color: var(--tl-ink-3); font-variant-numeric: tabular-nums;
}
.tl-layer-chip[aria-selected="true"] {
  border-color: var(--tl-club); background: var(--tl-club-soft);
  box-shadow: inset 0 0 0 1px var(--tl-club);
}
.tl-layer-tools { display: flex; gap: 6px; flex-wrap: wrap; }
.tl-layer-empty {
  margin: 0; padding: 22px 18px; border-radius: 14px; text-align: center;
  border: 1px dashed var(--tl-line-strong); color: var(--tl-ink-2); font-size: 13.5px; line-height: 1.5;
}
.tl-layer-edit { display: grid; gap: 18px; }
@media (min-width: 900px) { .tl-layer-edit { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 24px; } }
.tl-layer-controls { display: grid; gap: 14px; align-content: start; }
.tl-layer-flip { display: flex; }
.tl-glyph-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tl-tap), 1fr)); gap: 5px; }
.tl-glyph {
  display: grid; place-items: center; min-height: var(--tl-tap);
  border: 1px solid var(--tl-line-soft); border-radius: 10px;
  background: rgba(255,255,255,0.035); color: var(--tl-ink-3); cursor: pointer;
  transition: background var(--tl-fast) var(--tl-ease), color var(--tl-fast) var(--tl-ease);
}
.tl-glyph:hover { background: rgba(255,255,255,0.08); color: var(--tl-ink); }
.tl-glyph[aria-pressed="true"] { border-color: var(--tl-club); background: var(--tl-club-soft); box-shadow: inset 0 0 0 1px var(--tl-club); }
/* The two swatches that follow the kit carry a small mark, because they are a different
   kind of choice from the fixed colours beside them: they change when the kit does. */
.tl-swatch.club { position: relative; }
.tl-swatch.club::after {
  content: ''; position: absolute; right: 4px; bottom: 4px; width: 9px; height: 9px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 0 2px rgba(0,0,0,0.45);
}
.tl-slider output { font: 800 12.5px/1 var(--tl-font); color: var(--tl-ink-2); font-variant-numeric: tabular-nums; }

/* ---- kit: patterns, numbers, both sides ------------------------------------------------ */
.tl-kit-pair {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  padding: 14px 10px 10px; border-radius: 16px;
  background:
    radial-gradient(70% 80% at 50% 10%, rgba(255,255,255,0.07), transparent 70%),
    linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.3));
  border: 1px solid var(--tl-line);
}
.tl-kit-pair figure { margin: 0; display: grid; justify-items: center; gap: 6px; }
.tl-kit-pair .tl-kit-art { width: 100%; max-width: 150px; height: auto; filter: drop-shadow(0 8px 10px rgba(0,0,0,0.4)); }
.tl-kit-pair figcaption { font: 700 10.5px/1 var(--tl-font); letter-spacing: 0.1em; text-transform: uppercase; color: var(--tl-ink-3); }
.tl-pattern-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
.tl-pattern-opt {
  display: grid; justify-items: center; gap: 6px; padding: 9px 4px 8px;
  border: 1px solid var(--tl-line); border-radius: 13px;
  background: rgba(255,255,255,0.04); color: var(--tl-ink-2);
  font: 650 11.5px/1.15 var(--tl-font); text-align: center; cursor: pointer;
  transition: background var(--tl-fast) var(--tl-ease), border-color var(--tl-fast) var(--tl-ease);
}
.tl-pattern-opt:hover { background: rgba(255,255,255,0.08); color: var(--tl-ink); }
.tl-pattern-opt .tl-kit-art { width: 58px; height: auto; }
.tl-pattern-opt[aria-pressed="true"] {
  border-color: var(--tl-club); background: var(--tl-club-soft); color: var(--tl-ink);
  box-shadow: inset 0 0 0 1px var(--tl-club);
}
.tl-num-opt b { font: 800 17px/1 var(--tl-font); min-width: 24px; text-align: center; }
.tl-num-opt.num-block b { font-weight: 900; letter-spacing: -0.06em; -webkit-text-stroke: 0.6px currentColor; }
.tl-num-opt.num-italic b { font-style: italic; font-weight: 900; }
.tl-num-opt.num-outline b { color: transparent; -webkit-text-stroke: 1.2px var(--tl-ink); }
/* The tactics board's tokens carry the same four styles. */
.tl-token.num-block > span:first-child { font-weight: 900; letter-spacing: -0.05em; }
.tl-token.num-italic > span:first-child { font-style: italic; font-weight: 900; }
.tl-token.num-outline > span:first-child { color: transparent; -webkit-text-stroke: 1.2px var(--tl-token-ink, currentColor); }

/* ---- the ball catalogue ------------------------------------------------------------------ */
.tl-ball-canvas { display: block; }
.tl-ball-opt .tl-ball-canvas { filter: drop-shadow(0 4px 4px rgba(0,0,0,0.4)); transition: transform var(--tl-slow) var(--tl-ease); }
.tl-ball-opt:hover .tl-ball-canvas { transform: rotate(24deg) scale(1.04); }
/* A glowing ball glows in the picker too, in the colour of the trail it leaves. */
.tl-ball-opt.glows .tl-ball-canvas { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--glow, #fff) 65%, transparent)) drop-shadow(0 4px 4px rgba(0,0,0,0.4)); }
.tl-studio-ball .tl-ball-canvas { height: 100%; width: auto; }
.tl-ball-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }

.tl-menu-foot { display: flex; justify-content: center; }
.tl-btn.tl-menu-settings { min-width: 180px; }

@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion="full"]) {
    --tl-enter: 1ms; --tl-open: 1ms;
  }
  :root:not([data-motion="full"]) .tl-intro-card,
:root:not([data-motion="full"]) .tl-intro-wide,
:root:not([data-motion="full"]) .tl-letter,
:root:not([data-motion="full"]) .tl-letter h2,
:root:not([data-motion="full"]) .tl-letter p,
:root:not([data-motion="full"]) .tl-letter-stamp,
:root:not([data-motion="full"]) .tl-enter > *,
  :root:not([data-motion="full"]) .tl-sheet,
  :root:not([data-motion="full"]) .tl-drawer,
  :root:not([data-motion="full"]) .tl-toast,
  :root:not([data-motion="full"]) .tl-tick,
  :root:not([data-motion="full"]) .tl-pill.live::before,
  :root:not([data-motion="full"]) .tl-chip.tired .no,
  :root:not([data-motion="full"]) .tl-coach .bubble,
  :root:not([data-motion="full"]) .tl-coach .ring,
  :root:not([data-motion="full"]) .tl-coach .arrow,
  :root:not([data-motion="full"]) .tl-menu-beams::before,
  :root:not([data-motion="full"]) .tl-menu-beams::after,
  :root:not([data-motion="full"]) .tl-menu-ball,
  :root:not([data-motion="full"]) .tl-menu-continue::after,
  :root:not([data-motion="full"]) .tl-btn.tl-kick::after { animation: none !important; }
  :root:not([data-motion="full"]) .tl-flash { animation-duration: 900ms; }
  :root:not([data-motion="full"]) .tl-club-card:hover,
  :root:not([data-motion="full"]) .tl-chip:hover { transform: none; }
  :root:not([data-motion="full"]) .tl-main { scroll-behavior: auto; }
  :root:not([data-motion="full"]) .tl-score .goals .n.bump,
  :root:not([data-motion="full"]) .tl-cam-toast,
  :root:not([data-motion="full"]) .tl-cam-menu { animation: none !important; }
  :root:not([data-motion="full"]) .tl-chip.on-ball,
  :root:not([data-motion="full"]) .tl-onball { transform: none; transition: none; }
}
:root[data-motion="reduced"] .tl-score .goals .n.bump,
:root[data-motion="reduced"] .tl-cam-toast,
:root[data-motion="reduced"] .tl-cam-menu { animation: none !important; }
:root[data-motion="reduced"] .tl-chip.on-ball,
:root[data-motion="reduced"] .tl-onball { transform: none; transition: none; }
:root[data-motion="reduced"] {
  --tl-enter: 1ms; --tl-open: 1ms;
}
:root[data-motion="reduced"] .tl-intro-card,
:root[data-motion="reduced"] .tl-intro-wide,
:root[data-motion="reduced"] .tl-letter,
:root[data-motion="reduced"] .tl-letter h2,
:root[data-motion="reduced"] .tl-letter p,
:root[data-motion="reduced"] .tl-letter-stamp,
:root[data-motion="reduced"] .tl-enter > *,
:root[data-motion="reduced"] .tl-sheet,
:root[data-motion="reduced"] .tl-drawer,
:root[data-motion="reduced"] .tl-toast,
:root[data-motion="reduced"] .tl-tick,
:root[data-motion="reduced"] .tl-pill.live::before,
:root[data-motion="reduced"] .tl-chip.tired .no,
:root[data-motion="reduced"] .tl-coach .bubble,
:root[data-motion="reduced"] .tl-coach .ring,
:root[data-motion="reduced"] .tl-coach .arrow,
:root[data-motion="reduced"] .tl-menu-beams::before,
:root[data-motion="reduced"] .tl-menu-beams::after,
:root[data-motion="reduced"] .tl-menu-ball,
:root[data-motion="reduced"] .tl-menu-continue::after,
:root[data-motion="reduced"] .tl-btn.tl-kick::after { animation: none !important; }
:root[data-motion="reduced"] .tl-slot:hover,
:root[data-motion="reduced"] .tl-slot:focus-within { transform: none; }
:root[data-motion="reduced"] .tl-flash { animation-duration: 900ms; }
:root[data-motion="reduced"] .tl-club-card:hover,
:root[data-motion="reduced"] .tl-chip:hover { transform: none; }
:root[data-motion="reduced"] .tl-main { scroll-behavior: auto; }
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion="full"]) .tl-ball-opt .tl-ball-canvas { transition: none; transform: none; }
}
:root[data-motion="reduced"] .tl-ball-opt .tl-ball-canvas { transition: none; transform: none; }
`;

let injected = false;

export function installStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'touchline-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}
