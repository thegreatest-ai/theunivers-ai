#!/usr/bin/env node
/**
 * fly-spend — what theunivers.ai costs on Fly, and where it is heading.
 *
 *   node scripts/fly-spend.mjs              report to the terminal
 *   node scripts/fly-spend.mjs --dashboard  also write docs/spend.html
 *   node scripts/fly-spend.mjs --budget 15  warn above USD 15/month
 *
 * ─── Where these numbers come from, and how much to trust each one ───────────────────────
 *
 * Fly does NOT expose spending through its API. Introspecting the Organization type returns 35
 * fields, of which four concern billing — `billable`, `billingStatus`, `isCreditCardSaved` and
 * `creditBalance` — and only the last carries a number, which is credit remaining, not spend.
 * There is no invoice or usage field. Their Prometheus endpoint needs org-scoped permission that
 * a standard CLI token does not carry.
 *
 * So this tool prices your real inventory against Fly's published rate card:
 *
 *   EXACT      compute, volumes, certificates, IPs — fixed monthly rates for things `fly` lists,
 *              so these are arithmetic, not estimates
 *   MEASURED   egress, counted by the app itself (server/metrics.mjs). Under-reports slightly,
 *              because Fly meters at its edge including TLS framing the origin never sees
 *   UNKNOWABLE anything Fly charges that is not visible from inventory
 *
 * It is a well-founded projection, not an invoice. The authority is always
 * https://fly.io/dashboard → Billing, and this file says so in its own output rather than
 * letting a confident-looking number imply more than it knows.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = join(ROOT, 'data', 'spend-history.json');

/* ── Fly's published rates, checked against fly.io/docs/about/pricing on 2026-08-10 ──────
 * Hard-coded deliberately: a tracker that silently re-reads a moving price gives you a number
 * that changed for reasons you cannot see. When Fly changes prices, edit this block and the
 * date, so a diff shows exactly what moved and when. */
const RATES_CHECKED = '2026-08-10';

/** Named CPU/RAM presets, USD per month. */
const PRESETS = {
  'shared-1-256': 2.02, 'shared-1-512': 3.32, 'shared-1-1024': 5.92, 'shared-1-2048': 11.11,
  'shared-2-512': 4.04, 'shared-2-1024': 6.64, 'shared-2-2048': 11.83, 'shared-2-4096': 22.22,
  'shared-4-1024': 8.08, 'shared-4-2048': 13.27, 'shared-4-4096': 23.66, 'shared-4-8192': 44.44,
  'shared-6-1536': 12.11, 'shared-6-3072': 19.90, 'shared-6-6144': 35.49,
};
const RAM_PER_GB = 5.00;          // "plus about $5 per 30 days per GB of additional RAM"
const VOLUME_PER_GB = 0.15;
const CERT_SINGLE = 0.10;
const CERT_WILDCARD = 1.00;
const DEDICATED_IPV4 = 2.00;

/** Egress bands. Region matters: bom is in Fly's most expensive band, 6x North America. */
const EGRESS = {
  'na-eu': 0.02,
  'apac-oce-sa': 0.04,
  'africa-india': 0.12,
};
const REGION_BAND = {
  bom: 'africa-india', del: 'africa-india', jnb: 'africa-india',
  sin: 'apac-oce-sa', nrt: 'apac-oce-sa', hkg: 'apac-oce-sa', syd: 'apac-oce-sa',
  gru: 'apac-oce-sa', scl: 'apac-oce-sa',
};
const bandFor = (region) => REGION_BAND[region] ?? 'na-eu';

/* ── helpers ───────────────────────────────────────────────────────────────────────────── */

const usd = (n) => `$${n.toFixed(2)}`;
const gb = (bytes) => bytes / 1024 ** 3;

/** Pick a unit that shows the number instead of rounding it to zero. */
const size = (bytes) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
  : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
  : `${(bytes / 1024).toFixed(1)} KB`;

function fly(args) {
  try {
    return JSON.parse(execFileSync('fly', [...args, '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch {
    return null;   // billing lapsed, not logged in, no network — handled by the caller
  }
}

/** Read a key from .env without pulling in a dependency for six lines of parsing. */
function fromEnvFile(key) {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) return null;
  const m = readFileSync(f, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

/* ── 1. inventory, priced ──────────────────────────────────────────────────────────────── */

function priceCompute(machines) {
  return machines.map((m) => {
    const g = m.config?.guest ?? {};
    const cpus = g.cpus ?? 1;
    const mb = g.memory_mb ?? 256;
    const kind = g.cpu_kind ?? 'shared';
    const key = `${kind}-${cpus}-${mb}`;

    // Fall back to the documented formula when a preset is not in the table, rather than
    // reporting zero — a missing rate must never look like a free machine.
    let rate = PRESETS[key];
    let exact = true;
    if (rate == null) {
      const base = PRESETS[`${kind}-${cpus}-256`] ?? 2.02;
      rate = base + Math.max(0, (mb - 256) / 1024) * RAM_PER_GB;
      exact = false;
    }

    // A stopped machine bills only for its storage, not CPU/RAM.
    const running = m.state === 'started';
    return {
      name: m.name, region: m.region, size: `${kind}-cpu-${cpus}x ${mb}MB`,
      state: m.state, monthly: running ? rate : 0, rateIfRunning: rate, exact,
    };
  });
}

function gather() {
  const machines = fly(['machines', 'list']) ?? [];
  const volumes = fly(['volumes', 'list']) ?? [];
  const certs = fly(['certs', 'list']) ?? [];
  const ips = fly(['ips', 'list']) ?? [];

  const compute = priceCompute(machines);
  const vols = volumes.map((v) => ({
    name: v.name, gb: v.size_gb ?? 0, monthly: (v.size_gb ?? 0) * VOLUME_PER_GB,
  }));
  const certLines = certs.map((c) => ({
    hostname: c.hostname,
    monthly: String(c.hostname).startsWith('*.') ? CERT_WILDCARD : CERT_SINGLE,
  }));
  const ipLines = ips
    .filter((i) => String(i.Type ?? i.type ?? '') === 'v4')       // dedicated v4 only; shared is free
    .map((i) => ({ address: i.Address ?? i.address, monthly: DEDICATED_IPV4 }));

  const region = compute[0]?.region ?? 'bom';
  return { compute, vols, certLines, ipLines, region, reachable: machines.length > 0 };
}

/* ── 2. measured egress, from the app's own counters ───────────────────────────────────── */

async function fetchEgress() {
  const token = process.env.METRICS_TOKEN ?? fromEnvFile('METRICS_TOKEN');
  // Deliberately NOT .env BASE_URL — that points at localhost during development, and a dev
  // server's counters would price traffic Fly never carried. Override with SITE_URL only.
  const base = process.env.SITE_URL ?? 'https://theunivers.ai';
  if (!token) {
    return { ok: false, why: 'METRICS_TOKEN not set — add it to .env and `fly secrets set` it' };
  }
  try {
    const r = await fetch(`${base}/api/metrics?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ok: false, why: `metrics endpoint returned ${r.status}` };
    const d = await r.json();
    return { ok: true, ...d };
  } catch (e) {
    return { ok: false, why: `could not reach ${base}: ${e.message}` };
  }
}

/* ── 3. assemble ───────────────────────────────────────────────────────────────────────── */

function creditBalance() {
  try {
    // Note: `fly auth token` prints a deprecation notice to stderr, which we discard. The
    // suggested replacement, `fly tokens create`, MINTS A NEW TOKEN on every call — wrong for a
    // read, and it would litter the account with credentials once a day.
    const token = execFileSync('fly', ['auth', 'token'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n').pop();
    const out = execFileSync('curl', [
      '-s', 'https://api.fly.io/graphql', '-H', `Authorization: Bearer ${token}`,
      '-H', 'content-type: application/json', '-d',
      JSON.stringify({ query: '{ organizations { nodes { slug creditBalance billingStatus } } }' }),
    ], { encoding: 'utf8' });
    const n = JSON.parse(out).data?.organizations?.nodes?.[0];
    return n ? { credit: (n.creditBalance ?? 0) / 100, status: n.billingStatus } : null;
  } catch { return null; }
}

async function snapshot() {
  const inv = gather();
  const eg = await fetchEgress();

  const fixed =
    inv.compute.reduce((s, c) => s + c.monthly, 0) +
    inv.vols.reduce((s, v) => s + v.monthly, 0) +
    inv.certLines.reduce((s, c) => s + c.monthly, 0) +
    inv.ipLines.reduce((s, i) => s + i.monthly, 0);

  const band = bandFor(inv.region);
  const rate = EGRESS[band];

  // Project egress from the observed daily average rather than the raw total: a counter that has
  // been running two days must not be read as a monthly figure.
  let egressMonthly = 0, gbPerDay = 0, daysObserved = 0;
  if (eg.ok && Array.isArray(eg.daily) && eg.daily.length) {
    daysObserved = eg.daily.length;
    const totalGb = gb(eg.daily.reduce((s, d) => s + d.bytes_out, 0));
    gbPerDay = totalGb / daysObserved;
    egressMonthly = gbPerDay * 30 * rate;
  }

  return {
    at: new Date().toISOString(),
    region: inv.region, band, egressRate: rate,
    reachable: inv.reachable,
    compute: inv.compute, volumes: inv.vols, certs: inv.certLines, ips: inv.ipLines,
    fixedMonthly: fixed,
    egress: {
      ok: eg.ok, why: eg.why ?? null,
      requests: eg.requests ?? 0, bytesOut: eg.bytesOut ?? 0,
      daysObserved, gbPerDay, monthly: egressMonthly, daily: eg.daily ?? [],
    },
    totalMonthly: fixed + egressMonthly,
    billing: creditBalance(),
    ratesChecked: RATES_CHECKED,
  };
}

/* ── 4. history ────────────────────────────────────────────────────────────────────────── */

function appendHistory(snap) {
  mkdirSync(dirname(HISTORY), { recursive: true });
  const prev = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, 'utf8')) : [];
  // One row per day: re-running the tracker replaces today rather than inflating the series.
  const day = snap.at.slice(0, 10);
  const kept = prev.filter((p) => p.at.slice(0, 10) !== day);
  const next = [...kept, snap].slice(-400);
  writeFileSync(HISTORY, JSON.stringify(next, null, 2));
  return next;
}

/* ── 5. report ─────────────────────────────────────────────────────────────────────────── */

function report(snap, history, budget) {
  const L = [];
  const line = (s = '') => L.push(s);

  line();
  line('  FLY SPEND — theunivers.ai');
  line('  ' + '─'.repeat(62));

  if (!snap.reachable) {
    line('  ⚠  Could not read inventory from Fly.');
    line('     Usually billing (trial ended / card declined) or not logged in.');
    line('     Check: fly status');
    line();
    return L.join('\n');
  }

  line();
  line('  FIXED — arithmetic from real inventory, not estimates');
  for (const c of snap.compute) {
    const note = c.state === 'started' ? '' : `  (${c.state} — not billed for CPU/RAM)`;
    line(`    ${c.size.padEnd(26)} ${usd(c.monthly).padStart(8)}${note}`);
    if (!c.exact) line('      ↑ preset not in the rate table; priced by the RAM formula');
  }
  for (const v of snap.volumes) line(`    volume ${v.name} ${v.gb}GB`.padEnd(30) + usd(v.monthly).padStart(8));
  for (const c of snap.certs) line(`    cert ${c.hostname}`.padEnd(30) + usd(c.monthly).padStart(8));
  for (const i of snap.ips) line(`    dedicated IPv4 ${i.address}`.padEnd(30) + usd(i.monthly).padStart(8));
  line('    ' + '─'.repeat(34));
  line('    subtotal'.padEnd(30) + usd(snap.fixedMonthly).padStart(8));

  line();
  line(`  EGRESS — measured at the origin · ${snap.region} is band "${snap.band}" @ $${snap.egressRate}/GB`);
  if (!snap.egress.ok) {
    line(`    unavailable: ${snap.egress.why}`);
    line('    (fixed costs above are still exact; only this line is missing)');
  } else if (snap.egress.daysObserved === 0) {
    line('    no traffic recorded yet — counters start at the next deploy');
  } else {
    const e = snap.egress;
    line(`    ${e.requests.toLocaleString()} requests · ${size(e.bytesOut)} over ${e.daysObserved} day(s)`);
    line(`    ${size(e.bytesOut / e.daysObserved)}/day → ${size((e.bytesOut / e.daysObserved) * 30)}/month`);
    line('    projected'.padEnd(30) + usd(e.monthly).padStart(8));
  }

  line();
  line('  ' + '─'.repeat(62));
  line('  PROJECTED MONTHLY'.padEnd(32) + usd(snap.totalMonthly).padStart(8));
  if (snap.billing) {
    line(`  credit remaining ${usd(snap.billing.credit)} · billing ${snap.billing.status}`);
  }

  if (budget != null) {
    const pct = (snap.totalMonthly / budget) * 100;
    const bar = '█'.repeat(Math.min(30, Math.round(pct / 100 * 30))).padEnd(30, '·');
    line();
    line(`  BUDGET ${usd(budget)}/mo   ${bar} ${pct.toFixed(0)}%`);
    if (pct >= 100) line('  ⚠  OVER BUDGET');
    else if (pct >= 80) line('  ⚠  approaching budget');
  }

  if (history.length > 1) {
    const first = history[0], prev = history[history.length - 2];
    const d = snap.totalMonthly - prev.totalMonthly;
    const arrow = d > 0.005 ? `▲ ${usd(d)}` : d < -0.005 ? `▼ ${usd(-d)}` : 'unchanged';
    line();
    line(`  TREND  ${history.length} snapshots since ${first.at.slice(0, 10)} · since last run: ${arrow}`);
  }

  line();
  line(`  Rates checked ${snap.ratesChecked}. This is a projection from inventory, not an invoice.`);
  line('  Fly is the authority: https://fly.io/dashboard → Billing');
  line();
  return L.join('\n');
}

/* ── main ──────────────────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const budgetArg = args.indexOf('--budget');
const budget = budgetArg >= 0 ? Number(args[budgetArg + 1]) : null;

const snap = await snapshot();
const history = appendHistory(snap);

if (args.includes('--json')) {
  console.log(JSON.stringify({ current: snap, history }, null, 2));
} else {
  console.log(report(snap, history, budget));
}

if (args.includes('--dashboard')) {
  const { writeDashboard } = await import('./spend-dashboard.mjs');
  const out = writeDashboard(snap, history, budget);
  console.log(`  Dashboard written: ${out}\n`);
}
