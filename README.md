# Touchline

Football management with a 3D match. TypeScript + Three.js + Vite. Zero asset
files: every mesh is a Three.js primitive, every texture procedural, every
sound synthesized.

## Run it

```bash
npm install
npm run dev      # http://localhost:5179
npm run build    # type-check + production build + license/asset/network gate
npm test         # Vitest suite
```

Other harnesses: `make smoke`, `make shots`, `make screens`, `make keyboard`.
See `Makefile` and `GATES.md`.

## License

- Noncommercial use (personal, study, hobby, evaluation, noncommercial
  modifications and redistribution): free under
  [PolyForm Noncommercial 1.0.0](./LICENSE.md).
- **Any commercial use — anything that makes money, including ads,
  subscriptions, resale, SaaS hosting or revenue-supporting business use —
  requires a paid license.** See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md).
- Third-party components keep their own licenses, see
  [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

This is source-available, not OSI open source: you may download, read and
reuse it for free as long as you do not make money with it. Only the
licensor (© 2026 Aurelio Ochoa) may grant commercial rights.
