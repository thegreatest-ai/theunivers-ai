/**
 * Server-Sent Events — the server tells you when something happened, instead of you asking.
 *
 * ─── What this replaces ──────────────────────────────────────────────────────────────────
 *
 * The Bridge polled three endpoints every four seconds, forever, whether anything had changed or
 * not. That cost CPU (every poll hits SQLite, which is what created the concurrency WAL had to
 * solve), egress (~450KB per ten-minute session asking a question whose answer is almost always
 * "no"), phone battery — and, absurdly, LATENCY: a message that arrived instantly still took up to
 * four seconds to appear.
 *
 * One open connection per tab. The server already knows the moment a message, post, proposal or
 * order transition lands; it simply had no way to say so.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * SSE rather than WebSockets because the traffic is one-directional. The browser already has a
 * perfectly good way to send things — POST — and a WebSocket would add a second protocol, its own
 * framing, and a reconnection story, to solve a problem SSE solves with a text stream and a
 * built-in retry.
 *
 * SUBSCRIBERS ARE IN MEMORY, which is honest for one machine and wrong the moment there are two:
 * a publish on machine A never reaches a subscriber on machine B, so half your users would see
 * nothing and the bug would look like "sometimes it doesn't update". Same constraint as
 * ratelimit.mjs, and it must move to a shared bus before a second machine exists — not after.
 */

/** userId → Set of open responses. A person may have several tabs; all of them get told. */
const subscribers = new Map();

/**
 * Proxies drop connections that go quiet, and Fly is no exception. A comment line every 25s keeps
 * the connection alive and costs 3 bytes. It is a `:` comment rather than an event so no client
 * handler ever sees it.
 */
const HEARTBEAT_MS = 25_000;

/** Serialise one event in the SSE wire format. */
function frame(kind, data) {
  return `event: ${kind}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
}

/**
 * Attach a response to a principal's stream. Returns nothing; the caller must not end the
 * response — it stays open until the client disconnects.
 */
export function subscribe(userId, req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',   // no-transform: stop proxies buffering the stream
    connection: 'keep-alive',
    'x-accel-buffering': 'no',                   // nginx-family proxies, harmless elsewhere
  });

  // `retry` tells the browser how long to wait before reconnecting if the stream drops. Setting it
  // once here means the client needs no reconnection logic of its own for the ordinary case.
  res.write('retry: 3000\n\n');
  res.write(frame('ready', { at: new Date().toISOString() }));

  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId).add(res);

  const beat = setInterval(() => {
    // A write to a dead socket throws rather than returning false; without this the interval
    // survives the connection and leaks one timer per disconnected tab.
    try { res.write(': keep-alive\n\n'); } catch { close(); }
  }, HEARTBEAT_MS);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    const set = subscribers.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) subscribers.delete(userId);   // do not accumulate empty sets forever
    }
    try { res.end(); } catch { /* already gone */ }
  }

  req.on('close', close);
  req.on('error', close);
  res.on('error', close);
}

/**
 * Tell one principal that something happened.
 *
 * Deliberately carries only a KIND, not the changed object. The client refetches the affected
 * resource, which keeps one code path for "how do I load messages" instead of two that can
 * disagree — and means an event can never deliver a shape the reader was not expecting. The
 * saving is the polling, not the payload.
 *
 * Never throws. An event is a courtesy; a failure to deliver one must not fail the request that
 * caused it, or a broken tab could stop somebody else's message from being saved.
 */
export function publish(userId, kind, data) {
  const set = subscribers.get(String(userId));
  if (!set || set.size === 0) return 0;
  let sent = 0;
  for (const res of [...set]) {
    try { res.write(frame(kind, data)); sent += 1; } catch { set.delete(res); }
  }
  return sent;
}

/** Tell several principals — both sides of a deal, for instance. */
export function publishAll(userIds, kind, data) {
  return [...new Set(userIds)].filter(Boolean)
    .reduce((n, id) => n + publish(id, kind, data), 0);
}

/** For /api/metrics: how many tabs are listening, and for how many people. */
export function streamStats() {
  let connections = 0;
  for (const set of subscribers.values()) connections += set.size;
  return { principals: subscribers.size, connections };
}
