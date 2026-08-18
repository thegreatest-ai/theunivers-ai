/**
 * The comment filter. One list, in the repo, because it is code: reviewable in a diff and
 * deployable without a migration. A list in the database would be an unreviewed edit away from
 * hiding ordinary words, or from quietly dropping a term somebody fought to add.
 *
 * Start small and defensible. Slurs and sexual-harassment terms, not profanity — the point is
 * safety, not politeness. An over-eager filter that hides ordinary words is worse than a plain
 * one, because it teaches people the product is broken.
 *
 * Matching is case-insensitive, on WORD BOUNDARIES, against a normalised body. Substring match
 * is the Scunthorpe problem, which is the canonical failure of this exact feature.
 */

export const WORDS = [
  'nigger',
  'nigga',
  'faggot',
  'tranny',
  'shemale',
  'kike',
  'spic',
  'chink',
  'wetback',
  'paki',
  'gook',
  'retard',
  // Gendered sexual attack, and the term inside "Scunthorpe" — if this were a substring match
  // the town would vanish from the product. It is in the list so that failure has a test.
  'cunt',
  'whore',
  'slut',
];

const WORD_SET = new Set(WORDS);

/**
 * Fold the obvious leetspeak substitutions. `1` is i or l; mapping both in one string is
 * impossible, so `normalise` uses i (the common one) and `matches` tries both rather than
 * generating a family of variants — that is the cleverness the spec forbids.
 */
const LEET_ONES = ['i', 'l'];

function fold(text, oneAs) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/0/g, 'o')
    .replace(/1/g, oneAs)
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Canonical form for display and tests. `1` folds to `i`. */
export function normalise(text) {
  return fold(text, 'i');
}

/**
 * The listed term that matched, or null. Tokens, not substrings: after folding, the body is
 * split on non-letters, so "Scunthorpe" is one token and "cunt" is not inside it.
 */
export function matches(text) {
  for (const oneAs of LEET_ONES) {
    const n = fold(text, oneAs);
    if (!n) continue;
    for (const token of n.split(' ')) {
      if (WORD_SET.has(token)) return token;
    }
  }
  return null;
}
