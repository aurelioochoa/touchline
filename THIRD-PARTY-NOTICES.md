# Third-Party Notices for Touchline

Touchline's own code is licensed under PolyForm Noncommercial 1.0.0
(see `LICENSE.md`). The dependencies below keep their own licenses.

## Runtime dependency

- [three](https://threejs.org/) — MIT License, Copyright © Three.js authors.
  Required notice is preserved in the built bundle as a license comment
  (see `scripts/check-licenses.mjs` allowlist entry for
  `https://github.com/mrdoob/three.js`).

## Build / dev dependencies (not shipped to players)

- [TypeScript](https://www.typescriptlang.org/) — Apache-2.0
- [Vite](https://vite.dev/) — MIT
- [Vitest](https://vitest.dev/) — MIT
- [@types/three](https://github.com/DefinitelyTyped/DefinitelyTyped) — MIT

Run `npm run check:licenses` to re-verify that every installed dependency
carries a recognised free/open-source license and that `dist/` contains no
live external URL loads.
