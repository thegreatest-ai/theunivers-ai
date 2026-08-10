/**
 * Renders the spend snapshot as a self-contained HTML page.
 *
 * No external requests of any kind — the data is inlined and the charts are hand-built SVG. That
 * keeps it openable straight off disk, and safe to publish as an artifact where a strict CSP
 * blocks every CDN.
 *
 * Deliberately single-theme dark: it carries theunivers' own palette rather than adapting to the
 * viewer, so the background and every colour are painted explicitly and nothing is inherited.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const usd = (n) => `$${n.toFixed(2)}`;
const size = (b) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB`
  : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB`
  : `${(b / 1024).toFixed(1)} KB`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Sparkline over the snapshot history. Returns '' when there is nothing to plot yet. */
function sparkline(values, w = 640, h = 90) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark" role="img"
         aria-label="Projected monthly cost across ${values.length} snapshots">
      <polyline points="${pts.join(' ')} ${w},${h} 0,${h}" fill="url(#g)" stroke="none"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="#38bdf8" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${w}" cy="${pts[pts.length - 1].split(',')[1]}" r="4" fill="#38bdf8"/>
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity=".26"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
      </linearGradient></defs>
    </svg>`;
}

/** Daily egress bars — the only line that moves with usage, so it gets its own chart. */
function bars(daily) {
  if (!daily.length) return '<p class="muted">No traffic recorded yet.</p>';
  const rows = [...daily].reverse().slice(-30);
  const max = Math.max(...rows.map((d) => d.bytes_out), 1);
  return `<div class="bars">${rows.map((d) => {
    const mb = d.bytes_out / 1024 ** 2;
    const pct = (d.bytes_out / max) * 100;
    return `<div class="bar" title="${esc(d.day)} · ${mb.toFixed(1)} MB · ${d.requests} requests">
              <div class="fill" style="height:${Math.max(2, pct).toFixed(1)}%"></div>
              <span>${esc(d.day.slice(5))}</span>
            </div>`;
  }).join('')}</div>`;
}

export function writeDashboard(snap, history, budget) {
  const lines = [
    ...snap.compute.map((c) => [c.size, c.state === 'started' ? 'running' : c.state, c.monthly]),
    ...snap.volumes.map((v) => [`Volume ${v.name} · ${v.gb}GB`, 'provisioned', v.monthly]),
    ...snap.certs.map((c) => [`Certificate ${c.hostname}`, 'issued', c.monthly]),
    ...snap.ips.map((i) => [`Dedicated IPv4 ${i.address}`, 'allocated', i.monthly]),
  ];

  const pct = budget ? (snap.totalMonthly / budget) * 100 : null;
  const state = pct == null ? null : pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok';

  const html = `<title>Fly spend — theunivers.ai</title>
<style>
  :root{
    --bg:#05060e; --panel:#0b0d1b; --line:rgba(255,255,255,.10);
    --ink:#f2f5ff; --muted:rgba(242,245,255,.52); --faint:rgba(242,245,255,.34);
    --cyan:#38bdf8; --blue:#2e7bff; --purple:#9b5cff;
    --ok:#34d399; --warn:#fbbf24; --bad:#f87171;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    padding:42px 26px 70px}
  .wrap{max-width:940px;margin:0 auto;display:flex;flex-direction:column;gap:26px}
  .eyebrow{font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin:0}
  h1{margin:6px 0 0;font-size:1.5rem;font-weight:600;letter-spacing:-.01em}
  .hero{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px 28px;
    display:flex;flex-wrap:wrap;gap:30px;align-items:flex-end;justify-content:space-between}
  .big{font-size:3.4rem;line-height:1;font-weight:650;font-variant-numeric:tabular-nums;
    background:linear-gradient(96deg,var(--cyan),var(--purple));-webkit-background-clip:text;
    background-clip:text;color:transparent}
  .sub{color:var(--muted);font-size:.86rem;margin-top:8px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px 24px}
  h2{margin:0 0 14px;font-size:.74rem;letter-spacing:.13em;text-transform:uppercase;color:var(--faint);font-weight:600}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
  th,td{text-align:left;padding:9px 0;border-bottom:1px solid var(--line);font-size:.9rem}
  th{color:var(--faint);font-weight:500;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}
  td:last-child,th:last-child{text-align:right}
  tr:last-child td{border-bottom:none}
  .chip{display:inline-block;padding:2px 9px;border-radius:99px;font-size:.68rem;letter-spacing:.05em;
    text-transform:uppercase;border:1px solid var(--line);color:var(--muted)}
  .chip.run{color:var(--ok);border-color:rgba(52,211,153,.35)}
  .total td{border-top:1px solid var(--line);font-weight:650;padding-top:13px}
  .muted{color:var(--muted);font-size:.86rem}
  .spark{width:100%;height:90px;display:block}
  .bars{display:flex;align-items:flex-end;gap:5px;height:130px;overflow-x:auto;padding-top:8px}
  .bar{flex:1;min-width:19px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;
    align-items:center;gap:6px}
  .fill{width:100%;border-radius:4px 4px 0 0;background:linear-gradient(180deg,var(--cyan),rgba(46,123,255,.28))}
  .bar span{font-size:.6rem;color:var(--faint);white-space:nowrap}
  .budget{height:9px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden;margin:12px 0 8px}
  .budget div{height:100%;border-radius:99px;background:var(--ok)}
  .budget.near div{background:var(--warn)} .budget.over div{background:var(--bad)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
  .stat b{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums;font-weight:600}
  .stat span{font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
  footer{color:var(--faint);font-size:.78rem;line-height:1.7;border-top:1px solid var(--line);padding-top:18px}
  .scroll{overflow-x:auto}
</style>
<div class="wrap">
  <header>
    <p class="eyebrow">Fly.io · theunivers.ai · ${esc(snap.region)}</p>
    <h1>Spend tracker</h1>
  </header>

  <div class="hero">
    <div>
      <p class="eyebrow">Projected monthly</p>
      <div class="big">${usd(snap.totalMonthly)}</div>
      <p class="sub">${usd(snap.fixedMonthly)} fixed · ${usd(snap.egress.monthly)} egress${
        snap.billing ? ` · credit ${usd(snap.billing.credit)}` : ''}</p>
    </div>
    <div style="flex:1;min-width:260px">${sparkline(history.map((h) => h.totalMonthly))}</div>
  </div>

  ${budget ? `<div class="panel">
    <h2>Budget · ${usd(budget)} per month</h2>
    <div class="budget ${state}"><div style="width:${Math.min(100, pct).toFixed(1)}%"></div></div>
    <p class="muted">${pct.toFixed(0)}% used${state === 'over' ? ' — over budget'
      : state === 'near' ? ' — approaching budget' : ''}</p>
  </div>` : ''}

  <div class="panel">
    <h2>Fixed — priced from real inventory</h2>
    <div class="scroll"><table>
      <tr><th>Resource</th><th>State</th><th>Per month</th></tr>
      ${lines.map(([n, st, m]) => `<tr><td>${esc(n)}</td>
        <td><span class="chip${st === 'running' ? ' run' : ''}">${esc(st)}</span></td>
        <td>${usd(m)}</td></tr>`).join('')}
      <tr class="total"><td>Subtotal</td><td></td><td>${usd(snap.fixedMonthly)}</td></tr>
    </table></div>
  </div>

  <div class="panel">
    <h2>Egress — measured at the origin · $${snap.egressRate}/GB (${esc(snap.band)})</h2>
    ${snap.egress.ok ? `
      <div class="grid" style="margin-bottom:18px">
        <div class="stat"><b>${size(snap.egress.bytesOut / Math.max(1, snap.egress.daysObserved))}</b><span>per day</span></div>
        <div class="stat"><b>${size((snap.egress.bytesOut / Math.max(1, snap.egress.daysObserved)) * 30)}</b><span>per month</span></div>
        <div class="stat"><b>${snap.egress.requests.toLocaleString()}</b><span>requests</span></div>
        <div class="stat"><b>${usd(snap.egress.monthly)}</b><span>projected</span></div>
      </div>
      ${bars(snap.egress.daily)}`
    : `<p class="muted">Unavailable — ${esc(snap.egress.why)}<br>
         Fixed costs above are unaffected; only this line is missing.</p>`}
  </div>

  <footer>
    Rates checked ${esc(snap.ratesChecked)} against fly.io/docs/about/pricing.
    Compute, volumes, certificates and IPs are arithmetic from inventory. Egress is counted by the
    app itself and slightly under-reports, because Fly meters at its edge including TLS framing the
    origin never sees. Fly exposes no spend figure through its API, so <strong>this is a projection,
    not an invoice</strong> — fly.io/dashboard → Billing is the authority.<br>
    Generated ${esc(snap.at)} · ${history.length} snapshot(s).
  </footer>
</div>`;

  const out = join(ROOT, 'docs', 'spend.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}
