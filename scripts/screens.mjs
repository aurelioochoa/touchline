// Contact sheet of the INTERFACE, at four widths, and a gate on things sticking out of it.
//
//   node scripts/screens.mjs [--out=DIR] [--widths=390,768,1280,1600] [--only=table,fixtures]
//     [--reduced-motion] [--blank] [--negative-control] [--css-source=styles.ts]
//
// scripts/shots.mjs photographs the match. This photographs everything around it — the menu,
// the inheritance intro, and the seven routes a career actually lives on — because until it
// existed there was no way to look at a screen of this game except by playing it, and a
// design review of a thing nobody can see is a design review of the source code.
//
// Four widths, and 768 is the one that earns its place: the stylesheet switches the table
// columns at 599px and the shell at 760px, so 768 is the first width where both decisions
// have been made and neither was made for it. Nothing had ever been looked at there.
//
// It also GATES, which is the half that outlives the review. On every capture it asserts
// that nothing inside a card sticks out of the card. That is one property, it is cheap, and
// it is exactly the fault this script was written in the aftermath of: .tl-row-item declared
// width:100% and 32px of padding in a stylesheet with no box-sizing reset, so every fixture
// row rendered 32px wider than the card holding it and the score pill was sheared off the
// right-hand edge. It read as "fixtures is offset to the right" and it was invisible on the
// squad screen, whose rows are buttons and so were already border-box. A picture alone would
// not have caught that at a glance either; a number does.
//
// Like the other browser harnesses this drives the BUILT bundle through vite preview, so it
// answers questions about dist/ and depends on `make build` for that reason.
//
// ONE THING TO KNOW BEFORE READING THE FRAMES. Under SwiftShader the compositor sometimes
// lays translucent vertical bands over a long card — two grey rectangles down the league
// table is the usual shape of it. They are stable across a six-second settle, so they do
// not look like a capture race, and they are not in the product: the same screen in a real
// GPU browser is clean. Do not open a finding on them. Anything about SHADING wants a real
// browser; composition, geometry and legibility are what these frames are good for, and the
// overflow gate below is a number rather than a picture for exactly that reason.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argVal = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const outDir = argVal('out', join(tmpdir(), 'touchline-screens'));
const widths = argVal('widths', '390,768,1280,1600').split(',').map(Number);
const only = argVal('only', '');
const wanted = only ? new Set(only.split(',')) : null;
const cssSource = argVal('css-source', '');
const cssOverride = cssSource ? readFileSync(cssSource, 'utf8').split('const CSS = `')[1].split('`;')[0] : '';
const reduced = args.includes('--reduced-motion');
const blank = args.includes('--blank');
const negativeControl = args.includes('--negative-control');
if (!widths.length || widths.some(w => !Number.isInteger(w) || w < 320 || w > 4000)) {
  throw new Error('widths must be integers between 320 and 4000');
}
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 4500 + (process.pid % 90);
const url = `http://localhost:${port}/?seed=20260906${blank ? '&blank=1' : ''}`;

// Portrait for the phone, landscape for everything else. A 390px frame that is 900px tall is
// not a phone, and the tab bar is pinned to the bottom of the viewport.
const heightFor = (w) => (w < 600 ? 844 : w < 900 ? 1024 : 900);

function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER;
  const found = [
    `${process.env.HOME}/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome`,
    '/opt/brave-bin/brave',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find((p) => existsSync(p));
  if (!found) throw new Error('No Chromium-family browser found — set BROWSER=/path/to/chrome');
  return found;
}

const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(port), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite preview never came up')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(port))) {
      clearTimeout(t);
      res();
    }
  });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const profile = mkdtempSync(join(tmpdir(), 'touchline-screens-'));
const dbg = 9200 + (process.pid % 190);
const child = spawn(findBrowser(), [
  '--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  '--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const cleanup = () => {
  try { child.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

let page;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
    if (page) break;
  } catch { /* not up yet */ }
  await sleep(250);
}
if (!page) throw new Error('browser never exposed a page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 1;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id: id++, method, params }));
  });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails));
  return r.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
// New-career slots also use Date.now: freeze the seed source, not animation time.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'Date.now = () => 1799193600000; localStorage.clear();',
});
if (reduced) await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});

/**
 * Does anything stick out of the surface that is supposed to contain it?
 *
 * A card clips nothing by default, so an over-wide child makes the CARD scrollable — its
 * scrollWidth grows past its clientWidth — and that is the whole test. The one construct
 * allowed to be wider than its container is .tl-scroll, which owns overflow-x on purpose so
 * a squad table can be swiped on a phone; it establishes its own scroll box, so its content
 * never shows up in the card's measurement and no exception is needed for it here.
 */
const OVERFLOW_PROBE = `
  (() => {
    const bad = [];
    for (const card of document.querySelectorAll('.tl-card, .tl-sheet')) {
      const rect = card.getBoundingClientRect();
      const over = Math.max(card.scrollWidth - card.clientWidth,
        rect.right - document.documentElement.clientWidth, -rect.left);
      if (over <= 1) continue;
      // Name the widest child, so the report says what to go and look at.
      let worst = null;
      for (const n of card.querySelectorAll('*')) {
        if (n.closest('.tl-scroll')) continue;
        const w = n.getBoundingClientRect().width;
        if (!worst || w > worst.w) worst = { w: Math.round(w), cls: n.className || n.tagName };
      }
      bad.push({
        card: card.className,
        over,
        clientWidth: card.clientWidth,
        widest: worst,
      });
    }
    // And the same question asked of the viewport rather than of a card, for the match
    // screen, which mounts outside .tl-root and has no card in it at all. It must ignore
    // anything sitting inside a scroller: the bench strip is eleven chips on a 390px phone
    // and is MEANT to run off the edge and be swiped. Note that the page itself can never
    // scroll here — index.html pins html, body and #app and hides their overflow — so
    // documentElement.scrollWidth is not the measurement to take; it reads 555 on a phone
    // during a match purely from the WebGL canvas's own buffer size, which is clipped,
    // invisible, and nothing to do with the layout.
    // Check actual HUD controls against their nearest intentional horizontal scroller.
    // html/body/#app clipping cannot excuse an inaccessible control.
    const vw = document.documentElement.clientWidth;
    const escaped = [];
    for (const n of document.querySelectorAll('.tl-hud button, .tl-hud [role="button"], .tl-chip')) {
      const b = n.getBoundingClientRect();
      if (!b.width) continue;
      let scroll = null;
      for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) { scroll = p; break; }
      }
      const bounds = scroll?.getBoundingClientRect();
      if (bounds && bounds.left >= -1 && bounds.right <= vw + 1) continue;
      if (b.left < -1 || b.right > vw + 1) escaped.push({
        cls: String(n.className || n.tagName), right: Math.round(b.right),
      });
    }
    return { cards: bad, escaped: escaped.slice(0, 6), vw };
  })()`;

const failures = [];
let shots = 0;
const measurements = [];
let controlled = false;

const capture = async (name) => {
  // The toasts are real UI, but a career fast-forwarded through twelve matchdays stacks
  // twenty of them up the middle of the frame and the screenshot underneath is unreadable.
  await ev(`document.querySelectorAll('.tl-toast-host > *').forEach((n) => n.remove())`);
  await sleep(90);
  const surface = name.replace(/^\d+-\d+-/, '');
  const expected = { menu: '.tl-slot', letter: '.tl-letter', letter2: '.tl-letter', letter3: '.tl-letter',
    pick: '.tl-club-card', identity: '.tl-crest-editor', contract: '.tl-contract',
    home: '#main .tl-card', squad: '.tl-table, .tl-rows', tactics: '.tl-board',
    table: '.tl-table', fixtures: '.tl-row-item', transfers: '#main .tl-card',
    settings: '.tl-set-row', player: '.tl-sheet', match: '.tl-hud',
    resume: '.tl-slot.filled', studio: '.tl-studio-stage', 'studio-kit': '.tl-opt-row',
    'studio-ball': '.tl-ball-grid', 'studio-ground': '.tl-rename', 'studio-build': '.tl-fac',
    'menu-settings': '.tl-sheet .tl-set-row', 'studio-layers': '.tl-layer-chip' }[surface];
  if (!expected || !await ev(`Boolean(document.querySelector(${JSON.stringify(expected)}))`)) {
    throw new Error(`${name}: expected surface ${expected} is missing`);
  }
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(s.data, 'base64'));
  shots++;

  const probe = await ev(OVERFLOW_PROBE);
  const detail = await ev(`(() => ({
    headers: [...document.querySelectorAll('.tl-table th.tl-num')].map(th => ({
      text: th.textContent, align: getComputedStyle(th).textAlign,
      right: th.getBoundingClientRect().right,
      bodyRight: th.closest('table').tBodies[0]?.rows[0]?.cells[th.cellIndex]?.getBoundingClientRect().right,
    })),
    rows: [...document.querySelectorAll('.tl-row-item')].slice(0, 2).map(n => ({
      width: n.getBoundingClientRect().width, parentWidth: n.parentElement.clientWidth,
      cursor: getComputedStyle(n).cursor,
    })),
    controls: [...document.querySelectorAll('.tl-nav button, .tl-btn, .tl-range, .tl-swatch, .tl-crest-tab, .tl-crest-option, .tl-input')].filter(n => n.getBoundingClientRect().width).map(n => {
      const b = n.getBoundingClientRect();
      const nav = Boolean(n.closest('.tl-nav'));
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { cls: n.className, width: b.width, height: b.height,
        blocked: nav && !document.querySelector('[aria-modal="true"]') && !n.contains(hit) };
    }),
    tokens: [...document.querySelectorAll('.tl-token')].map(n => {
      const b = n.getBoundingClientRect(), hit = getComputedStyle(n, '::before');
      return { width: Math.max(b.width, parseFloat(hit.width) || 0),
        height: Math.max(b.height, parseFloat(hit.height) || 0) };
    }),
    board: (() => {
      const b = document.querySelector('.tl-board')?.getBoundingClientRect();
      return b ? {width: b.width, height: b.height, left: b.left, right: b.right} : null;
    })(),
    motion: document.documentElement.dataset.motion,
    enterDuration: getComputedStyle(document.documentElement).getPropertyValue('--tl-enter').trim(),
  }))()`);
  measurements.push({ name, ...probe, ...detail });
  for (const t of detail.tokens) {
    if (t.width < 55.5 || t.height < 55.5) failures.push(`${name}: token hit area below 56px`);
  }
  for (const c of detail.controls) {
    if (c.width < 55.5 || c.height < 55.5 || c.blocked) failures.push(`${name}: target ${c.cls} ${c.width}x${c.height}${c.blocked ? ' covered' : ''}`);
  }
  for (const h of detail.headers) {
    if (h.align !== 'right' || (h.bodyRight != null && Math.abs(h.right - h.bodyRight) > 1)) {
      failures.push(`${name}: numeric heading ${h.text} does not align with its column`);
    }
  }
  if (reduced && detail.enterDuration !== '1ms') failures.push(`${name}: reduced motion not applied`);
  if (negativeControl && name.endsWith('-fixtures') && !controlled) {
    await ev(`(() => {
      const style = document.createElement('style'); style.id = 'negative-control';
      style.textContent = '.tl-row-item { box-sizing: content-box !important; }';
      document.head.append(style);
    })()`);
    const broken = await ev(OVERFLOW_PROBE);
    await ev(`document.getElementById('negative-control').remove()`);
    if (!broken.cards.some(c => c.over >= 30)) failures.push('negative control failed to detect fixture overflow');
    else console.log('  negative control: rejected content-box fixture rows');
    controlled = true;
  }
  for (const b of probe.cards) {
    failures.push(`${name}: ${b.over}px out of .${String(b.card).split(' ').join('.')} `
      + `(card ${b.clientWidth}px, widest child ${b.widest?.cls} at ${b.widest?.w}px)`);
  }
  for (const e of probe.escaped) {
    failures.push(`${name}: .${e.cls.split(' ').join('.')} reaches ${e.right}px past a ${probe.vw}px viewport, unclipped`);
  }
  const bad = probe.cards.length + probe.escaped.length;
  console.log(`  ${name}${bad ? '   <-- OVERFLOW' : ''}`);
};

const shoot = async (name) => {
  if (wanted && !wanted.has(name.replace(/^\d+-\d+-/, '').replace(/@\d+$/, ''))) return;
  await capture(name);
};

const click = (sel) => ev(`
  (() => {
    const n = document.querySelector(${JSON.stringify(sel)});
    if (!n) return false;
    n.click();
    return true;
  })()`);

const introNext = () => ev(`
  (() => {
    const b = document.querySelector('.tl-intro-foot [data-nav="next"]')
      || [...document.querySelectorAll('.tl-intro-foot button')].pop();
    if (!b) return false;
    b.click();
    return true;
  })()`);

async function boot() {
  await ev('localStorage.clear()').catch(() => {});
  await send('Page.navigate', { url });
  for (let i = 0; i < 140 && !(await ev('Boolean(window.__touchline)')); i++) await sleep(250);
  await sleep(1200);
  if (cssOverride) await ev(`document.getElementById('touchline-styles').textContent = ${JSON.stringify(cssOverride)}`);
}

console.log(`screens: ${widths.join(', ')}px -> ${outDir}`);

for (const width of widths) {
  const height = heightFor(width);
  console.log(`\n${width}x${height}`);
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 600,
  });

  // ---- the front door and the inheritance ----------------------------------------
  await boot();
  await shoot(`${width}-01-menu`);

  await click('.tl-slot button, .tl-slots button');
  await sleep(700);
  await shoot(`${width}-02-letter`);
  for (const page of [2, 3]) {
    await introNext(); await sleep(600);
    await shoot(`${width}-02-letter${page}`);
  }
  await introNext();
  await sleep(600);
  await shoot(`${width}-03-pick`);

  // A mid-table club two divisions down, matching the club shots.mjs chooses, so the two
  // contact sheets are pictures of the same career rather than of two different ones.
  await ev(`
    (() => {
      const g = window.__touchline;
      const d = g.world.divisions[2];
      const ranked = d.clubIds.map((id) => g.world.clubs[id]).sort((a, b) => b.reputation - a.reputation);
      g.pick(ranked[9].id);
    })()`);
  await sleep(700);
  await shoot(`${width}-04-identity`);
  await introNext();
  await sleep(700);
  await shoot(`${width}-05-contract`);
  await click('.tl-intro-card .tl-block');
  await sleep(900);

  // ---- a career, twelve matchdays in ---------------------------------------------
  // The tables have to carry real numbers. An empty league table is eighteen rows of zero
  // and says nothing about whether the columns are readable.
  await ev('window.__touchline.game.dismissCoach()');
  await sleep(200);
  await ev(`
    (() => {
      const g = window.__touchline;
      for (let i = 0; i < 12; i++) g.quick();
    })()`);
  await sleep(900);
  await ev(`document.querySelector('.tl-sheet-foot .tl-primary')?.click()`);
  await sleep(400);
  await ev('window.__touchline.game.dismissCoach()');

  for (const [n, route] of [
    ['06-home', 'home'], ['07-squad', 'squad'], ['08-tactics', 'tactics'],
    ['09-table', 'table'], ['10-fixtures', 'fixtures'], ['11-transfers', 'transfers'],
    ['12-settings', 'settings'], ['16-studio', 'studio'],
  ]) {
    await ev(`window.__touchline.go('${route}')`);
    await sleep(520);
    await shoot(`${width}-${n}`);
  }

  // ---- the club studio, one frame per tab -------------------------------------------
  // The badge tab is 16-studio above; these are the other four panels, and the upgrades
  // one is shot with money in the bank so its buttons are the affordable state.
  await ev(`(() => { const g = window.__touchline.game; g.club.balance = Math.max(g.club.balance, 40e6); })()`);
  for (const [n, tab] of [['17-studio-kit', 'kit'], ['18-studio-ball', 'ball'], ['19-studio-ground', 'ground'], ['20-studio-build', 'build']]) {
    await ev(`document.querySelector('#tl-studio-tab-${tab}')?.click()`);
    await sleep(420);
    await shoot(`${width}-${n}`);
  }
  // The emblem creator, with a stack already built so the frame shows layers rather than
  // the empty state: a ring, a star and a flame, the middle one selected.
  await ev(`document.querySelector('#tl-studio-tab-badge')?.click()`);
  await sleep(200);
  await ev(`(() => {
    const g = window.__touchline.game;
    g.world.crest = { ...(g.world.crest ?? { shape: 0, pattern: 1, border: 1, emblem: 0, stars: 0, initials: false }),
      initials: false, emblem: 0,
      layers: [
        { glyph: 1, colour: 2, x: 0, y: 2, size: 44, rot: 0, flip: false },
        { glyph: 18, colour: 6, x: 0, y: 4, size: 30, rot: 0, flip: false },
        { glyph: 6, colour: 3, x: 0, y: -18, size: 14, rot: 0, flip: false },
      ] };
    g.refresh();
  })()`);
  await sleep(400);
  await ev(`document.querySelector('#tl-studio-tab-badge')?.click()`);
  await ev(`[...document.querySelectorAll('.tl-crest-tab')].at(-1)?.click()`);
  await sleep(400);
  await shoot(`${width}-22-studio-layers`);

  // ---- the front door again, with a career in it --------------------------------------
  // The cold-boot frame only ever shows three empty slots. This one has the club's badge
  // on its card and on Continue, which is the menu most players actually see.
  await ev('window.__touchline.game.openMenu()');
  await sleep(700);
  await shoot(`${width}-15-resume`);
  await click('.tl-menu-settings');
  await sleep(500);
  await shoot(`${width}-21-menu-settings`);
  await ev(`document.querySelector('.tl-sheet-head .tl-btn')?.click()`);
  await sleep(300);
  await click('.tl-menu-continue');
  await sleep(500);
  await ev('window.__touchline.game.dismissCoach()');

  // ---- a player sheet, the one overlay every route can reach -----------------------
  await ev(`window.__touchline.go('squad')`);
  await sleep(400);
  await click('.tl-row-item, .tl-table tbody tr');
  await sleep(600);
  await shoot(`${width}-13-player`);
  await ev(`document.querySelector('.tl-sheet-head .tl-btn')?.click()`);
  await sleep(300);

  // ---- the match HUD ---------------------------------------------------------------
  // One frame, not a sequence: shots.mjs owns the match. What this is here for is the
  // chrome around it — the bench strip, the clock and the scoreline at this width.
  await ev(`window.__touchline.go('home')`);
  await sleep(300);
  // Dressed from the club studio, so the frame also shows that a kit pattern and a chosen
  // ball reach the 3D match: striped shirts and the fireball.
  await ev(`(() => {
    const w = window.__touchline.game.world;
    w.look = { ...w.look, pattern: 1, patternColour: 1, ball: 18 };
  })()`);
  await ev(`window.__touchline.watch()`);
  await sleep(2400);
  await ev(`
    (() => {
      const m = window.__touchline.game;
      if (!m.matchState) return false;
      for (let i = 0; i < 2000 && !m.matchState.finished; i++) m.matchStep();
      m.matchDraw(24);
      return true;
    })()`);
  await sleep(500);
  await shoot(`${width}-14-match`);
}

writeFileSync(join(outDir, 'measurements.json'), JSON.stringify(measurements, null, 2));
if (!shots) failures.push('no frames matched the requested routes');
if (negativeControl && !controlled) failures.push('negative control requires fixtures route');
console.log(`\n${shots} frames in ${outDir}`);
if (failures.length > 0) {
  console.error(`\nlayout gate: ${failures.length} geometry, target or alignment failure(s)\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('overflow gate: nothing sticks out of a card');
process.exit(0);
