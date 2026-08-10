/**
 * Live updates — read the server's event stream instead of asking it every four seconds.
 *
 * ─── Why this is not `new EventSource(...)` ──────────────────────────────────────────────
 *
 * EventSource cannot set request headers, and the session token travels in `Authorization`. The
 * usual workaround is to put the token in the query string, which writes a live credential into
 * every access log, proxy trace and browser history entry — a poor trade for a smaller client.
 *
 * So the stream is read with fetch and a ReadableStream. That costs the reconnection logic below,
 * which EventSource would have given us, and buys keeping the credential in a header.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { getSession } from './api';

/** Parse the SSE wire format. Frames are separated by a blank line; `:` lines are comments. */
function parseFrames(buffer) {
  const frames = [];
  let rest = buffer;
  let i;
  while ((i = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, i);
    rest = rest.slice(i + 2);
    let event = 'message';
    const data = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue;                 // keep-alive comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (data.length || event !== 'message') {
      let payload = {};
      try { payload = JSON.parse(data.join('\n') || '{}'); } catch { /* keep {} */ }
      frames.push({ event, data: payload });
    }
  }
  return { frames, rest };
}

/**
 * Subscribe to the live stream.
 *
 * `onEvent(kind, data)` is called for each event. Returns a function that stops the stream and
 * cancels any pending reconnect — call it from a React cleanup, or a navigation leaves a stream
 * running for a component that no longer exists.
 *
 * `onStatus(state)` reports 'live' | 'retrying' | 'stopped', so the UI can be honest about whether
 * it is actually receiving updates rather than silently showing stale data.
 */
export function subscribe(onEvent, onStatus = () => {}) {
  let stopped = false;
  let controller = null;
  let timer = null;
  let attempt = 0;

  async function connect() {
    if (stopped) return;
    const token = getSession();
    if (!token) return;                                    // signed out; nothing to listen to

    controller = new AbortController();
    try {
      const res = await fetch('/api/events', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

      attempt = 0;                                         // a successful connect resets the backoff
      onStatus('live');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseFrames(buffer);
        buffer = rest;
        for (const f of frames) {
          if (f.event !== 'ready') onEvent(f.event, f.data);
        }
      }
      throw new Error('stream ended');                     // server closed, or the network went
    } catch (e) {
      if (stopped || e?.name === 'AbortError') return;
      // Exponential backoff to 30s. A server that is down does not want every open tab retrying
      // once a second; that is the thundering herd that turns a brief outage into a long one.
      attempt += 1;
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      onStatus('retrying');
      timer = setTimeout(connect, wait);
    }
  }

  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    onStatus('stopped');
  };
}
