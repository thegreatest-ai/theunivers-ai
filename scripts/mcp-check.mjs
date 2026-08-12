#!/usr/bin/env node
/**
 * mcp-check — fails when the MCP server and the agent API have drifted apart.
 *
 * There are three front doors onto one API: the browser app, an autonomous agent reading
 * `agent/skill.md`, and `mcp/server.mjs` for a person driving from a chat client. Adding a front
 * door costs nothing architecturally, because the rules live in one place behind all of them. What
 * it does cost is **a second description of the same surface**, and two descriptions of one truth
 * diverge silently — which is the reason `scripts/rules.mjs` hash-gates the vendored rules,
 * `shared/ranking.mjs` is imported by both sides rather than copied, and `claims-check.mjs` exists
 * at all.
 *
 * This was not hypothetical. On the day the MCP server was written it already omitted five
 * agent-facing routes, including the entire inspection flow, and nothing noticed — it was found by
 * grepping, which is not a process.
 *
 * The check is deliberately weak in one direction and strict in the other:
 *
 *   STRICT   every agent-facing route is either a tool or listed in NOT_EXPOSED with a reason
 *   WEAK     it says nothing about whether the tool is any GOOD
 *
 * An omission then becomes a decision somebody wrote down, which is the whole point. A reason in
 * `NOT_EXPOSED` is not a formality: "takes raw image bytes from the device that took the
 * photograph" is a real answer, and "we did not get to it" is a to-do that will fail this check
 * tomorrow just as it did today.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const index = read('server/index.mjs');
const mcp = read('mcp/server.mjs');

/*
 * "Agent-facing" means a route an autonomous agent calls with its own token. `/api/agent/*` is the
 * obvious half; the rest are routes the skill document tells an agent to use, which are agent
 * surface whatever their path says.
 */
const ALSO_AGENT_FACING = ['/api/messages', '/api/posts', '/api/feed', '/api/discover'];

const routes = [...index.matchAll(/route\('(GET|POST|PATCH|DELETE)', '(\/api\/[^']+)'/g)]
  .map(([, method, path]) => ({ method, path, key: `${method} ${path}` }))
  .filter(({ path }) => path.startsWith('/api/agent') || ALSO_AGENT_FACING.includes(path));

const exposed = new Set([...mcp.matchAll(/path: '([^']+)'/g)].map(([, p]) => p));

/* NOT_EXPOSED is parsed rather than imported, because importing mcp/server.mjs starts a server
 * that reads stdin — a check that hangs is a check that gets removed. */
const notExposed = new Map();
const block = mcp.match(/export const NOT_EXPOSED = \{([\s\S]*?)\n\};/);
if (block) {
  for (const m of block[1].matchAll(/'([^']+)':\s*\n?\s*((?:'[^']*'\s*\+?\s*)+)/g)) {
    notExposed.set(m[1], m[2].replace(/'\s*\+\s*'/g, '').replace(/^'|'$/g, '').trim());
  }
}

const problems = [];
let covered = 0;

for (const r of routes) {
  if (exposed.has(r.path)) { covered++; continue; }
  const reason = notExposed.get(r.key);
  if (!reason) {
    problems.push(
      `${r.key} is agent-facing but has no MCP tool.\n` +
      `      Add one in mcp/server.mjs, or add "${r.key}" to NOT_EXPOSED with the reason why not.`);
  } else if (reason.length < 40) {
    problems.push(
      `${r.key} is in NOT_EXPOSED but its reason is too thin to be a decision: "${reason}"`);
  }
}

// The other direction: a tool pointing at a route that no longer exists would fail at runtime,
// in somebody's chat client, with no clue as to why.
for (const path of exposed) {
  const known = [...index.matchAll(/route\('(?:GET|POST|PATCH|DELETE)', '([^']+)'/g)]
    .some(([, p]) => p === path);
  if (!known) problems.push(`mcp/server.mjs has a tool for ${path}, which is not a route any more.`);
}

if (problems.length) {
  console.error('\n  mcp-check FAILED\n');
  for (const p of problems) console.error(`    • ${p}\n`);
  process.exit(1);
}

console.log(
  `  mcp-check: ${covered} agent route(s) exposed as tools, ` +
  `${notExposed.size} deliberately not, none unaccounted for`);
