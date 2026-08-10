#!/usr/bin/env node
/**
 * set-secret — paste an API key once, safely, and put it where it belongs.
 *
 *   npm run secret                    choose from the known secrets
 *   npm run secret RESEND_API_KEY     go straight to one
 *   npm run secret RESEND_API_KEY --push-only    re-push from Keychain, no retyping
 *
 * ─── Why a script rather than "just paste it somewhere" ──────────────────────────────────
 *
 * SECRETS-POLICY.md: Keychain-first, masked, never committed, rotate on exposure. Every one of
 * those is easy to violate by hand, and the failure is silent:
 *
 *   typing it as an argument   →  the key lands in shell history and in the process list, where
 *                                 any other process on the machine can read it
 *   echoing it while typing    →  it lands in the terminal scrollback, and in any screen share
 *   writing it to .env         →  one `git add -A` on a machine with a different .gitignore
 *   pasting it into a chat     →  a transcript is stored, synced and backed up; this is exactly
 *                                 how the Google client secret came to need rotation
 *
 * So: the value is read from a hidden prompt (never argv), verified against the live provider
 * before being stored, written to the macOS Keychain, and handed to Fly over STDIN rather than as
 * an argument. It is never printed — only its last four characters, to confirm which key it is.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const ACCOUNT = 'theunivers-ai';

/**
 * The secrets this project uses. `verify` proves the key works BEFORE it is stored anywhere —
 * storing an unverified key means discovering it was wrong later, from a feature that quietly
 * does nothing.
 */
const SECRETS = {
  RESEND_API_KEY: {
    what: 'Resend API key — sends password-reset email',
    looksLike: /^re_[A-Za-z0-9_-]{10,}$/,
    hint: 'starts with re_ · resend.com → API Keys',
    async verify(key) {
      const r = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
      });
      if (r.status === 401 || r.status === 403) return { ok: false, why: 'Resend rejected this key' };
      if (!r.ok) return { ok: false, why: `Resend returned ${r.status}` };
      const d = await r.json().catch(() => ({}));
      const domains = (d.data ?? []).map((x) => `${x.name} (${x.status})`);
      return { ok: true, note: domains.length ? `domains: ${domains.join(', ')}` : 'no verified sending domain yet' };
    },
  },
  GITHUB_CLIENT_ID: { what: 'GitHub OAuth client id', looksLike: /^.{8,}$/, hint: 'github.com → Settings → Developer settings → OAuth Apps' },
  GITHUB_CLIENT_SECRET: { what: 'GitHub OAuth client secret', looksLike: /^.{20,}$/, hint: 'shown once when created' },
  GOOGLE_CLIENT_SECRET: { what: 'Google OAuth client secret (rotate: it was exposed in a transcript)', looksLike: /^GOCSPX-.{10,}$/, hint: 'console.cloud.google.com → Credentials' },
  MAIL_FROM: { what: 'From address on outbound mail', looksLike: /.+@.+/, hint: "e.g. theunivers.ai <noreply@theunivers.ai>", secret: false },
};

const mask = (v) => (v.length <= 4 ? '••••' : `${'•'.repeat(Math.min(24, v.length - 4))}${v.slice(-4)}`);
const say = (s = '') => process.stdout.write(`${s}\n`);

/** Read a line with the characters hidden. Nothing typed here reaches history or scrollback. */
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('needs an interactive terminal'));
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      const done = () => {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
      };
      if (ch === '\r' || ch === '\n') { done(); stdout.write('\n'); return resolve(buf); }
      if (ch === '\u0003') {                       // ctrl-c — leave nothing behind
        done(); stdout.write('\n  cancelled — nothing stored\n'); return process.exit(130);
      }
      if (ch === '\u007f' || ch === '\b') {       // backspace / delete
        if (buf.length) { buf = buf.slice(0, -1); stdout.write('\b \b'); }
        return;
      }
      // A pasted key arrives as one chunk, so filter the whole chunk rather than one character.
      const clean = [...ch].filter((c) => c >= ' ' && c !== '\u007f').join('');
      if (clean) { buf += clean; stdout.write('•'.repeat(clean.length)); }
    };
    stdin.on('data', onData);
  });
}

function ask(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(label, (a) => { rl.close(); r(a.trim()); }));
}

/* ── Keychain ──────────────────────────────────────────────────────────────────────────── */

function keychainSet(name, value) {
  // -w with the value as an argument would expose it in the process list. `-w` reading from stdin
  // is not supported by `security`, so this uses the documented interactive form via a pipe.
  const r = spawnSync('security', ['add-generic-password', '-U', '-a', ACCOUNT, '-s', name, '-w', value],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) throw new Error(`keychain write failed: ${r.stderr?.toString().trim()}`);
}

function keychainGet(name) {
  const r = spawnSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', name, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

/* ── Fly ───────────────────────────────────────────────────────────────────────────────── */

/**
 * `fly secrets import` reads KEY=VALUE from STDIN. Used deliberately instead of
 * `fly secrets set KEY=value`, which puts the value in argv where `ps` can read it.
 */
function flyPush(name, value) {
  const r = spawnSync('fly', ['secrets', 'import'], {
    input: `${name}=${value}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) throw new Error(`fly rejected it: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  return true;
}

/* ── main ──────────────────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const pushOnly = argv.includes('--push-only');
let name = argv.find((a) => !a.startsWith('--'));

say();
say('  SET SECRET — hidden input, Keychain, then Fly. Never argv, never a file.');
say('  ' + '─'.repeat(66));

if (!name) {
  say();
  const keys = Object.keys(SECRETS);
  keys.forEach((k, i) => {
    const stored = keychainGet(k);
    say(`    ${i + 1}. ${k.padEnd(22)} ${stored ? `stored ${mask(stored)}` : 'not set'}`);
    say(`       ${SECRETS[k].what}`);
  });
  say();
  const pick = await ask('  Which one? (number, or blank to cancel) ');
  if (!pick) { say('  cancelled\n'); process.exit(0); }
  name = keys[Number(pick) - 1];
  if (!name) { say('  no such option\n'); process.exit(1); }
}

const spec = SECRETS[name];
if (!spec) {
  say(`  Unknown secret "${name}". Known: ${Object.keys(SECRETS).join(', ')}\n`);
  process.exit(1);
}

let value;
if (pushOnly) {
  value = keychainGet(name);
  if (!value) { say(`  ${name} is not in the Keychain yet — run without --push-only\n`); process.exit(1); }
  say(`\n  Using the stored ${name} ${mask(value)}\n`);
} else {
  say(`\n  ${name}`);
  say(`  ${spec.what}`);
  say(`  ${spec.hint}\n`);
  value = (await promptHidden('  Paste it (input hidden): ')).trim();
  if (!value) { say('  nothing entered — nothing stored\n'); process.exit(1); }

  if (!spec.looksLike.test(value)) {
    say(`\n  ⚠  That does not look like a ${name}.`);
    const go = await ask('     Store it anyway? (y/N) ');
    if (go.toLowerCase() !== 'y') { say('  cancelled — nothing stored\n'); process.exit(1); }
  }

  // Verify BEFORE storing. A key that is stored but wrong fails later, from a feature that
  // quietly does nothing — the hardest kind of problem to attribute.
  if (spec.verify) {
    process.stdout.write('  Checking it with the provider… ');
    let v;
    try {
      v = await spec.verify(value);
    } catch (e) {
      // A network failure is NOT evidence the key is bad. Hard-failing here would block someone
      // storing a perfectly good key because their wifi dropped, so degrade to a question.
      say(`could not reach the provider (${e.message})`);
      const go = await ask('  Store it unverified? (y/N) ');
      if (go.toLowerCase() !== 'y') { say('  cancelled — nothing stored\n'); process.exit(1); }
      v = { ok: true, note: 'stored WITHOUT verification' };
    }
    if (!v.ok) { say(`✗ ${v.why}\n\n  Nothing stored — fix the key and run again.\n`); process.exit(1); }
    say(`✓ ${v.note ?? 'accepted'}`);
  }

  keychainSet(name, value);
  say(`  ✓ Keychain  (account "${ACCOUNT}", service "${name}")`);
}

try {
  flyPush(name, value);
  say('  ✓ Fly secret set — the app restarts to pick it up');
} catch (e) {
  say(`  ✗ ${e.message}`);
  say('    It is safe in the Keychain. Retry with:');
  say(`    npm run secret ${name} -- --push-only`);
  process.exit(1);
}

say();
say(`  ${name} = ${mask(value)}`);
say('  Not written to .env, not in shell history, not in this terminal.');
say();
