// Does the built bundle actually work?
//
//   node scripts/smoke.mjs
//
// Drives the production build over the DevTools protocol through a whole career turn: new
// world, pick a club, every screen, a watched match, a save, a reload, and the same career
// still there. It FAILS ON ANY CONSOLE ERROR, because the site's js_error telemetry will
// surface them from production and it is much cheaper to catch them here
// (SHIP-CHECKLIST §2).
//
// It also runs the game with every string blanked (`?blank=1`) and checks the matchday
// path still works, which is the mechanism behind design §11's wordless claim.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 4600 + (process.pid % 200);
const url = `http://localhost:${port}/`;

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
});

const profile = mkdtempSync(join(tmpdir(), 'touchline-smoke-'));
const dbg = 9600 + (process.pid % 300);
const child = spawn(findBrowser(), [
  '--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  '--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
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
if (!page) throw new Error('browser never exposed a page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 1;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params?.exceptionDetails?.exception?.description ?? 'uncaught exception');
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push((m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id: id++, method, params }));
  });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails));
  }
  return r.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');

/**
 * Wait for a match to actually be live, rather than sleeping a round number and hoping.
 *
 * `watch()` builds a Three.js scene before `matchState` exists, and how long that takes
 * depends on what else the machine is doing. The fixed 1200ms this replaced passed four
 * runs in five and failed the fifth on the blank-strings pass — which is the worst kind of
 * red there is: real-looking, unreproducible, and in a check that everyone then learns to
 * re-run instead of read.
 */
const awaitMatch = async (ms = 10000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // A match that is RUNNING, not merely a `matchState` that exists: the previous match's
    // finished state is still on the client when the next one is asked for, so "exists"
    // would return the moment it was called and prove nothing.
    const running = await ev(`
      (() => {
        const s = window.__touchline.game.matchState;
        return Boolean(s) && !s.finished;
      })()`);
    if (running) return true;
    await sleep(120);
  }
  return false;
};

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
};

async function boot(query = '') {
  await send('Page.navigate', { url: url + query });
  for (let i = 0; i < 140 && !(await ev('Boolean(window.__touchline)')); i++) await sleep(250);
  await sleep(1200);
}

console.log('smoke:');

// ---- a new career boots ---------------------------------------------------------
await ev('localStorage.clear()').catch(() => {});
await boot();
check('the game boots', await ev('Boolean(window.__touchline)'));
check('a world is generated', (await ev('window.__touchline.world.clubs.length')) === 100);
check('the boot flash is removed', !(await ev('Boolean(document.getElementById("boot-flash"))')));
// The front door comes first now: three save slots, none of them filled on a cold boot.
check('the main menu is the first screen', (await ev('document.querySelectorAll(".tl-slot").length')) === 3);
check(
  'a cold boot offers no career to continue',
  !(await ev('Boolean(document.querySelector(".tl-menu-continue"))')),
);

// ---- the inheritance intro -------------------------------------------------------
// A new career opens on the letter, not on the club list. Walk it the way a player does,
// by pressing the buttons: this is the only coverage the story, the badge editor and the
// contract get, and every one of them can break without a single test noticing.
await ev('window.__touchline.startNew(0)');
await sleep(450);
check('a new career opens on the letter', await ev('Boolean(document.querySelector(".tl-letter"))'));
// The TEXT, not just the element. `t()` returns the key itself when it misses, so a
// mistyped prefix renders "letter1.title" on screen and every structural check still
// passes — which is exactly what happened.
const letterTitle = await ev('document.querySelector(".tl-letter h2").textContent');
check(
  'and the letter is written in words, not keys',
  typeof letterTitle === 'string' && !letterTitle.includes('.') && letterTitle.length > 4,
  letterTitle,
);

const introNext = () => ev(`
  (() => {
    const b = document.querySelector('.tl-intro-foot [data-nav="next"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
/** The Back button, on the steps that have one. */
const introBack = () => ev(`
  (() => {
    const b = document.querySelector('.tl-intro-foot [data-nav="back"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);

await introNext();
await sleep(220);
// Back re-reads the letter you just left. Checked on the TITLE rather than on the dots,
// because a Back button that renders the right step with the wrong content is the way
// this breaks and the dots would not show it.
await introBack();
await sleep(220);
check(
  'a letter can be read again',
  (await ev('document.querySelector(".tl-letter h2").textContent')) === letterTitle,
);
await introNext();
await sleep(220);
for (let i = 0; i < 2; i++) {
  await introNext();
  await sleep(220);
}
check('the club picker is shown', (await ev('document.querySelectorAll(".tl-club-card").length')) > 50);

// ---- picking a club and walking every screen -------------------------------------
await ev('window.__touchline.pick(window.__touchline.world.divisions[2].clubIds[4])');
await sleep(400);
check('a club can be chosen', (await ev('window.__touchline.world.managedClubId')) >= 0);
check('choosing a club leads to making it yours',
  await ev('Boolean(document.querySelector(".tl-crest-editor"))'));

// Rename it, recolour it, and take a different shape — the whole point of the screen.
//
// The badge editor is tabbed now (shape, pattern, colours, symbol, extras), so the controls
// have to be reached the way a kid reaches them: open the tab, then press the thing.
const tab = (i) => ev(`document.querySelectorAll('.tl-crest-tab')[${i}].click()`);
await ev(`
  (() => {
    const inputs = [...document.querySelectorAll('.tl-input')];
    const set = (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(inputs[0], 'Ada Vance');
    set(inputs[1], 'Alfred Rovers');
    set(inputs[2], 'ALF');
    return true;
  })()`);
await sleep(160);
await tab(0);
await sleep(120);
await ev(`document.querySelectorAll('.tl-crest-option')[2].click()`);
await sleep(160);
check('a shape can be chosen', (await ev('window.__touchline.world.crest.shape')) === 2);

// The colours live behind their own tab, and so do the swatch marks the next check reads.
await tab(2);
await sleep(140);
await ev(`document.querySelectorAll('.tl-swatch')[3].click()`);
await sleep(140);

// Surprise me changes the colours AND the badge, and marks the swatches it chose. A
// randomiser that moved the crest and left the tick behind shipped once.
const snapshot = `
  (() => {
    const w = window.__touchline.world;
    const c = w.clubs[w.managedClubId];
    return {
      a: c.kitPrimary, b: c.kitSecondary,
      crest: JSON.stringify(w.crest),
      on: document.querySelectorAll('.tl-swatch.on').length,
    };
  })()`;
const kitBefore = await ev(snapshot);
let surprised = null;
for (let i = 0; i < 12 && !surprised; i++) {
  await ev(`document.querySelector('.tl-crest-stage button').click()`);
  await sleep(110);
  const now = await ev(snapshot);
  // A random pick can legitimately land on what was already there, so it is pressed until
  // something moves rather than once — twelve tries against a 1-in-12 palette.
  if (now.a !== kitBefore.a || now.b !== kitBefore.b || now.crest !== kitBefore.crest) surprised = now;
}
check('Surprise me picks a whole identity', Boolean(surprised));
check(
  'and the swatches follow it',
  Boolean(surprised) && surprised.a !== surprised.b && surprised.on === 2,
  surprised ? `${surprised.on} swatches marked` : 'never changed',
);

// Put the deliberate choices back, so the checks below still test what they say they do.
await ev(`document.querySelectorAll('.tl-swatch')[3].click()`);
await sleep(120);
await tab(0);
await sleep(120);
await ev(`document.querySelectorAll('.tl-crest-option')[2].click()`);
await sleep(200);

const identity = await ev(`
  (() => {
    const w = window.__touchline.world;
    const c = w.clubs[w.managedClubId];
    return { manager: w.managerName, club: c.name, short: c.short, shape: w.crest.shape };
  })()`);
check('the club takes the name it was given', identity.club === 'Alfred Rovers', identity.club);
check('and the manager takes theirs', identity.manager === 'Ada Vance', identity.manager);
check('and a chosen badge sticks', identity.shape === 2, `shape ${identity.shape}`);

// On to the contract, and sign it.
await introNext();
await sleep(300);
check('the contract is offered', await ev('Boolean(document.querySelector(".tl-contract"))'));

// Back out of the contract and come straight back in. The badge screen is the one a kid
// second-guesses, and this is the path they take to do it.
await introBack();
await sleep(260);
check('the contract can be backed out of, to change the badge',
  await ev('Boolean(document.querySelector(".tl-crest-editor"))'));
await introNext();
await sleep(260);

await ev(`document.querySelector('.tl-contract ~ button, .tl-intro-card .tl-block').click()`);
// The signature runs for a second and a half and the career opens on a timer at the end
// of it. Everything in the footer is pressed during that beat: a Back that re-rendered
// the badge screen here would be replaced by the career a moment later, which is a
// screen changing under a kid's hands for no reason they can see.
await sleep(200);
await ev(`
  (() => {
    for (const b of document.querySelectorAll('.tl-intro-foot button')) b.click();
    return true;
  })()`);
await sleep(200);
check('signing cannot be interrupted by the buttons around it',
  await ev('Boolean(document.querySelector(".tl-contract"))'));
await sleep(2200);
check('signing it starts the career', await ev('Boolean(document.querySelector(".tl-nav"))'));
check(
  'and the career kept the identity through the save',
  (await ev('window.__touchline.world.clubs[window.__touchline.world.managedClubId].name')) === 'Alfred Rovers',
);

for (const route of ['squad', 'tactics', 'table', 'fixtures', 'transfers', 'home']) {
  await ev(`window.__touchline.go('${route}')`);
  await sleep(260);
  const panels = await ev('document.querySelectorAll("#main .tl-card").length');
  check(`the ${route} screen renders`, panels > 0, `${panels} panels`);
}

// ---- a watched match --------------------------------------------------------------
await ev(`window.__touchline.go('home')`);
await sleep(200);
await ev('window.__touchline.watch()');
const live = await awaitMatch();
await sleep(400);
check('a match starts', live);
const ticked = await ev(`
  (() => {
    const g = window.__touchline.game;
    for (let i = 0; i < 3000; i++) g.matchStep();
    g.matchDraw(4);
    return { tick: g.matchState.tick, clock: g.matchState.clock };
  })()`);
check('the match simulates', ticked.tick > 2000, `${Math.floor(ticked.clock / 60)} minutes played`);
check('the squad strip renders', (await ev('document.querySelectorAll(".tl-chip").length')) === 11);

// Play it out and leave.
await ev(`
  (() => {
    const g = window.__touchline.game;
    let n = 0;
    while (!g.matchState.finished && n < 90000) { g.matchStep(); n++; }
    g.matchDraw(2);
    return true;
  })()`);
await sleep(600);
check('the match reaches full time', await ev('window.__touchline.game.matchState.finished'));

// Full time arrives on its own — the frame loop notices `finished` and opens it — so the
// check is that it DID, not that it can be forced. Neither this screen nor half time had
// any coverage before: the harness used to leave through the Back button's own path, which
// button's path and never opens either one.
const fullTime = await ev(`
  (() => {
    const s = document.querySelector('.tl-sheet');
    if (!s) return null;
    return {
      hasScore: /\\d+[^0-9]{1,3}\\d+/.test(s.textContent),
      bars: s.querySelectorAll('.tl-sheet-body i').length,
      button: !!s.querySelector('.tl-sheet-foot .tl-primary'),
    };
  })()`);
check('full time opens by itself with the score and the shape of the match',
  !!fullTime && fullTime.hasScore && fullTime.bars >= 8 && fullTime.button,
  fullTime ? `${fullTime.bars} bars` : 'no sheet');

// The one button out of it goes back to the club — design §8's "no dead ends".
await ev(`document.querySelector('.tl-sheet-foot .tl-primary').click()`);
await sleep(600);
check('full time leads back to the club', (await ev('document.querySelectorAll("#main .tl-card").length')) > 0);

// Half time needs a match that is still running, so it gets its own.
await ev(`window.__touchline.game.continueDay()`);
await sleep(300);
await ev(`window.__touchline.watch()`);
await awaitMatch();
await sleep(300);
await ev(`
  (() => {
    const g = window.__touchline.game;
    for (let i = 0; i < 28000 && !g.matchState.finished; i++) g.matchStep();
    return true;
  })()`);
await ev(`window.__touchline.matchBreak('half')`);
await sleep(500);
const halfTime = await ev(`
  (() => {
    const s = document.querySelector('.tl-sheet');
    if (!s) return null;
    return { stats: s.querySelectorAll('.tl-stat').length, buttons: s.querySelectorAll('.tl-sheet-foot button').length };
  })()`);
check('half time shows the match so far and two ways on',
  !!halfTime && halfTime.stats >= 4 && halfTime.buttons >= 2,
  halfTime ? `${halfTime.stats} stats, ${halfTime.buttons} buttons` : 'no sheet');
await ev(`document.querySelector('.tl-sheet-foot .tl-primary').click()`);
await sleep(300);

// ---- Back leaves the match RUNNING ----------------------------------------------------
//
// The single most important assertion in this file. Back used to play the fixture out with
// runToEnd(), record the result and advance the calendar, so a kid who tapped it to glance
// at the table had silently fast-forwarded ninety minutes with no way back. Navigation and
// simulation are now separate things, and these four checks are what says so.
const dayBefore = await ev('window.__touchline.world.day');
await ev('window.__touchline.leave()');
await sleep(500);
const left = await ev(`
  (() => {
    const g = window.__touchline;
    const w = g.world;
    const mine = w.fixtures.filter((f) => f.homeId === w.managedClubId || f.awayId === w.managedClubId);
    return {
      onClub: document.querySelectorAll('#main .tl-card').length > 0,
      stillLive: Boolean(g.game.matchState) && !g.game.matchState.finished,
      attached: g.attached(),
      unplayed: mine.filter((f) => !f.played).length,
      day: w.day,
      liveCard: Boolean(document.querySelector('#main .tl-pill.live')),
      minimaps: document.querySelectorAll('#main .tl-minimap canvas').length,
    };
  })()`);
check('Back returns to the club screen', left.onClub);
check('Back does NOT end the match', left.stillLive && !left.attached,
  left.stillLive ? 'still running, detached' : 'the match was destroyed');
check('Back does not advance the calendar', left.day === dayBefore, `day ${left.day}`);
check('the club screen shows the match live', left.liveCard && left.minimaps > 0,
  `${left.minimaps} minimap(s)`);

// And it keeps going while the player is on another screen. Simulation ticks are
// monotonic; the displayed clock rewinds from stoppage time to 45:00 at half time.
const kept = await ev(`
  (() => {
    const g = window.__touchline;
    const before = g.game.matchState.tick;
    for (let i = 0; i < 600; i++) g.game.matchStep();
    return { before, after: g.game.matchState.tick };
  })()`);
check('the match keeps playing behind the club screen', kept.after > kept.before,
  `tick ${kept.before} to ${kept.after}`);

// Going back to it must not build a second match.
await ev('window.__touchline.watchLive()');
await sleep(400);
check('Watch live returns to the same match', await ev('window.__touchline.attached()'));

// Now play it out. A match always finishes — there is no way to abandon one.
await ev(`
  (() => {
    const g = window.__touchline.game;
    for (let i = 0; i < 90000 && g.matchState && !g.matchState.finished; i++) g.matchStep();
    return true;
  })()`);
await sleep(600);
await ev(`
  (() => {
    const b = document.querySelector('.tl-sheet-foot .tl-primary');
    if (b) b.click();
    return Boolean(b);
  })()`);
await sleep(500);
check('the club screen comes back', (await ev('document.querySelectorAll("#main .tl-card").length')) > 0);
// Specifically OUR fixture, not just the fifty others played on the same day. Counting all
// of them is what let a real bug through: the debug quit hook closed the match without
// recording the managed club's result, Continue then offered the same match forever, and
// this check still passed because everyone else's results were in.
const own = await ev(`
  (() => {
    const w = window.__touchline.world;
    const mine = w.fixtures.filter((f) => f.homeId === w.managedClubId || f.awayId === w.managedClubId);
    const done = mine.filter((f) => f.played);
    return { total: mine.length, played: done.length, day: w.day };
  })()`);
check('OUR match is recorded, not just the rest of the round', own.played > 0,
  `${own.played} of the club's own ${own.total} fixtures played`);

// A goal that nobody credited to anybody is the shape of the bug this catches: the engine
// used to collect scorers only inside runToEnd's own loop, so a WATCHED match — stepped by
// the match screen instead — produced an empty scorer list and no player ever got a goal.
const credited = await ev(`
  (() => {
    const w = window.__touchline.world;
    const goals = w.players.reduce((n, p) => n + p.season.goals, 0);
    const scored = w.fixtures.filter((f) => f.played).reduce((n, f) => n + f.homeGoals + f.awayGoals, 0);
    return { goals, scored };
  })()`);
check('goals are credited to the players who scored them',
  credited.scored === 0 || credited.goals > 0,
  `${credited.goals} credited against ${credited.scored} scored`);

// And the calendar must move past it rather than offering the same match again.
const advanced = await ev(`
  (() => {
    const g = window.__touchline;
    const before = g.world.day;
    for (let i = 0; i < 12; i++) g.game.continueDay();
    return { before, after: g.world.day };
  })()`);
check('Continue advances past a played match', advanced.after > advanced.before,
  `day ${advanced.before} to ${advanced.after}`);

// ---- the save survives a reload ----------------------------------------------------
const before = await ev(`
  (() => {
    const w = window.__touchline.world;
    return { club: w.managedClubId, day: w.day, played: w.fixtures.filter((f) => f.played).length };
  })()`);
await ev('window.__touchline.game.saveNow()');
await boot();
const after = await ev(`
  (() => {
    const w = window.__touchline.world;
    return { club: w.managedClubId, day: w.day, played: w.fixtures.filter((f) => f.played).length };
  })()`);
check('the career survives a reload', after.club === before.club && after.played === before.played,
  `club ${after.club}, ${after.played} played`);

// ---- a season can be run through -----------------------------------------------------
// Continue deliberately STOPS on the managed club's own fixture and waits to be told
// whether to watch it, so running a season means answering that each time. Quick-resulting
// it is the answer here.
const season = await ev(`
  (() => {
    const g = window.__touchline;
    for (let round = 0; round < 12; round++) {
      for (let i = 0; i < 20; i++) g.game.continueDay();
      g.quick();
    }
    const w = g.world;
    const mine = w.fixtures.filter((f) => (f.homeId === w.managedClubId || f.awayId === w.managedClubId) && f.played);
    return { day: w.day, ourPlayed: mine.length, allPlayed: w.fixtures.filter((f) => f.played).length };
  })()`);
check('a season can be run through', season.day > after.day && season.ourPlayed >= 8,
  `day ${season.day}, ${season.ourPlayed} of our matches played, ${season.allPlayed} in all`);

// ---- and it all works with every string blanked ---------------------------------------
await ev('localStorage.clear()').catch(() => {});
await boot('?blank=1');
// ---- the menu remembers the career -------------------------------------------------
await ev('window.__touchline.game.openMenu()');
await sleep(400);
check(
  'the played career now shows in its slot',
  (await ev('document.querySelectorAll(".tl-slot.filled").length')) === 1,
);
check(
  'and Continue is offered',
  await ev('Boolean(document.querySelector(".tl-menu-continue"))'),
);
const slotText = await ev('document.querySelector(".tl-slot.filled .who b").textContent');
check('the slot is labelled with the club', typeof slotText === 'string' && slotText.length > 2, slotText);

check('it boots with no strings at all', await ev('Boolean(window.__touchline)'));
await ev('window.__touchline.pick(window.__touchline.world.divisions[3].clubIds[2])');
await sleep(400);
await ev('window.__touchline.watch()');
await awaitMatch();
await sleep(300);
const blankOk = await ev(`
  (() => {
    const g = window.__touchline.game;
    if (!g.matchState) return false;
    for (let i = 0; i < 600; i++) g.matchStep();
    g.matchDraw(2);
    return document.querySelectorAll('.tl-chip').length === 11;
  })()`);
check('the matchday path is playable with no words', blankOk);

// ---- the verdict ----------------------------------------------------------------------
if (errors.length) {
  console.error('\nconsole errors:');
  for (const e of errors) console.error('  ' + e);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed, ${errors.length} console errors`);
process.exit(failed.length || errors.length ? 1 : 0);
