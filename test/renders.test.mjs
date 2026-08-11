/**
 * Does the built application actually render?
 *
 * ─── Why this test exists ────────────────────────────────────────────────────────────────
 *
 * Every other test in this suite imports a module and calls it. Not one of them loads the BUILD in
 * a browser, and so all 165 of them passed green while theunivers.ai served a blank white page for
 * two days: a `const` helper in src/main.jsx was used one line above its declaration, which throws
 * "Cannot access 'named' before initialization" at module load — before React mounts, before an
 * error boundary can catch anything. Every module was correct. Their ORDER was not.
 *
 * The checks that missed it are worth naming, because each one looked like verification:
 *   - `npm test` — passes, because no test evaluates main.jsx as a browser would.
 *   - `vite build` — succeeds, because use-before-declaration is legal to BUNDLE; it only throws
 *     when it RUNS.
 *   - HTTP 200 on `/` — the server serves index.html perfectly. index.html is not the app.
 *   - Matching bundle hashes — proves the right bytes arrived, never that they work. This is the
 *     trap: the hash matched exactly BECAUSE the same broken file was already there.
 *
 * So this test does the only thing that answers the question: it runs the real bundle in a real
 * browser and looks at whether anything appeared. It asserts almost nothing about the markup —
 * a test that pins the DOM would break on every redesign. Blank versus not-blank is the whole
 * assertion, because blank is the failure that shipped.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Chrome is a DEVELOPMENT dependency of this test only — never of the server, which stays
 * zero-dependency. Where no browser exists the test FAILS rather than skips: a silent skip on the
 * one test that checks the page is not blank would reproduce exactly the false confidence above.
 * Set ALLOW_NO_BROWSER=1 to downgrade that to a skip on a machine that genuinely has no Chrome.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

/** Where Chrome lives on the platforms this is run on. First hit wins. */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chrome = () => CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};

/**
 * Serve dist/ the way production does — including the SPA fallback, so a deep link is tested as a
 * deep link rather than as a 404.
 */
function serveDist() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = normalize(join(DIST, url));
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Load `url` in headless Chrome and return the rendered DOM plus anything it logged. */
function render(bin, url, ms = 45_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, [
      '--headless=new', '--no-sandbox',
      // The landing page IS a WebGL scene, so render it with a software GL implementation rather
      // than passing --disable-gpu. Otherwise the only thing this test proves about the page a
      // visitor actually lands on is that three.js knows how to complain.
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      // Give lazy chunks time to resolve without waiting on wall-clock: Chrome fast-forwards its
      // own timers, so this is a budget for the page's work, not a sleep.
      '--virtual-time-budget=8000',
      '--enable-logging=stderr', '--v=0',
      // A STABLE profile directory, reused between runs. A fresh one makes Chrome redo first-run
      // setup on every launch, which took over two minutes here — long enough to trip the timeout
      // below and report "chrome timed out" in place of the page error this test exists to show.
      // A timeout that hides the failure is worse than no test.
      `--user-data-dir=${join(process.env.TMPDIR ?? '/tmp', 'theunivers-render-test-profile')}`,
      '--dump-dom', url,
    ]);
    let dom = '', log = '', settled = false;

    /*
     * Resolve on the OUTPUT, not on the process exiting.
     *
     * `--dump-dom` prints the serialised DOM and then, on this Chrome, keeps the process alive
     * indefinitely. Waiting for 'close' therefore always hit the timeout — and reported "chrome
     * timed out" while the answer was sitting complete in stdout. So: once the document is closed,
     * give stderr a moment to flush whatever the page logged, then take what we have and kill it.
     */
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill('SIGKILL');
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error('chrome timed out')), ms);

    proc.stdout.on('data', (d) => {
      dom += d;
      if (dom.includes('</html>')) setTimeout(() => finish(resolve, { dom, log }), 700);
    });
    proc.stderr.on('data', (d) => { log += d; });
    proc.on('error', (e) => finish(reject, e));
    proc.on('close', () => finish(resolve, { dom, log }));
  });
}

/**
 * Console errors only. Chrome's own GPU/crashpad/keychain noise is not the page's fault, and
 * neither is a WebGL context that a headless software renderer declines to give us — three.js
 * LOGS that and carries on, so it says something about this machine, not about the build.
 *
 * Keep this list narrow and specific. Every pattern added here is a class of failure the test can
 * no longer see, so a filter is a decision to stop looking — never a way to get to green.
 */
const pageErrors = (log) => log.split('\n')
  .filter((l) => /CONSOLE|Uncaught|SyntaxError|ReferenceError|TypeError/.test(l))
  .filter((l) => !/gpu|vulkan|dbus|fontconfig|crashpad|DevTools|RLZ|process_mac/i.test(l))
  .filter((l) => !/WebGL context could not be created|Could not create a WebGL context/i.test(l))
  // Messages tagged `[.WebGL-0x…]` come from the GL DRIVER, not from JavaScript. Under swiftshader
  // they report limitations of the software rasteriser — glBlitFramebuffer refusing a shared
  // depth-stencil image is one a real GPU performs without comment. A JS exception thrown from
  // three.js is not tagged this way and still fails the test.
  .filter((l) => !/\[\.WebGL-0x[0-9a-f]+\]/i.test(l));

/**
 * An address that matches no route must still say something.
 *
 * react-router renders NOTHING when nothing matches, which produces the identical empty <div
 * id="root"> that a crash produces — so a typo is indistinguishable from the site being down. This
 * was found by opening a URL that had never existed while verifying the crash fix.
 */
test('an unknown address shows a page rather than nothing', async (t) => {
  const bin = chrome();
  if (!bin) {
    if (process.env.ALLOW_NO_BROWSER) return t.skip('no Chrome, ALLOW_NO_BROWSER set');
    assert.fail('no Chrome found — this test cannot verify the page is not blank without one');
  }

  const server = await serveDist();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { dom, log } = await render(bin, base + '/no-such-page-exists-here');
    const mounted = /<div id="root">([\s\S]*)<\/div>/.exec(dom)?.[1]?.trim() ?? '';

    assert.equal(pageErrors(log).length, 0, `the page logged errors:\n${pageErrors(log).join('\n')}`);
    assert.ok(mounted.length > 50, 'an unmatched route rendered nothing — add a path="*" route');
    // Not just "some markup": it has to actually tell the visitor what happened.
    assert.match(
      mounted.replace(/<[^>]+>/g, ' '),
      /nothing at this address/i,
      'the catch-all rendered, but does not say the address is unknown',
    );
  } finally {
    server.close();
  }
});

test('the built page renders something and logs no errors', async (t) => {
  if (!existsSync(join(DIST, 'index.html'))) {
    assert.fail('dist/ is missing — run `npm run build` before the tests that check the build');
  }

  /*
   * A STALE dist is the quiet version of this whole bug: the suite goes green against bytes built
   * before the change that broke things, which is indistinguishable from passing. So compare what
   * was built against what exists, and refuse to report on the wrong artefact.
   */
  const built = statSync(join(DIST, 'index.html')).mtimeMs;
  const newest = (dir) => {
    let t = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
    }
    return t;
  };
  const srcTime = newest(new URL('../src/', import.meta.url).pathname);
  assert.ok(
    srcTime <= built,
    'dist/ is older than src/ — this would test bytes that are no longer the code. Run `npm run build`.',
  );
  const bin = chrome();
  if (!bin) {
    if (process.env.ALLOW_NO_BROWSER) return t.skip('no Chrome, ALLOW_NO_BROWSER set');
    assert.fail('no Chrome found — this test cannot verify the page is not blank without one');
  }

  const server = await serveDist();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { dom, log } = await render(bin, base + '/');

    const mounted = /<div id="root">([\s\S]*)<\/div>/.exec(dom)?.[1]?.trim() ?? '';
    const errs = pageErrors(log);

    // The error goes first: "root is empty" is the symptom, and the console line is the cause.
    // Reporting the symptom alone is what turns a five-minute fix into an afternoon.
    assert.equal(errs.length, 0, `the page logged errors:\n${errs.join('\n')}`);
    assert.ok(
      mounted.length > 50,
      `#root is empty — the application did not mount. Nothing was logged, so suspect a route ` +
      `that renders null rather than a crash.`,
    );
  } finally {
    server.close();
  }
});
