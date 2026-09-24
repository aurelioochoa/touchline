# Verification record

- `make build`: passed style, TypeScript, Vite, license, asset and network gates.
- `make test`: 16 files, 201 tests passed.
- `node scripts/smoke.mjs`: 52/52 checks passed, 0 console errors. The running-match assertion now uses monotonic simulation ticks across halftime.
- `node scripts/keyboard.mjs`: keyboard-only career, onboarding, tactics arrows, match pause, camera and Escape path passed; the harness now fails on missing outcomes.
- `node scripts/screens.mjs --negative-control`: 64 frames at 390, 768, 1280 and 1600px; expected-surface assertions, numeric alignment, target geometry, viewport/card overflow and navigation hit tests passed. The deliberately reintroduced content-box fixture rows were rejected.
- Reduced motion plus blank text: 32 frames at 390 and 768px; expected-surface and overflow checks passed.
- Impeccable detector: 3 warnings, 0 errors. Two intentional narrative easing curves and one width transition are documented in `audit.md`.

Screenshots are generated under `/tmp/touchline-review`; `canvas.html` is an offline artifact generated from the final capture set. It is not included in the production bundle.
