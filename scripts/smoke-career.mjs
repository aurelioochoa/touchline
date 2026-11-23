// Does the player career work for a kid? Drives the production build (`vite preview` over
// dist/) in Playwright's Chromium with real input:
//
//   1. desktop 1280x720, keyboard only: the career choice, the trial's three moments (aim
//      grid included), the signing, the locker, a week (a kick-about and a played drill),
//      a match with key moments, Next moment, Back into "play the rest for me", the
//      post-match card, then a reload and Continue back into the same career;
//   2. phone 360x780 with touch: the same path by taps, every moment and locker target
//      measured at 56px or more on the narrowest phone the design names;
//   3. inside an iframe with the site's exact /play/[id] sandbox: start, a trial moment by
//      keyboard, and the save written;
//   4. every string blanked (?blank=1): the trial, a week and a match with moments, and
//      every control still has an icon (design player-career §11).
//
// Fails on any console error, page error, failed or external request, or a stage canvas
// that is one flat colour. Every wait is a deadline with polling, never a fixed sleep.
// Screenshots go to /tmp/touchline-shots (or $SHOTS), outside the zero-asset source tree.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const port = 4800 + (process.pid % 300);
const base = `http://localhost:${port}/`;
const shots = process.env.SHOTS ?? '/tmp/touchline-shots/';
mkdirSync(shots, { recursive: true });

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL: ${message}`);
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(check, milliseconds, label) {
  const deadline = Date.now() + milliseconds;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await wait(40);
  }
  throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}

const server = spawn(process.execPath, [`${root}node_modules/vite/bin/vite.js`, 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

function watch(page, tag) {
  page.on('console', (message) => {
    if (message.type() === 'error') fail(`[${tag}] console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => fail(`[${tag}] page error: ${error.message}`));
  page.on('requestfailed', (request) => fail(`[${tag}] request failed: ${request.url()}`));
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('blob:')) fail(`[${tag}] external request: ${url}`);
  });
}

/** Standard deviation of a screenshot's luminance: 0 means one flat colour. */
async function spread(page) {
  const url = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 160, 90);
    const pixels = context.getImageData(0, 0, 160, 90).data;
    let sum = 0;
    let squares = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = 0.3 * pixels[index] + 0.59 * pixels[index + 1] + 0.11 * pixels[index + 2];
      sum += luminance;
      squares += luminance * luminance;
    }
    const count = pixels.length / 4;
    return Math.sqrt(squares / count - (sum / count) ** 2);
  }, url);
}

/** A screenshot once frames are quick again: software GL can stall after a scene is torn down. */
async function shot(page, name, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await until(() => page.evaluate(() => new Promise((resolve) => {
      const start = performance.now();
      requestAnimationFrame(() => resolve(performance.now() - start < 150));
    })), 30000, `a settled frame for ${name}`);
    // Entrance animations finished, or the picture is of cards half faded in.
    await until(() => page.evaluate(() => document.getAnimations()
      .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)), 5000, `animations settled for ${name}`).catch(() => {});
    try {
      await page.screenshot({ path: `${shots}${name}.png`, timeout: 20000, ...options });
      return;
    } catch (error) {
      console.warn(`[shot] ${name}: ${error.message.split('\n')[0]}, retrying`);
    }
  }
  fail(`screenshot ${name} never completed`);
}

/**
 * Low graphics everywhere: this harness is about input, and software GL cannot screenshot the
 * full match crowd reliably. The look is the job of scripts/shots.mjs and screens.mjs.
 */
const lowGraphics = (context) => context.addInitScript(() => {
  localStorage.setItem('touchline:prefs', JSON.stringify({ quality: 'low', crowd3d: 'off', stadiumFx: false }));
});

const hero = (frame) => frame.evaluate(() => {
  const world = window.__touchline.world;
  const record = world.hero;
  if (!record) return null;
  const player = world.players[record.playerId];
  return { ...record, apps: player.season.apps, clubId: player.clubId, age: player.age };
});
const visible = (frame, selector) => frame.evaluate((query) =>
  [...document.querySelectorAll(query)].some((node) => node.getClientRects().length > 0), selector);

/** The smallest moment or locker target on screen, in CSS px. */
const smallestTarget = (frame, selector) => frame.evaluate((query) => {
  let smallest = Infinity;
  for (const node of document.querySelectorAll(query)) {
    const box = node.getBoundingClientRect();
    if (box.width === 0) continue;
    smallest = Math.min(smallest, box.width, box.height);
  }
  return smallest;
}, selector);

/** After Next moment: the next key moment, or full time if none came. */
const momentOrFullTime = (page) => until(async () => {
  if (await visible(page, '.tl-moment-opt')) return 'moment';
  return (await visible(page, '.tl-post-score')) ? 'finished' : null;
}, 15000, 'a key moment or full time').catch(async (error) => {
  const state = await page.evaluate(() => {
    const live = window.__touchline.game.career.liveMatch;
    return live && { clock: live.state.clock, finished: live.state.finished, pad: !!live.momentPad, overlays: document.querySelectorAll('.tl-overlay, .tl-celebrate').length };
  });
  await page.screenshot({ path: `${shots}failure.png` }).catch(() => {});
  throw new Error(`${error.message}; match: ${JSON.stringify(state)}`);
});

/** Walk the moment's options with the arrow key until one of `kind` has focus. */
async function focusKind(page, frame, kind) {
  for (let step = 0; step < 12; step++) {
    const current = await frame.evaluate(() => document.activeElement?.className ?? '');
    if (current.includes(`kind-${kind}`)) return true;
    await page.keyboard.press('ArrowRight');
  }
  return false;
}

/** Answer whatever moment is up by keyboard: shoot when the goal is offered, else pass. */
async function answerByKeys(page, frame) {
  await until(() => visible(frame, '.tl-moment-opt'), 20000, 'a key moment');
  if (await focusKind(page, frame, 'shoot')) {
    await page.keyboard.press('Enter');
    await until(() => visible(frame, '.tl-aim'), 3000, 'the aim grid');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    return 'shoot';
  }
  if (await focusKind(page, frame, 'pass')) {
    await page.keyboard.press('Enter');
    return 'pass';
  }
  await page.keyboard.press('KeyA');
  return 'auto';
}

/** Play the trial through by keyboard until the signing screen. */
async function trialByKeys(page, frame, tag) {
  let answered = 0;
  while (!(await visible(frame, '.tl-signing'))) {
    if (await visible(frame, '.tl-moment-opt')) {
      if (answered === 0) await shot(page, `${tag}-trial`);
      const kind = await answerByKeys(page, frame);
      answered++;
      if (answered === 1 && kind === 'shoot') console.log(`[${tag}] trial: first moment shot through the aim grid`);
      await until(async () => !(await visible(frame, '.tl-moment-opt')) || (await visible(frame, '.tl-signing')), 5000, 'the moment to close');
    }
    if (answered > 12) throw new Error(`${tag}: the trial never ended`);
    await wait(60);
  }
  return answered;
}

try {
  await until(async () => (await fetch(base)).ok, 20000, 'vite preview');

  // ---- 1. desktop, keyboard only ---------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await lowGraphics(context);
    const page = await context.newPage();
    watch(page, 'desktop');
    await page.goto(`${base}?seed=4242`);
    await until(() => visible(page, '.tl-slot'), 15000, 'the menu');
    await page.locator('.tl-slot .tl-slot-go').first().focus();
    await page.keyboard.press('Enter');
    await until(() => visible(page, '.tl-career-choice'), 3000, 'the career choice');
    await shot(page, 'desktop-choice');
    await page.locator('.tl-career-card.is-player').focus();
    await page.keyboard.press('Enter');
    await until(() => visible(page, '.tl-stage canvas'), 5000, 'the training stage');
    const deviation = await until(async () => {
      const value = await spread(page);
      return value > 12 ? value : 0;
    }, 15000, 'a painted training ground');
    console.log(`[desktop] training ground painted, luminance spread ${deviation.toFixed(1)}`);
    const moments = await trialByKeys(page, page, 'desktop');
    console.log(`[desktop] trial finished after ${moments} moments by keyboard`);
    await shot(page, 'desktop-signing');
    await page.locator('.tl-sign-go').focus();
    await page.keyboard.press('Enter');
    const signed = await until(() => hero(page), 3000, 'a signed hero');
    if (signed.age !== 16) fail(`desktop: the hero should be 16, is ${signed.age}`);
    await until(() => visible(page, '.tl-peg'), 3000, 'the locker');
    const rings = await page.locator('.tl-ring').count();
    if (rings !== 3) fail(`desktop: the locker should show three rings, shows ${rings}`);
    await shot(page, 'desktop-locker');

    // A week: a kick-about, then a played drill of Hoops by keys.
    await page.locator('.tl-week-slot:not(.is-used)').first().focus();
    await page.keyboard.press('Enter');
    await until(() => visible(page, '.tl-activity-grid'), 3000, 'the activities');
    await page.locator('.tl-activity').nth(2).focus();
    await page.keyboard.press('Enter');
    await until(async () => (await hero(page)).week.length === 1, 2000, 'a kick-about in the week');
    await page.locator('.tl-week-slot:not(.is-used)').first().focus();
    await page.keyboard.press('Enter');
    await until(() => visible(page, '.tl-activity-grid'), 3000, 'the activities again');
    await page.locator('.tl-activity').first().focus();
    await page.keyboard.press('Enter');
    await until(() => visible(page, '.tl-drill-row'), 3000, 'the drills');
    await page.locator('.tl-drill-row .tl-primary').first().focus();
    await page.keyboard.press('Enter');
    for (let attempt = 0; attempt < 5; attempt++) {
      await until(() => visible(page, '.tl-moment-opt.kind-shoot'), 10000, `hoops shot ${attempt + 1}`);
      if (attempt === 0) await shot(page, 'desktop-hoops');
      if (!(await focusKind(page, page, 'shoot'))) throw new Error('hoops: the goal never took focus');
      await page.keyboard.press('Enter');
      await page.keyboard.press(attempt % 2 ? 'ArrowLeft' : 'ArrowRight');
      if (attempt === 0) await shot(page, 'desktop-aim');
      await page.keyboard.press('Enter');
      await until(async () => !(await visible(page, '.tl-aim')), 3000, 'the strike');
    }
    await until(() => visible(page, '.tl-stars'), 8000, 'the drill stars');
    await page.keyboard.press('Enter');
    const afterDrill = await hero(page);
    if (afterDrill.week.length !== 2 || afterDrill.stars.length !== 1) fail(`desktop: the drill should fill a slot and score, got ${JSON.stringify(afterDrill.week)}`);

    // Matchday: key moments by keys, Next moment, then Back and "play the rest for me". A
    // late substitute can reach full time without a qualifying touch, so a match that ends
    // first is followed by the next fixture.
    let answered = 0;
    for (let match = 0; match < 3 && answered === 0; match++) {
      await page.locator('.tl-career-go .tl-primary').focus();
      await page.keyboard.press('Enter');
      await until(() => visible(page, '.tl-career-match canvas'), 8000, 'the career match');
      let finished = false;
      for (let moment = 0; moment < 2 && !finished; moment++) {
        await page.keyboard.press('KeyN');
        finished = (await momentOrFullTime(page)) === 'finished';
        if (finished) break;
        if (answered === 0) await shot(page, 'desktop-match-moment');
        await answerByKeys(page, page);
        answered++;
        await until(async () => !(await visible(page, '.tl-moment-opt')), 3000, 'the match to run on');
      }
      if (!finished) {
        await page.keyboard.press('Escape');
        await until(() => visible(page, '.tl-overlay .tl-sheet'), 3000, 'the leave sheet');
        await page.locator('.tl-overlay .tl-sheet-foot .tl-btn').nth(1).focus();
        await page.keyboard.press('Enter');
      }
      await until(() => visible(page, '.tl-post-score'), 15000, 'the post-match card');
      if (answered > 0) await shot(page, 'desktop-post-match');
      await page.keyboard.press('Enter');
    }
    if (answered === 0) fail('desktop: three matches and not one key moment');
    console.log(`[desktop] answered ${answered} key moments in the match by keyboard`);
    const afterMatch = await hero(page);
    if (afterMatch.week.length !== 0) fail('desktop: the week should reset after the match');
    const played = await page.evaluate(() => window.__touchline.world.fixtures.filter((fixture) => fixture.played).length);
    if (played === 0) fail('desktop: the fixture should be played');

    await page.reload();
    await until(() => visible(page, '.tl-menu-continue'), 10000, 'Continue after a reload');
    await shot(page, 'desktop-menu');
    await page.locator('.tl-menu-continue').focus();
    await page.keyboard.press('Enter');
    await until(() => visible(page, '.tl-peg'), 5000, 'the same locker after a reload');
    const reloaded = await hero(page);
    if (reloaded.number !== signed.number || reloaded.apps !== afterMatch.apps) fail('desktop: the career did not survive a reload');
    console.log('[desktop] trial, signing, week, drill, match and reload all by keyboard');
    await context.close();
  }

  // ---- 2. phone, touch -------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await lowGraphics(context);
    const page = await context.newPage();
    watch(page, 'phone');
    await page.goto(`${base}?seed=777`);
    await until(() => visible(page, '.tl-slot'), 15000, 'the phone menu');
    await page.locator('.tl-slot .tl-slot-go').first().tap();
    await until(() => visible(page, '.tl-career-choice'), 3000, 'the phone career choice');
    await page.locator('.tl-career-card.is-player').tap();
    let taps = 0;
    while (!(await visible(page, '.tl-signing'))) {
      if (await visible(page, '.tl-moment-opt')) {
        const smallest = await smallestTarget(page, '.tl-moment-opt');
        if (smallest < 56) fail(`phone: a moment target is ${smallest}px`);
        if (taps === 0) await shot(page, 'phone-trial');
        if (await visible(page, '.tl-moment-opt.kind-shoot')) {
          await page.locator('.tl-moment-opt.kind-shoot').tap();
          await until(() => visible(page, '.tl-aim'), 3000, 'the phone aim grid');
          const zone = page.locator('.tl-aim-zone').nth(taps % 2 ? 0 : 2);
          await zone.tap();
          if (taps === 0) await shot(page, 'phone-aim');
          await zone.tap();
        } else {
          await page.locator('.tl-moment-opt.kind-pass, .tl-moment-opt.kind-dribble').first().tap();
        }
        taps++;
        await until(async () => !(await visible(page, '.tl-moment-opt')) || (await visible(page, '.tl-signing')), 5000, 'the phone moment to close');
      }
      if (taps > 12) throw new Error('phone: the trial never ended');
      await wait(60);
    }
    await shot(page, 'phone-signing');
    await page.locator('.tl-pick').nth(1).tap();
    await page.locator('.tl-sign-go').tap();
    await until(() => visible(page, '.tl-peg'), 3000, 'the phone locker');
    const lockerSmallest = await smallestTarget(page, '.tl-locker .tl-btn');
    if (lockerSmallest < 56) fail(`phone: a locker control is ${lockerSmallest}px`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) fail(`phone: the locker is ${overflow}px wider than the screen`);
    await shot(page, 'phone-locker');
    await page.locator('.tl-week-slot:not(.is-used)').first().tap();
    await page.locator('.tl-activity').nth(3).tap();
    await until(async () => (await hero(page)).week.length === 1, 2000, 'an extra session in the week');
    let reached = false;
    for (let match = 0; match < 3 && !reached; match++) {
      await page.locator('.tl-career-go .tl-primary').tap();
      await until(() => visible(page, '.tl-career-match canvas'), 8000, 'the phone match');
      await page.locator('.tl-next-moment').tap();
      reached = (await momentOrFullTime(page)) === 'moment';
      if (!reached) await page.locator('.tl-overlay .tl-sheet-foot .tl-btn').tap();
    }
    if (!reached) throw new Error('phone: three matches and not one key moment');
    const matchSmallest = await smallestTarget(page, '.tl-moment-opt');
    if (matchSmallest < 56) fail(`phone: a match moment target is ${matchSmallest}px`);
    await shot(page, 'phone-match-moment');
    await page.locator('.tl-moment-opt.kind-auto').tap();
    await until(async () => !(await visible(page, '.tl-moment-opt')), 3000, 'the phone match to run on');
    await page.locator('.tl-hud .tl-btn[aria-label]').last().tap();
    await until(() => visible(page, '.tl-overlay .tl-sheet'), 3000, 'the phone leave sheet');
    await page.locator('.tl-overlay .tl-sheet-foot .tl-btn').nth(1).tap();
    await until(() => visible(page, '.tl-post-score'), 15000, 'the phone post-match card');
    await shot(page, 'phone-post-match');
    console.log(`[phone] trial (${taps} taps), signing, week and a match by touch; targets >= 56px at 360px`);
    await context.close();
  }

  // ---- 3. inside the site's sandboxed iframe -----------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await lowGraphics(context);
    const page = await context.newPage();
    watch(page, 'iframe');
    await page.route('**/__host.html', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><body style="margin:0;background:#222"><iframe id="game" src="${base}?seed=99" style="border:0;width:1280px;height:720px"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals" allow="fullscreen; autoplay; gamepad"></iframe></body>`,
    }));
    await page.goto(`${base}__host.html`);
    const frame = await until(() => page.frame({ url: (url) => url.href.includes('seed=99') }), 10000, 'the game frame');
    await until(() => visible(frame, '.tl-slot'), 15000, 'the framed menu');
    await frame.locator('.tl-slot .tl-slot-go').first().click();
    await frame.locator('.tl-career-card.is-player').click();
    await trialByKeys(page, frame, 'iframe');
    await frame.locator('.tl-sign-go').click();
    await until(() => frame.evaluate(() => localStorage.getItem('touchline:save-active') !== null), 3000, 'a save in the frame');
    await shot(page, 'iframe-locker');
    console.log('[iframe] boots, plays the trial by keyboard and saves inside the /play sandbox');
    await context.close();
  }

  // ---- 4. every string blanked ---------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await lowGraphics(context);
    const page = await context.newPage();
    watch(page, 'blank');
    await page.goto(`${base}?blank=1&seed=5`);
    await until(() => visible(page, '.tl-slot'), 15000, 'the blank menu');
    await page.locator('.tl-slot .tl-slot-go').first().click();
    await page.locator('.tl-career-card.is-player').click();
    await trialByKeys(page, page, 'blank');
    const iconless = async (selector) => page.evaluate((query) => [...document.querySelectorAll(query)].filter((node) => !node.querySelector('svg') && !node.textContent.trim()).length, selector);
    if (await iconless('.tl-signing button')) fail('blank: a signing button has neither icon nor text');
    await page.locator('.tl-sign-go').click();
    await until(() => visible(page, '.tl-peg'), 3000, 'the blank locker');
    if (await iconless('.tl-locker button')) fail('blank: a locker button has neither icon nor text');
    await page.locator('.tl-week-slot:not(.is-used)').first().click();
    await page.locator('.tl-activity').nth(1).click();
    await page.locator('.tl-week-slot:not(.is-used)').first().click();
    await page.locator('.tl-activity').first().click();
    await page.locator('.tl-drill-row .tl-btn:not(.tl-primary)').first().click();
    await until(async () => (await hero(page)).week.length === 2, 2000, 'a blank week');
    await shot(page, 'blank-locker');
    await page.locator('.tl-career-go .tl-primary').click();
    await until(() => visible(page, '.tl-career-match canvas'), 8000, 'the blank match');
    await page.keyboard.press('KeyN');
    if ((await momentOrFullTime(page)) === 'finished') {
      await page.keyboard.press('Enter');
      await page.locator('.tl-career-go .tl-primary').click();
      await page.keyboard.press('KeyN');
      await until(() => visible(page, '.tl-moment-opt'), 15000, 'a blank key moment in the next match');
    }
    if (await iconless('.tl-moment button')) fail('blank: a moment button has neither icon nor text');
    await answerByKeys(page, page);
    await page.keyboard.press('Escape');
    await page.locator('.tl-overlay .tl-sheet-foot .tl-btn').nth(1).click();
    await until(() => visible(page, '.tl-post-score'), 15000, 'the blank post-match card');
    console.log('[blank] the trial, a week and a match with a moment, every string blank');
    await context.close();
  }
} catch (error) {
  fail(error.message);
} finally {
  await browser.close().catch(() => {});
  server.kill('SIGKILL');
}

if (failures.length) {
  console.error(`\nsmoke: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`\nsmoke: OK (screenshots in ${shots})`);
