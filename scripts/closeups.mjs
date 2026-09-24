// Close-ups of the match: players, keeper, ball and a stride filmstrip.
//
//   node scripts/closeups.mjs [--out=DIR] [--ball=18] [--night] [--only=a,b]
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
//
// shots.mjs frames the match from where the broadcast camera sits, which is forty metres
// from the nearest player — a distance at which a knee, a boot, a haircut and a stride are
// all one pixel. This one parks the camera by hand (RenderClient.setDebugView) beside the
// player on the ball, so the models and the animation can be judged at all.
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argVal = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const outDir = argVal('out', join(tmpdir(), 'touchline-closeups'));
const width = Number(argVal('width', '1280'));
const height = Number(argVal('height', '720'));
mkdirSync(outDir, { recursive: true });

// Clear of 5173+, where vite dev servers for other projects live.
const port = 6100 + (process.pid % 200);
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
// never reaches, and every run of this script used to leave a preview server behind.
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
const ballStyle = Number(argVal('ball', '18'));
const forceTier = argVal('tier', '');
const night = args.includes('--night');
const onlyArg = argVal('only', '');
const want = (n) => !onlyArg || onlyArg.split(',').some((o) => n.startsWith(o));

await boot();
console.log('  (managing ' + (await startCareer(0, 0)) + ')');
await sleep(600);
await ev(`window.__touchline.dismissCoach && window.__touchline.dismissCoach()`).catch(() => {});
await ev(`window.__touchline.world.look.ball = ${ballStyle}`);
await ev(`window.__touchline.watch()`);
await sleep(1500);
if (forceTier) await ev(`window.__touchline.game.matchRenderer.applyTier(${forceTier})`);
// Freeze the live loop: at 14x it would move everybody on between aiming and the shutter.
await ev(`window.__touchline.game.matchPause(true)`);
if (night) {
  await ev(`window.__touchline.conditions({ sky: 'clear', wetness: 0.2, windX: 0, windY: 0, timeOfDay: 0.8, floodlit: true })`);
}
// Hide the HUD: these frames are about the pitch.
await ev(`(() => { const s = document.createElement('style'); s.textContent = '.tl-match > *:not(canvas), .tl-hud, .tl-coach, .tl-toast { visibility: hidden !important }'; document.head.append(s); })()`);

/** Step until the ball has a carrier moving at `minSpeed` or better; returns his id. */
const findCarrier = (minSpeed, maxTicks = 3000) => ev(`
  (() => {
    const g = window.__touchline.game;
    for (let n = 0; n < ${maxTicks}; n++) {
      g.matchStep();
      const s = g.matchState;
      const id = s.ball.ownerId;
      if (id < 0) continue;
      const p = [...s.home.players, ...s.away.players].find((q) => q.id === id);
      if (p && p.role !== 'GK' && Math.hypot(p.vx, p.vy) >= ${minSpeed}) return id;
    }
    return -1;
  })()`);

/** Place the camera relative to a figure: `side` metres to his side, `up` high, `ahead` in front. */
const aim = (id, dist, up, angle, fov = 30, lookY = 0.95) => ev(`
  (() => {
    const g = window.__touchline.game;
    const r = g.matchRenderer;
    const s = g.matchState;
    const p = [...s.home.players, ...s.away.players].find((q) => q.id === ${id});
    const at = r.debugFigure(${id});
    if (!at || !p) return false;
    // Scene heading of the figure: sim facing about +X, scene Z = sim Y (see pitch.ts).
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const a = ${angle};
    const dx = fx * Math.cos(a) - fz * Math.sin(a);
    const dz = fx * Math.sin(a) + fz * Math.cos(a);
    r.setDebugView({ pos: [at[0] + dx * ${dist}, ${up}, at[1] + dz * ${dist}], target: [at[0], ${lookY}, at[1]], fov: ${fov} });
    return true;
  })()`);

const draw = (n = 3, alpha = 1) => ev(`(() => { const g = window.__touchline.game; for (let i = 0; i < ${n}; i++) g.matchDrawAt(1/60, ${alpha}); return true; })()`);

// ---- the player on the ball, from four sides ------------------------------------------
if (args.includes('--caps')) {
  console.log(await ev(`(() => { const r = window.__touchline.game.matchRenderer.renderer; const gl = r.getContext(); return JSON.stringify({ webgl2: r.capabilities.isWebGL2, cbf: !!gl.getExtension('EXT_color_buffer_float'), cbhf: !!gl.getExtension('EXT_color_buffer_half_float'), renderer: gl.getParameter(gl.RENDERER) }); })()`));
}
if (args.includes('--audio')) {
  const r = await ev(`(async () => {
    const a = window.__touchline.audio;
    a.start();
    a.setEnabled(true);
    const kinds = ['fire', 'lava', 'ice', 'gold', 'lightning', 'galaxy', 'aurora', 'rainbow', 'plasma', 'blackHole', 'void', null];
    for (const k of kinds) { a.setBallFx(k); a.ballFx(0.9, -0.5); a.kickBall(0.85, 0.3); }
    a.whistle('long'); a.goal(true); a.goal(false); a.nearMiss(); a.save(); a.post(0.2);
    a.update(0.8, 0.6, 0.016);
    await new Promise((res) => setTimeout(res, 1500));
    return 'audio ok';
  })()`);
  console.log('  ' + r);
}
let who = await findCarrier(4);
console.log(`  carrier ${who}`);
if (args.includes('--debug')) {
  console.log(await ev(`(() => { const g = window.__touchline.game; const s = g.matchState; const p = [...s.home.players, ...s.away.players].find((q) => q.id === ${who}); return JSON.stringify({ sim: [p.x, p.y, p.facing], fig: g.matchRenderer.debugFigure(${who}), owner: s.ball.ownerId, ball: [s.ball.x, s.ball.y] }); })()`));
}
const views = [
  ['a-side', 4.2, 1.1, Math.PI / 2],
  ['b-front', 4.6, 1.4, 0.35],
  ['c-back', 4.6, 1.6, Math.PI - 0.4],
  ['d-high', 6.5, 4.5, 1.1],
];
for (const [name, dist, up, ang] of views) {
  if (!want(name)) continue;
  const ok = await aim(who, dist, up, ang);
  await draw(2);
  if (args.includes('--debug')) console.log(ok, await ev(`(() => { const c = window.__touchline.game.matchRenderer.cam.camera; return JSON.stringify([c.position.toArray(), c.getWorldDirection(c.position.clone()).toArray(), c.parent && c.parent.type]); })()`));
  await shot(name);
}

// ---- a stride, as a filmstrip: 12 frames at 60fps, the camera riding along ----------
if (want('e-strip')) {
  who = await findCarrier(5);
  for (let f = 0; f < 12; f++) {
    if (f % 6 === 0 && f > 0) await ev(`window.__touchline.game.matchStep()`);
    await aim(who, 4.2, 1.0, Math.PI / 2, 28);
    await draw(1, (f % 6) / 6);
    await shot(`e-strip-${String(f).padStart(2, '0')}`);
  }
}

// ---- the goalkeeper --------------------------------------------------------------------
if (want('f-keeper')) {
  const gk = await ev(`(() => { const s = window.__touchline.game.matchState; return s.home.players.find((p) => p.role === 'GK' && p.onPitch).id; })()`);
  await aim(gk, 5, 1.3, 0.6);
  await draw(2);
  await shot('f-keeper');
}

// ---- a shot, and the ball in flight ------------------------------------------------------
// Six interpolated frames per simulation tick is real-time pacing (a tick is 0.1s), which is
// what a trail needs to build: it is a history of frames, and one frame has no history.
if (want('g-shot')) {
  const got = await ev(`
    (() => {
      const g = window.__touchline.game;
      for (let n = 0; n < 20000; n++) {
        g.matchStep();
        const b = g.matchState.ball;
        if (b.ownerId < 0 && Math.hypot(b.vx, b.vy) > 16) return true;
      }
      return false;
    })()`);
  if (got) {
    const chase = (ticks, side, back, up) => ev(`
      (() => {
        const g = window.__touchline.game;
        const r = g.matchRenderer;
        for (let t = 0; t < ${ticks}; t++) {
          if (t > 0) g.matchStep();
          for (let f = 0; f < 6; f++) {
            const b = g.matchState.ball;
            const v = Math.hypot(b.vx, b.vy) || 1;
            const sx = b.x - 52.5, sz = b.y - 34;
            r.setDebugView({ pos: [sx - b.vx / v * ${back} + b.vy / v * ${side}, b.z + ${up}, sz - b.vy / v * ${back} - b.vx / v * ${side}], target: [sx - b.vx / v * 1.2, b.z + 0.2, sz - b.vy / v * 1.2], fov: 42 });
            g.matchDrawAt(1 / 60, f / 6);
          }
        }
        return true;
      })()`);
    await chase(3, 4.5, -1, 1.3);
    await shot('g-shot-0');
    await chase(2, 5.5, 2, 1.8);
    await shot('g-shot-1');
    await chase(2, 1.5, 5, 1.2);
    await shot('g-shot-2');
  }
}

// ---- the ball at rest, close: the halo and the design ------------------------------------
if (want('j-ball')) {
  await ev(`
    (() => {
      const g = window.__touchline.game;
      const b = g.matchState.ball;
      const r = g.matchRenderer;
      const sx = b.x - 52.5, sz = b.y - 34;
      r.setDebugView({ pos: [sx + 1.6, b.z + 0.7, sz + 1.2], target: [sx, b.z + 0.15, sz], fov: 35 });
      for (let f = 0; f < 30; f++) g.matchDrawAt(1 / 60, 1);
      return true;
    })()`);
  await shot('j-ball');
}

// ---- a goal, and what everybody does about it ---------------------------------------------
// The scorer's celebration, his teammates cheering, the other side with their hands on their
// heads. Frames at 0.6s, 1.5s and 2.4s after the ball goes in, at real-time pacing.
if (want('k-goal')) {
  const scorer = await ev(`
    (() => {
      const g = window.__touchline.game;
      const s = g.matchState;
      const all = () => [...s.home.players, ...s.away.players];
      const tally = () => all().map((p) => p.stats.goals);
      let before = tally();
      for (let n = 0; n < 40000 && !s.finished; n++) {
        g.matchStep();
        const now = tally();
        const i = now.findIndex((v, k) => v > before[k]);
        if (i >= 0) return all()[i].id;
        before = now;
      }
      return -1;
    })()`);
  if (scorer >= 0) {
    for (const [k, secs] of [[0, 0.6], [1, 0.9], [2, 0.9]]) {
      // Frame the scorer, wide enough to catch whoever is near him.
      await ev(`
        (() => {
          const g = window.__touchline.game;
          const r = g.matchRenderer;
          const at = r.debugFigure(${scorer});
          if (!at) return false;
          for (let f = 0; f < Math.round(${secs} * 60); f++) {
            r.setDebugView({ pos: [at[0] + 5.5, 2.2, at[1] + 4.5], target: [at[0], 1.0, at[1]], fov: 38 });
            g.matchDrawAt(1 / 60, 1);
          }
          return true;
        })()`);
      await shot(`k-goal-${k}`);
    }
  }
}

// ---- wide, low, pitchside: the stadium ----------------------------------------------------
if (want('h-stadium')) {
  await ev(`window.__touchline.game.matchRenderer.setDebugView({ pos: [-20, 2.2, -40], target: [10, 6, 20], fov: 55 })`);
  await draw(2);
  await shot('h-stadium');
}

await ev(`window.__touchline.game.matchRenderer.setDebugView(null)`);
await draw(30);
await shot('i-broadcast');

if (consoleErrors.length) {
  console.error('console errors:\n  ' + consoleErrors.join('\n  '));
  process.exitCode = 1;
}
console.log('\n' + outDir);
process.exit();
