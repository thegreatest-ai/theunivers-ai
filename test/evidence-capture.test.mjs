/**
 * The capture screen must take a LIVE FRAME ONLY — getUserMedia, never a file input.
 *
 * This is the one property the whole inspection design leans on: a file picker would let an
 * inspector submit any photo already on the device, which is precisely the manufactured evidence
 * the check-in exists to prevent. It cannot be tested by rendering the component in this harness
 * (no DOM, no camera), so it is enforced STRUCTURALLY against the source — the same technique
 * order-conflict.test.mjs uses for a property with no in-process seam. Deleting the guard would
 * reintroduce the hole in the same commit that breaks this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = readFileSync(join(ROOT, 'src', 'app', 'Inspect.jsx'), 'utf8');

/*
 * Scan CODE, not prose. The header explains WHY there is no file input by naming `<input
 * type="file">` in a comment, and a naive scan of the raw file would match that explanation and
 * fail on the very sentence documenting the rule. So comments are stripped first: the invariant is
 * that no file input exists in the executable component, not that the word never appears.
 */
const SRC = RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (leave URLs like https:// alone)

test('capture uses getUserMedia', () => {
  assert.match(SRC, /getUserMedia/, 'the frame must come from a media stream');
});

test('there is NO file input anywhere in the capture screen', () => {
  // Both the JSX form and a programmatic input are forbidden. A file input is the exact affordance
  // that lets an old photo in.
  assert.doesNotMatch(SRC, /type=["']file["']/, 'no <input type="file">');
  assert.doesNotMatch(SRC, /createElement\(\s*['"]input['"]/, 'no programmatic file input');
  assert.doesNotMatch(SRC, /accept=["'][^"']*image/, 'no file-accept attribute');
});

test('the platform nonce is drawn into the frame and sent to the server', () => {
  assert.match(SRC, /nonce/, 'the check-in nonce must be part of capture');
  assert.match(SRC, /captureEvidence/, 'the frame is submitted through the evidence endpoint');
});

test('the frame is read from a canvas of the live video, not from a chosen file', () => {
  assert.match(SRC, /drawImage\(\s*video/, 'the canvas is drawn from the live video element');
  assert.match(SRC, /toBlob/, 'and submitted as the bytes of that frame');
});

test('position is read at capture time, not scheduled or cached', () => {
  // maximumAge:0 forces a fresh fix — a cached position is one the inspector could have set earlier.
  assert.match(SRC, /maximumAge:\s*0/, 'geolocation must not be served from cache');
});
