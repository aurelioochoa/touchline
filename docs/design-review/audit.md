# Touchline design review · 8 September 2026

Method: dual-agent (A: /root/design_assessment · B: /root/evidence_assessment), followed by fresh Chromium captures and implementation verification. Assessment A completed before the detector results were read. Scope: Touchline only. [Open the comparison canvas](canvas.html).

## Verdict

Keep the existing visual identity. Dusk green, the club-bound accent, shirt numbers, crests, the illustrated inheritance and the system type stack belong to this football game. The problems were responsive geometry and interaction clarity, not a need for a new brand. No fonts, raster game assets, libraries, navigation labels or simulation rules were added.

The approved plan asked for a Claude Design canvas. That application is not exposed in this session; the delivered substitute is a portable offline HTML canvas with six comparison artboards, live token samples and a nine-screen gallery. The current panes use the final capture set in both slots because the temporary inherited capture was unavailable when the artifact was packaged; the measured inherited values and true before-state evidence remain documented below and in the original review reports. Screenshots embedded in documentation do not enter the production bundle.

## Findings and disposition

| Priority | Finding and evidence | Disposition |
|---|---|---|
| P1 | Numeric heading specificity: .tl-table th overrode .tl-num. Original Claude measurements put P roughly 43px left of its data. The inherited fix is retained. Current 1280px header/data cell right edges match exactly, including P at 859px and Pts at 1229px; computed text alignment is right. | **Fix now · applied by Claude, verified here.** Explicit th/td numeric selectors, preserved fixed-column proportions. Canvas: Numeric columns. |
| P1 | Fixture div rows used width:100% plus 32px padding without border-box. Original scores were clipped. Current phone rows and parent are both 360px. Reintroducing content-box produces at least 30px overflow and is rejected. | **Fix now · applied by Claude, verified here.** Global border-box reset. Canvas: Fixtures. |
| P1 | At 390px, the inherited tactics card extends 49.30px beyond the viewport; its pitch ends at x420.30. The old gate checked content within cards, not whether a card escaped the screen. | **Fix now · applied.** Shrinkable grid tracks/children, width-constrained pitch with its 68:92 aspect ratio and space for edge targets. Canvas: Phone tactics. |
| P1 | A late illustration rule assigned both topbar and main z-index:1. Later main cards covered fixed phone navigation inside the topbar's stacking context. Fresh elementFromPoint probes confirmed covered tab centres. | **Fix now · applied.** Topbar stays at z-index:3; main stays at 1. Navigation hit testing now gates captures; modal dialogs intentionally block background navigation. Canvas: Phone tactics and Tablet navigation. |
| P1 | Compact buttons were 40px high, inputs 44px, sliders 34px, swatches 34px and crest tabs 36px; desktop tabs were 40px high. Seven phone tabs averaged 52.29px wide. These contradict the game's 56px target contract. | **Fix now · applied.** Shared 56px control sizes; narrow phone navigation reflows into two rows. At 390px tabs now measure 93×56px; tablet tabs are approximately 106.29×56px. Inputs use 16px text. Canvas: Settings controls and Club identity. |
| P2 | Navigation labels disappeared at 760–1079px, making children relearn seven icons at tablet width. | **Fix now · applied.** Keep labelled bottom navigation until 1080px; then place it in the topbar. Preserve routes and labels. |
| P2 | Fixtures and transfer rows inherited an interactive whole-row hover despite being passive containers. | **Fix now · applied.** Only button rows get the pointer and row highlight. Buy/Sell retain their own button feedback. |
| P2 | Condition/morale bars exposed a category but not magnitude to screen readers. | **Fix now · applied.** Accessible names include percentage; attribute bars expose their original value out of 20 rather than a normalized percentage. |
| P3 | A 96px relationship was repeated between mobile squad headers and metric stacks; three label rules referenced the undefined --tl-muted token. | **Fix now · applied.** Shared --tl-row-metric and the existing --tl-ink-3 token. |
| P2 | A sale removes the player and saves immediately, with no undo. Guarding squad size does not protect against choosing the wrong player. | **Your call.** Add transaction undo or an explicit sale completion step. This changes interaction behavior; it is not included in the layout repair. |
| P3 | Nine formation choices and six style presets compete with the pitch. Custom player positions can overlap when deliberately brought together. | **Your call.** Consider optional preset disclosure or a separate player-selection list if testing with children shows confusion. Preserve the existing formation editing model for now. |
| P3 | Wide squad rows are keyboard-focusable and open sheets, but native buttons in the name cell would communicate the action better to a screen reader. | **Noted.** Requires a focused table-semantics pass and screen-reader testing. |

## Review coverage

| Surface | Review result |
|---|---|
| Shell and topbar | Bounded content remains. Repaired navigation stacking and medium-width placement. |
| Main menu and inheritance | Preserve illustrated ground, optional story, back/skip and contract. Fresh captures include all three letter states, actual picker, identity and contract. |
| Crest and badge editor | Preserve procedural identity and per-career colour. Enlarge controls and fields; optional choices remain scrollable. |
| Buttons, cards, statistics, pills | Keep the broadcast hierarchy, tabular figures, semantic colours and surface radii. Enlarge controls rather than text everywhere. |
| Bars | Preserve visual magnitude and semantic tones; supply magnitude in accessible names. |
| League, mini and squad tables | Verify numeric alignment across routes and widths. Intentional horizontal table scrollers remain allowed. |
| Club picker | A real picker capture replaces the old mislabeled story frame. Division groupings and real club identity remain useful. |
| Tactics and sliders | Repair clipping and minimum target sizes while preserving pitch aspect ratio, presets, dragging and arrow-key editing. |
| Fixtures and transfers | Scores fit, passive rows stop advertising clicks; sale undo remains an owner decision. |
| Match HUD and player strip | Retain intentional portrait letterboxing and horizontal player-strip scrolling. Check actual HUD control bounds, not the WebGL buffer width. |
| Overlays and sheets | Player sheet scrolls; larger close target. Existing focus trap, return focus, Escape and aria-modal retained. |
| Coach, tooltips and toasts | Source-reviewed contextual guidance, accessible names and live regions. Bulk simulated match toasts are removed only by the capture harness. |
| Empty states | Preserve existing procedural illustrations and next-step actions. No new defect asserted from unvisited failure states. |
| Illustration layer | Keep club-reactive inline artwork. Correct stacking regression without introducing replacement art. |
| Reduced motion and wordless mode | Capture both together on phone/tablet, assert the reduced entrance token, and verify the wordless match path in smoke. |

## Design assessment

Assessment A's starting score is **26/40**, a provisional expert judgment, not a usability study or a post-fix certification.

| Heuristic | /4 | Starting issue |
|---|---:|---|
| System status | 3 | Strong match state; quiet save feedback |
| Match with real world | 4 | Football is expressed directly |
| Control and freedom | 2 | Immediate sales lack recovery |
| Consistency | 2 | Target sizes and passive hover disagree |
| Error prevention | 2 | Small consequential controls |
| Recognition | 2 | Tablet labels disappear |
| Efficiency | 3 | Quick results, shortcuts and presets |
| Minimalist design | 3 | Strong hierarchy undermined by clipping |
| Error recovery | 2 | No sale undo; silent transfer guards |
| Help | 3 | Coach and inline descriptions exist |

The strengths are specific club identity, optional narrative onboarding and multiple ways to recognize a player. The first-timer loses recognition when labels disappear; the distracted phone player needs larger targets; the keyboard and low-vision player benefits from the existing focus behavior but needs bar magnitudes exposed. The inheritance and signature are emotional peaks. Dense transfers and accidental sales are the main remaining valley. Formation/style decisions exceed four choices, but this is intentional simulation depth; hiding them needs user evidence, not a blanket minimalism rule.

## Detector and constraints

Impeccable reported three warnings: two overshooting entrance curves for the letter/card and stamp, and a width transition on attribute bars. The letter/stamp motion is authored narrative feedback and is disabled by reduced motion. The bar transition is a performance observation, not measured frame loss; match-strip bars already disable it. None justifies removing the product's visual identity. The final detector output is retained in detector.json.

The marketing-oriented design-taste skill explicitly excludes dense product UI and data tables; its marketing prescriptions were not imposed on the game. The applicable review used Impeccable, the local Web Interface Guidelines checklist and redesign-existing-projects, with the approved game brief taking precedence over generic font, illustration and decoration advice. The source's dusk direction and design §9a/§18 supersede the older sunny-afternoon/cold-open wording elsewhere in the design document.

## Evidence integrity and verification

The old 56-frame sheet included Home screenshots under several intro labels, and a season-end screen under a match label. Careers accumulated matchdays between widths. The harness now clears isolated storage on each new document, freezes the seed source, asserts the expected surface, captures all three letters, and no longer swallows quick-simulation errors. Its --only filter now matches route names correctly. measurements.json records card bounds, numeric-column alignment, control sizes, nav hit tests and motion state.

The inherited stylesheet is captured separately using --css-source, so the comparison does not require rewriting source or rebuilding a broken game. It produces a nonzero exit with the actual mobile tactics overflow and small targets. Original pre-table-fix screenshots are explicitly labeled as prior-session captures with a different career. The new comparison captures use the same seeded career.

The smoke harness previously compared displayed clock seconds. Crossing half time can legitimately reset stoppage time to 45:00, making a running match appear to go backwards. It now checks monotonic simulation ticks. The keyboard harness now throws when key outcomes fail instead of merely printing them and exiting zero.

See verification.md for final command results and measurements. Full raw captures remain in /tmp/touchline-review; representative captures are embedded in canvas.html for portability. Documentation is outside the production build. Browser automation used Chromium with SwiftShader. No live Impeccable overlay was injected, and no native screen-reader, Safari/iOS, real-GPU or low-power performance certification is claimed. Translucent capture bands were already cross-checked against a GPU browser in the prior session; they are not treated as product defects here.

Questions skipped: the user already approved implementing clear fixes and recording owner decisions; the two remaining choices are recorded above rather than blocking the work.
