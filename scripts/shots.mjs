// Contact sheet of the match view, for looking at.
//
//   node scripts/shots.mjs [--out=DIR] [--width=1280] [--height=720]
//
// For a game whose whole appeal is that the match looks like football, this is the primary
// quality instrument, not a nicety (design §12). No unit test asserts that a running
// figure reads as a person, that the pitch markings are in the right place, or that a
// broadcast camera is pointing somewhere sensible — only a picture does.
//
// It drives the BUILT bundle over the DevTools protocol rather than `chrome --screenshot`,
// because WebGL frames arrive after the load event under software rasterisation and the
// simple form captures a blank page. It also renders by CALLING the client rather than
// waiting on requestAnimationFrame, which headless Chrome paces unhelpfully or not at all.
//
// Under SwiftShader the SHADING is not representative of a real GPU, but composition,
// silhouette, layout and legibility all are, and those are what these are for.
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argVal = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const outDir = argVal('out', join(tmpdir(), 'touchline-shots'));
const width = Number(argVal('width', '1280'));
const height = Number(argVal('height', '720'));
mkdirSync(outDir, { recursive: true });

const port = 4800 + (process.pid % 200);
const url = `http://localhost:${port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// vite itself rather than `npx vite`: npx forks a grandchild that SIGKILL on the npx process
// never reaches, so every run used to leave a preview server behind.
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

const profile = mkdtempSync(join(tmpdir(), 'touchline-shots-'));
const dbg = 9400 + (process.pid % 300);
const child = spawn(
  findBrowser(),
  [
    '--headless=new',
    `--remote-debugging-port=${dbg}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

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
const consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'exception');
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id: id++, method, params }));
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails));
  return r.result?.value;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(s.data, 'base64'));
  console.log(`  ${file}`);
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

async function boot(query = '') {
  await ev('localStorage.clear()').catch(() => {});
  await send('Page.navigate', { url: url + query });
  for (let i = 0; i < 140 && !(await ev('Boolean(window.__touchline)')); i++) await sleep(250);
  await sleep(1400);
}

/** Pick a club and land on the club screen. */
const startCareer = (tier, index) => ev(`
  (() => {
    const g = window.__touchline;
    const d = g.world.divisions[${tier}];
    const ranked = d.clubIds.map((id) => g.world.clubs[id]).sort((a, b) => b.reputation - a.reputation);
    g.pick(ranked[${index}].id);
    return ranked[${index}].name;
  })()`);

/**
 * Step the live match forward and draw. Rendering is called directly rather than left to
 * requestAnimationFrame, which headless Chrome throttles to nothing in a background tab.
 */
const advanceMatch = (ticks, predicate = null) => ev(`
  (() => {
    const g = window.__touchline;
    const m = g.game;
    const s = m.matchState;
    if (!s) return { ok: false };
    const stop = ${predicate ?? 'null'};
    let n = 0;
    while (n < ${ticks} && !s.finished) {
      m.matchStep();
      n++;
      if (stop && stop(m.matchState)) break;
    }
    m.matchDraw(24);
    return { ok: true, ticks: n, clock: Math.round(m.matchState.clock), score: m.matchState.score };
  })()`);

console.log('capturing:');

// ---- the front door and the inheritance ---------------------------------------------
// Walked with real clicks rather than by calling the client, because the point of these
// five frames is the screens a new player is actually shown, in the order they meet them.
// The rest of the sheet jumps straight to a career; this is the only part of the game a
// player sees exactly once, so it is the part a contact sheet is most likely to miss.
await boot();
await shot('01-menu');

const click = (sel) => ev(`
  (() => {
    const n = document.querySelector(${JSON.stringify(sel)});
    if (!n) return false;
    n.click();
    return true;
  })()`);
/** The last button in the intro card's footer is always Next. */
const introNext = () => ev(`
  (() => {
    const b = [...document.querySelectorAll('.tl-intro-foot button')].pop();
    if (!b) return false;
    b.click();
    return true;
  })()`);

await click('.tl-slot button, .tl-slots button');
await sleep(700);
await shot('01a-letter');

await introNext();
await sleep(500);
await introNext();
await sleep(500);
await introNext();
await sleep(700);
await shot('01b-pick');

// A mid-table club two divisions down: the picker's own copy says a smaller one is a
// longer story, and a frame of the identity screen should show the club that sentence
// is about rather than the richest one on the list.
await ev(`
  (() => {
    const g = window.__touchline;
    const d = g.world.divisions[2];
    const ranked = d.clubIds.map((id) => g.world.clubs[id]).sort((a, b) => b.reputation - a.reputation);
    g.pick(ranked[9].id);
  })()`);
await sleep(700);
await shot('01c-identity');

await introNext();
await sleep(700);
await shot('01d-contract');

// Sign it, and catch the pen mid-stroke — the frame the still sheet exists to check, since
// nothing else in the repo can say whether the signature reads as handwriting.
await click('.tl-intro-card .tl-block');
await sleep(700);
await shot('01e-signing');

// Back to a clean slate: everything below assumes a career entered the ordinary way.
await boot();

// ---- the guided first match, which is what a new player actually sees first ----------
console.log('  (managing ' + (await startCareer(3, 6)) + ')');
await sleep(900);
await shot('02-onboarding');

// ---- the club screen ----------------------------------------------------------------
// Everything below wants the plain interface. The coach dims four fifths of the screen by
// design, so a contact sheet taken through it says nothing about the layout underneath.
await ev('window.__touchline.game.dismissCoach()');
await ev(`window.__touchline.go('squad')`);
await sleep(200);
await ev(`window.__touchline.go('home')`);
await sleep(500);
await shot('03-club');

// ---- squad, tactics, table, fixtures, transfers --------------------------------------
for (const [n, route] of [['04-squad', 'squad'], ['05-tactics', 'tactics'], ['06-table', 'table'],
                          ['07-fixtures', 'fixtures'], ['08-transfers', 'transfers'],
                          ['09-settings', 'settings']]) {
  await ev(`window.__touchline.go('${route}')`);
  await sleep(450);
  await shot(n);
}

// ---- the badge editor ------------------------------------------------------------------
// Six dimensions behind five tabs, and every option in it is a drawing. There is no unit
// test that can look at that, which is exactly what this file is for. Two tabs rather than
// one: shape is the row of silhouettes, colours is the row that has swatches AND crests in
// it and is the busiest thing in the game.
await ev(`window.__touchline.go('settings')`);
await sleep(500);
for (const [n, tabIndex] of [['09a-badge-shape', 0], ['09b-badge-colours', 2]]) {
  await ev(`
    (() => {
      const tabs = document.querySelectorAll('.tl-crest-tab');
      if (tabs[${tabIndex}]) tabs[${tabIndex}].click();
      document.querySelector('.tl-crest-editor')
        ?.scrollIntoView({ block: 'center', behavior: 'instant' });
      return true;
    })()`);
  await sleep(420);
  await shot(n);
}

// ---- a match, watched -----------------------------------------------------------------
await ev(`window.__touchline.go('home')`);
await sleep(300);
await ev(`window.__touchline.watch()`);
await sleep(2200);
await shot('10-kickoff');

{
  const r = await advanceMatch(2600);
  if (r && r.ok) console.log(`  (match at ${Math.floor(r.clock / 60)}min, ${r.score.home}-${r.score.away})`);
  await shot('11-match');
}

// ---- the two break screens, and the substitution -----------------------------------
// These are the panels a player meets at the end of every match they watch, and they used
// to be captured by nothing: the sheet only opens from inside the frame loop.
await ev(`document.querySelector('.tl-strip .tl-chip').click()`);
await sleep(600);
await shot('11a-substitution');
await ev(`document.querySelector('.tl-sheet-head .tl-btn').click()`);
await sleep(300);

await ev(`window.__touchline.matchBreak('half')`);
await sleep(600);
await shot('11b-half-time');
await ev(`document.querySelector('.tl-sheet-foot .tl-primary').click()`);
await sleep(300);

await ev(`
  (() => {
    const g = window.__touchline.game;
    for (let i = 0; i < 80000 && g.matchState && !g.matchState.finished; i++) g.matchStep();
    g.matchDraw(8);
  })()`);
await sleep(900);
await shot('11c-full-time');
await ev(`document.querySelector('.tl-sheet-foot .tl-primary')?.click()`);
await sleep(400);

// ---- the club screen with a match RUNNING behind it ------------------------------------
// The other half of a Back button that does not end the match: leaving has to leave you
// somewhere that can still see it. Nothing else in this sheet captures the live card, the
// 2D diagram in it, or the button that reads WATCH LIVE rather than START.
await ev(`window.__touchline.go('home')`);
await sleep(300);
await ev(`window.__touchline.watch()`);
await sleep(1800);
await advanceMatch(3400);
await ev(`window.__touchline.leave()`);
await sleep(700);
await shot('11d-live-card');

// And what it becomes when the match finishes while the player is somewhere else.
await ev(`
  (() => {
    const g = window.__touchline.game;
    for (let i = 0; i < 90000 && g.matchState && !g.matchState.finished; i++) g.matchStep();
    return true;
  })()`);
await sleep(900);
await shot('11e-full-time-card');
await ev(`window.__touchline.go('home')`);

// ---- a phone, portrait ----------------------------------------------------------------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(700);
await shot('12-match-phone');

await ev(`window.__touchline.leave && window.__touchline.leave()`).catch(() => {});
for (const [n, route] of [['13-club-phone', 'home'], ['14-squad-phone', 'squad'],
                          ['15-tactics-phone', 'tactics'], ['16-table-phone', 'table'],
                          ['17-settings-phone', 'settings']]) {
  await ev(`window.__touchline.go('${route}')`);
  await sleep(520);
  await shot(n);
}

// The badge editor at 390px, which is the width it is most likely to be wrong at: a 112px
// preview and five tabs beside it is a two-column layout on a screen with room for one.
// `17-settings-phone` shows the top of that page and stops well above this.
await ev(`
  (() => {
    document.querySelector('.tl-crest-editor')
      ?.scrollIntoView({ block: 'start', behavior: 'instant' });
    return true;
  })()`);
await sleep(420);
await shot('17a-badge-phone');

// ---- a small laptop, where the nav labels drop and the dashboard is one column --------
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
await ev(`window.__touchline.go('home')`);
await sleep(600);
await shot('18-club-narrow');

if (consoleErrors.length) {
  console.error('\nconsole errors during capture:');
  for (const e of consoleErrors) console.error('  ' + e);
  process.exit(1);
}
console.log(`\n${outDir}`);
process.exit(0);
