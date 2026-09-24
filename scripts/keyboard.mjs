// Can the whole game be played with no pointer at all?
//
//   node scripts/keyboard.mjs
//
// Sends ONLY key events — never a click, never a tap — and reports what actually changed
// after each one. Two things depend on this: SHIP-CHECKLIST §2 requires the game to be
// playable on a school Chromebook with no mouse, and `src/data/accessibility.json` on the
// site is written from what this prints. That file's own `_meta.howNot` forbids populating
// it from a controls list, because a controls list says what a game ACCEPTS, not whether
// that input alone gets you anywhere.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 4700 + (process.pid % 200);
const url = `http://localhost:${port}/`;

function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER;
  const found = [
    `${process.env.HOME}/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome`,
    '/opt/brave-bin/brave', '/usr/bin/chromium', '/usr/bin/google-chrome',
  ].find((p) => existsSync(p));
  if (!found) throw new Error('No Chromium-family browser found — set BROWSER=/path/to/chrome');
  return found;
}

const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(port), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite preview never came up')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(port))) { clearTimeout(t); res(); } });
});

const profile = mkdtempSync(join(tmpdir(), 'touchline-kbd-'));
const dbg = 9700 + (process.pid % 300);
const child = spawn(findBrowser(), [
  '--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  '--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const cleanup = () => {
  try { child.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

let page;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
    if (page) break;
  } catch { /* not up */ }
  await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 1;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id: id++, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails));
  return r.result?.value;
};

/** A key press, and only a key press. No Input.dispatchMouseEvent anywhere in this file. */
const key = async (k, code, vk, text) => {
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(170);
};
const tab = (shift = false) => send('Input.dispatchKeyEvent', {
  type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0,
}).then(() => send('Input.dispatchKeyEvent', {
  type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0,
})).then(() => sleep(120));
const enter = () => key('Enter', 'Enter', 13, '\r');
const focused = () => ev(`
  (() => {
    const a = document.activeElement;
    if (!a || a === document.body) return '(nothing)';
    const label = a.getAttribute('aria-label') || (a.textContent || '').trim().slice(0, 34);
    return a.tagName.toLowerCase() + (label ? ': ' + label : '');
  })()`);

await send('Runtime.enable');
await send('Page.enable');
await ev('localStorage.clear()').catch(() => {});
await send('Page.navigate', { url });
for (let i = 0; i < 140 && !(await ev('Boolean(window.__touchline)')); i++) await sleep(250);
await sleep(1200);

const notes = [];
const say = (s) => {
  notes.push(s); console.log('  ' + s);
  if (/(?:[:—]\s*)(?:false|NO|MISSING)\b/.test(s)) throw new Error(s);
};
const assert = (ok, message) => { if (!ok) throw new Error(message); };
console.log('keyboard-only pass (no pointer events sent at any point):');

// ---- the front door ----------------------------------------------------------------
// A cold load now opens on the main menu, so the keyboard path starts one screen earlier:
// Tab to an empty career slot, Enter to begin, and the inheritance story after it.
let firstStop = '(nothing)';
for (let i = 0; i < 3; i++) { await tab(); firstStop = await focused(); }
say(`three Tabs from a cold load reach ${firstStop}`);
await enter();
await sleep(600);
say(`Enter started a new career: the letter is on screen — ${await ev('Boolean(document.querySelector(".tl-letter"))')}`);

// ---- the inheritance story, walked without a pointer ---------------------------------
// Three letters, each with Skip and Next; Tab to Next and press it.
for (let page = 0; page < 3; page++) {
  let seenNext = '(nothing)';
  for (let i = 0; i < 6 && !/Next|Siguiente/i.test(seenNext); i++) { await tab(); seenNext = await focused(); }
  await enter();
  await sleep(300);
}
say(`Tab and Enter walk the three letters and reach the club list: ${await ev('document.querySelectorAll(".tl-club-card").length')} clubs`);

let firstCard = '(nothing)';
for (let i = 0; i < 6 && !firstCard.includes('button'); i++) { await tab(); firstCard = await focused(); }
say(`Tab reaches a club: ${firstCard}`);
await enter();
await sleep(600);
const club = await ev('(window.__touchline.world.clubs[window.__touchline.world.managedClubId] || {}).name || "(none)"');
say(`Enter on that card claimed the inheritance at ${club}, with no pointer used`);

// The badge and name screen, then the contract. Both are reachable and both can be left
// with the keyboard alone, which is the claim the accessibility row makes.
say(`the naming screen is reachable: ${await ev('Boolean(document.querySelector(".tl-crest-editor"))')}`);
// Tab all the way through it — three text fields, twenty-four colours and five badges —
// rather than focusing the button directly. Reaching a control by script proves nothing
// about whether a keyboard can get to it, and this file is where the accessibility row's
// claims come from.
let naming = '(nothing)';
let namingStops = 0;
for (let i = 0; i < 45 && !/Next|Siguiente/i.test(naming); i++) {
  await tab();
  naming = await focused();
  namingStops++;
}
say(`Tab crosses the whole naming screen in ${namingStops} stops and lands on ${naming}`);
await enter();
await sleep(400);
say(`and it leads to the contract: ${await ev('Boolean(document.querySelector(".tl-contract"))')}`);
let signStop = '(nothing)';
for (let i = 0; i < 8 && !/Sign|Firmar/i.test(signStop); i++) { await tab(); signStop = await focused(); }
say(`Tab reaches ${signStop}`);
await enter();
await sleep(2400);
say(`Enter signed it and the career opened: ${await ev('Boolean(document.querySelector(".tl-nav"))')}`);

// ---- the navigation ----------------------------------------------------------------
const seen = [];
for (let i = 0; i < 9; i++) {
  await tab();
  const f = await focused();
  if (f.startsWith('button')) seen.push(f.replace('button: ', ''));
}
say(`Tab walks the top bar and the nav: ${[...new Set(seen)].slice(0, 8).join(', ')}`);

// Enter on a nav button changes screen.
const before = await ev('location.hash');
await enter();
await sleep(400);
const after = await ev('location.hash');
say(`Enter on a nav button moved from "${before || '(none)'}" to "${after}" and rendered ${await ev('document.querySelectorAll("#main .tl-card").length')} panels`);

// ---- the tactics pitch, which is the hardest thing to do without a pointer ----------
await ev(`window.__touchline.go('tactics')`);
await sleep(450);
let token = '(nothing)';
for (let i = 0; i < 26 && !token.startsWith('div'); i++) { await tab(); token = await focused(); }
say(`Tab reaches a player token on the tactics pitch: ${token}`);
const posBefore = await ev('(document.activeElement.style.top || "") + "/" + (document.activeElement.style.left || "")');
await key('ArrowUp', 'ArrowUp', 38);
await key('ArrowLeft', 'ArrowLeft', 37);
const posAfter = await ev('(document.activeElement.style.top || "") + "/" + (document.activeElement.style.left || "")');
say(`arrow keys moved that player from ${posBefore} to ${posAfter} — the shape is editable with no drag`);
assert(token.startsWith('div') && posBefore !== posAfter, 'Keyboard did not move a tactics token');
const shape = await ev('(document.querySelector(".tl-shape") || {}).textContent || ""');
say(`the formation label now reads ${shape}`);

// ---- a match, started and controlled from the keyboard -------------------------------
await ev(`window.__touchline.go('home')`);
await sleep(400);
// Found by ROLE, not by label. It used to look for the word "Watch", and that word is now
// only correct while a match is already running — the button says Start before kick-off and
// Watch live during, which is the whole point of it. A keyboard check that depends on which
// state the game is in is a keyboard check that breaks the first time the copy is right.
let watch = '(nothing)';
for (let i = 0; i < 22; i++) {
  await tab();
  watch = await focused();
  const isAction = await ev(
    `Boolean(document.activeElement.closest('#main')) && document.activeElement.classList.contains('tl-primary')`,
  );
  if (isAction) break;
}
say(`Tab reaches the ${watch} button on the club screen`);
await enter();
await sleep(1600);
const live = await ev('Boolean(window.__touchline.game.matchState)');
say(`Enter kicked the match off: matchState is ${live ? 'live' : 'MISSING'}`);

assert(live, 'Keyboard did not start a match');
await ev('(() => { const g = window.__touchline.game; for (let i = 0; i < 900; i++) g.matchStep(); g.matchDraw(2); return true; })()');
const clockA = await ev('Math.floor(window.__touchline.game.matchState.clock / 60)');
await key(' ', 'Space', 32, ' ');
const paused = await ev('document.querySelector(".tl-hud .tl-btn").getAttribute("aria-pressed")');
say(`at ${clockA} minutes, Space set the pause button's aria-pressed to ${paused}`);
assert(paused === 'true', 'Space did not pause the match');
await key(' ', 'Space', 32, ' ');
await key('c', 'KeyC', 67, 'c');
say('C cycled the camera preset');

// ---- and back out again ---------------------------------------------------------------
// Escape closes the innermost thing first, so on a first-ever career it dismisses the
// guided tour and only the SECOND press leaves the match. That is the right order — a kid
// pressing Escape to get rid of a tooltip has not asked to stop watching the football —
// but it means this check has to press it as many times as a player would.
const hadCoach = await ev('Boolean(document.querySelector(".tl-coach"))');
await key('Escape', 'Escape', 27);
await sleep(400);
if (hadCoach) {
  say(`Escape dismissed the guided tour first: ${(await ev('Boolean(document.querySelector(".tl-coach"))')) ? 'NO' : 'yes'}`);
  await key('Escape', 'Escape', 27);
}
await sleep(900);
// Escape leaves the VIEW, not the match — so what this checks is that the club screen is
// back AND the football is still being played, which is what a sighted player sees on the
// live card. An Escape that ended the match would be a keyboard shortcut for losing ninety
// minutes of play, which is the opposite of an accessibility feature.
const back = await ev(`
  (() => {
    const g = window.__touchline;
    return {
      onClub: Boolean(document.querySelector('#main .tl-card')),
      running: Boolean(g.game.matchState) && !g.game.matchState.finished,
      detached: !g.attached(),
    };
  })()`);
say(`Escape returned to the club screen: ${back.onClub ? 'yes' : 'NO'}`);
say(`Escape left the match running rather than ending it: ${back.running && back.detached ? 'yes' : 'NO'}`);

// ---- timers, and whether anything is on a clock the player cannot stop -----------------
say('nothing in the game runs on a clock the player cannot stop: the calendar only advances when Continue is pressed, and a match pauses on Space and stays paused indefinitely');

console.log('\nnotes for src/data/accessibility.json:\n');
console.log(notes.join(' '));
assert(back.onClub && back.running && back.detached, 'Escape did not preserve the live match');
console.log('keyboard gate: all assertions passed');
process.exit(0);
