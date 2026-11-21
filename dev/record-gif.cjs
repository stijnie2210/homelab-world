const { writeFileSync } = require('node:fs');
const { chromium } = require('playwright');
const [, , outDir, url] = process.argv;
const FPS = 15, SECONDS = 10, TICKS_PER_FRAME = 4;

function virtualTime(epoch) {
  let now = 0, seq = 0, frames = [];
  const timers = new Map();
  const RealDate = Date;
  window.Date = class extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(epoch + now);
    }
    static now() {
      return epoch + now;
    }
  };
  performance.now = () => now;
  const add = (fn, delay, every) => {
    const id = ++seq;
    timers.set(id, { fn, at: now + Math.max(0, delay || 0), every: every ? Math.max(1, delay || 0) : 0, seq: id });
    return id;
  };
  window.setTimeout = (fn, delay) => add(fn, delay, false);
  window.setInterval = (fn, delay) => add(fn, delay, true);
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (fn) => frames.push(fn);
  window.__tick = (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) {
        if (t.at <= end && (!next || t.at < next.t.at || (t.at === next.t.at && t.seq < next.t.seq))) next = { id, t };
      }
      if (!next) break;
      now = next.t.at;
      if (next.t.every) {
        next.t.at += next.t.every;
        next.t.seq = ++seq;
      } else {
        timers.delete(next.id);
      }
      next.t.fn();
    }
    now = end;
    const due = frames;
    frames = [];
    for (const fn of due) fn(now);
  };
}

function seededRandom(seed) {
  let s = seed;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 1 });
  await page.addInitScript(seededRandom, 20261121);
  await page.addInitScript(virtualTime, Date.parse('2026-11-21T20:18:00'));
  await page.goto(url);

  const tick = 1000 / FPS / TICKS_PER_FRAME;
  const run = (ms) => page.evaluate(([count, tick]) => {
    for (let i = 0; i < count; i++) window.__tick(tick);
  }, [Math.round(ms / tick), tick]);

  await run(4000);
  await page.evaluate(() => {
    const first = buildings.find((b) => b.c.project === 'immich');
    cam.target = cam.x = Math.max(0, Math.min(cam.max, first.x - 70));
    cam.manualUntil = 1e12;
    setInterval(() => {
      for (const b of buildings) {
        if (b.name === 'jellyfin') b.c.netTx = 3e6;
        if (b.name === 'seerr') { b.c.netRx = 60e3; b.c.cpu = 4; }
      }
    }, 100);
  });
  await run(1500);

  for (let i = 0; i < FPS * SECONDS; i++) {
    if (i === 12) await page.evaluate(() => onEvent({ name: 'prowlarr', action: 'start' }));
    if (i === 40) await page.evaluate(() => { dropQueue += 60; dropRate = dropQueue / 3; });
    if (i === 85) await page.evaluate(() => onEvent({ name: 'immich_redis', action: 'oom' }));
    await run(1000 / FPS);
    const png = await page.evaluate(() => display.toDataURL('image/png').split(',')[1]);
    writeFileSync(`${outDir}/f${String(i).padStart(4, '0')}.png`, Buffer.from(png, 'base64'));
  }
  await browser.close();
})();
