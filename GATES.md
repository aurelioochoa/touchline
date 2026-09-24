# Gates: Touchline design review

Scope: finish the approved Touchline-only audit, local comparison canvas, targeted fixes and verification.

- [x] G1: Production build preserves zero assets and external loads
  CHECK: make build
  EXPECT: all gates passed
  EVIDENCE: make build passed
- [x] G2: Simulation and core tests pass
  CHECK: make test
  EXPECT: Test Files
  EVIDENCE: 16 files and 201 tests passed
- [x] G3: Career and wordless smoke checks pass
  CHECK: node scripts/smoke.mjs
  EXPECT: smoke
  EVIDENCE: 52/52 checks and 0 console errors
- [x] G4: Four-width screenshots pass geometry checks including a failing negative control
  CHECK: node scripts/screens.mjs --out=/tmp/touchline-review/after
  EXPECT: overflow gate: nothing sticks out of a card
  EVIDENCE: 64 frames; negative control rejected content-box rows
- [x] G5: Keyboard-only career remains operable
  CHECK: node scripts/keyboard.mjs
  EXPECT: keyboard
  EVIDENCE: keyboard gate passed
- [x] G6: Reduced-motion and blank-text screenshots reviewed
  EVIDENCE: 32 frames at 390 and 768px passed expected-surface and overflow checks
- [x] G7: Whole-game audit and comparison canvas include evidence, tokens and owner decisions
  EVIDENCE: docs/design-review/audit.md and canvas.html
