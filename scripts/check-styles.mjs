// One check, for one mistake that has been made three times.
//
// `src/ui/styles.ts` holds the entire stylesheet in a JavaScript template literal, so a
// BACKTICK anywhere inside it ends the string early — and the natural thing to do in a CSS
// comment is to quote a class or a property name in backticks, which is exactly how it
// happens. What TypeScript then reports is a syntax error on some unrelated line hundreds
// of lines further down, in a file whose CSS is perfectly valid, and the trail from that
// message to the cause is long enough to lose twice.
//
// This runs before `tsc` and says what is actually wrong.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'src/ui/styles.ts');
const source = readFileSync(file, 'utf8');

const open = source.indexOf('const CSS = `');
const close = source.indexOf('`;', open + 13);
if (open === -1 || close === -1) {
  console.error('check-styles: could not find the CSS template literal in src/ui/styles.ts');
  process.exit(1);
}

const body = source.slice(open + 13, close);
const offenders = body
  .split('\n')
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => line.includes('`'));

if (offenders.length > 0) {
  console.error('check-styles: backtick inside the CSS template literal, which ends the string early.');
  console.error('             Rewrite the comment without backticks.\n');
  const firstLine = source.slice(0, open).split('\n').length;
  for (const [i, line] of offenders) {
    console.error(`  src/ui/styles.ts:${firstLine + i - 1}: ${line.trim()}`);
  }
  process.exit(1);
}

// The other silent failure mode: a template placeholder. `${...}` inside the CSS would be
// interpolated as JavaScript rather than shipped as text.
if (/\$\{/.test(body)) {
  console.error('check-styles: ${...} inside the CSS template literal is interpolated, not literal CSS.');
  process.exit(1);
}

console.log(`style gate: ${body.split('\n').length} lines of CSS, no template hazards`);
