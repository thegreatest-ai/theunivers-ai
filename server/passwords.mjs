/**
 * Password hashing — scrypt from node:crypto. No dependency, and nothing to keep patched.
 *
 * scrypt is memory-hard, which is the property that matters against GPU cracking; bcrypt or
 * argon2 would also be fine and both would add a dependency to a codebase that currently has
 * none on the server side.
 *
 * Stored as `scrypt$N$r$p$salt$hash`. The parameters travel WITH the hash so they can be raised
 * later without invalidating every existing password — a stored hash that does not record its
 * own cost is a migration you cannot perform.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384, r = 8, p = 1, KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, rr, pp, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(String(password), salt, expected.length,
    { N: Number(n), r: Number(rr), p: Number(pp) });
  // Constant-time: a length-varying or short-circuiting compare leaks the hash a byte at a time.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
