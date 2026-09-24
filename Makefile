.PHONY: help install dev build preview typecheck test test-watch licenses \
        smoke shots screens keyboard calibrate fit-quick track clean

# Extra arguments for the harness targets, e.g.
#   make calibrate ARGS="500 150 120"   make shots ARGS="--width=1600 --height=900"
ARGS ?=

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Start the dev server (http://localhost:5179 — the other games hold 5173-5178)
	npm run dev

build: ## Type-check, build for production (dist/) and run the license/asset/network gate
	npm run build

preview: ## Serve the production build locally
	npm run preview

typecheck: ## Run the TypeScript compiler without emitting
	npm run typecheck

test: ## Run the Vitest suite (the pure sim and core modules)
	npm test

test-watch: ## Run the Vitest suite in watch mode
	npm run test:watch

licenses: ## Re-run the license gate alone: free deps, zero asset files, no external loads
	npm run check:licenses

# The four browser harnesses all drive `vite preview`, which serves dist/ — so they answer
# questions about the BUILT bundle, not the working tree. They depend on `build` for that
# reason: a screenshot or a green smoke run against a stale dist/ is worse than none.

smoke: build ## Drive the built bundle through a whole career turn; fails on any console error
	node scripts/smoke.mjs

shots: build ## Contact sheet of the match view — the primary quality instrument for the look
	node scripts/shots.mjs $(ARGS)

# shots photographs the match; screens photographs everything around it, at four widths, and
# Gates card/viewport bounds, numeric headings, 56px controls and uncovered navigation. That gate is what a stylesheet
# with no box-sizing reset costs you, and it is cheaper to keep than to rediscover.
screens: build ## Interface captures at 390/768/1280/1600 + layout and target gates
	node scripts/screens.mjs $(ARGS)

# Optional screen modes: ARGS="--reduced-motion --blank --negative-control"
# Evidence lives in /tmp by default so no screenshot asset enters the game build.

keyboard: build ## Play the game with key events only — what accessibility.json is written from
	node scripts/keyboard.mjs

# Dev harnesses, written in TypeScript against the game's own sources so they cannot drift
# from it, run through Vite's SSR loader (scripts/run-ts.mjs — no extra dependency).

calibrate: ## Balance harness: run a pile of matches, print what football they add up to
	node scripts/run-ts.mjs src/sim/match/calibrate.ts $(ARGS)

fit-quick: ## Compare the quick engine against the full one across a ladder of mismatches
	node scripts/run-ts.mjs src/sim/match/fit-quick.ts $(ARGS)

track: ## Age a world and print the pyramid every season, to catch slow career-sim rot
	node scripts/run-ts.mjs src/sim/career/track.ts $(ARGS)

clean: ## Remove build output and dependencies
	rm -rf dist node_modules
