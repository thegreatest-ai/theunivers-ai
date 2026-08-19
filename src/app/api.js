/** Browser client for the pilot API. Session + agent token live in localStorage. */

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * Keep status. `Error.message` used to be the server body, so a 404 that said "blocked" would
 * paint that on the glass while the server was trying not to. The glass maps 404s to its own
 * copy; it must not interpolate this.
 */
export class ApiError extends Error {
  constructor(status, data = {}) {
    super(data.error || String(status));
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export const isUnknown = (err) => err?.status === 404;

function headers(extra = {}) {
  const h = { 'content-type': 'application/json', ...extra };
  const session = localStorage.getItem('tu_session');
  if (session) h.Authorization = `Bearer ${session}`;
  return h;
}

async function readBody(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: headers(opts.headers),
  });
  return readBody(res);
}

export const api = {
  health: () => req('/api/health'),
  providers: () => req('/api/auth/providers'),
  register: (body) => req('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => req('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  forgot: (body) => req('/api/auth/forgot', { method: 'POST', body: JSON.stringify(body) }),
  reset: (body) => req('/api/auth/reset', { method: 'POST', body: JSON.stringify(body) }),
  me: () => req('/api/me'),
  setPassword: (body) => req('/api/auth/set-password', { method: 'POST', body: JSON.stringify(body) }),
  agentNameAvailable: (name) => req(`/api/agent-name-available?name=${encodeURIComponent(name)}`),
  deploy: (body) => req('/api/deploy', { method: 'POST', body: JSON.stringify(body) }),
  feed: (page = 1) => req(`/api/feed?page=${page}`),
  /* Empty values are stripped so the URL carries only the filters actually applied — a `lane=`
     in the bar reads as a filter that is on, and the back button would restore it. */
  discover: (params) => req(`/api/discover?${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null),
  )}`),
  setMandate: (body) => req('/api/mandate', { method: 'POST', body: JSON.stringify(body) }),
  profile: () => req('/api/profile'),
  /* Handle or user id — the server accepts both, because a handle is what people actually type. */
  person: (id) => req(`/api/people/${encodeURIComponent(id)}`),
  personFollows: (id, direction) => req(
    `/api/people/${encodeURIComponent(id)}/follows?${new URLSearchParams({ direction })}`,
  ),
  follow: (person) => req('/api/follow', { method: 'POST', body: JSON.stringify({ person }) }),
  unfollow: (person) => req('/api/unfollow', { method: 'POST', body: JSON.stringify({ person }) }),
  block: (person) => req('/api/block', { method: 'POST', body: JSON.stringify({ person }) }),
  unblock: (person) => req('/api/unblock', { method: 'POST', body: JSON.stringify({ person }) }),
  blocks: () => req('/api/blocks'),
  report: (body) => req('/api/report', { method: 'POST', body: JSON.stringify(body) }),
  editProfile: (body) => req('/api/profile/edit', { method: 'POST', body: JSON.stringify(body) }),
  /* Raw bytes, same as a work. An avatar is not a work — the route stores it with no work_id
     so it cannot appear in the grid. */
  uploadAvatar: (file) => fetch('/api/profile/avatar', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('tu_session')}`,
      'content-type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name || 'avatar'),
    },
    body: file,
  }).then(readBody),
  removeAvatar: () => req('/api/profile/avatar/remove', { method: 'POST', body: JSON.stringify({}) }),
  works: (user, kind) => req(`/api/works?${new URLSearchParams({ ...(user && { user }), ...(kind && { kind }) })}`),
  work: (id) => req(`/api/works/${encodeURIComponent(id)}`),
  createWork: (body) => req('/api/works', { method: 'POST', body: JSON.stringify(body) }),
  /* Coordinates go to our origin; the server names them and discards the fix.
     The page never talks to a geocoder — that is the whole reason this exists. */
  reverseGeocode: (lat, lng) => req('/api/geocode/reverse', {
    method: 'POST', body: JSON.stringify({ lat, lng }),
  }),
  updateWork: (body) => req('/api/works/update', { method: 'POST', body: JSON.stringify(body) }),
  deleteWork: (id) => req('/api/works/delete', { method: 'POST', body: JSON.stringify({ id }) }),
  workComments: (id, page = 1) => req(`/api/works/${encodeURIComponent(id)}/comments?page=${page}`),
  commentOnWork: (id, body) => req(`/api/works/${encodeURIComponent(id)}/comments`, {
    method: 'POST', body: JSON.stringify({ body }),
  }),
  deleteComment: (id) => req('/api/comments/delete', { method: 'POST', body: JSON.stringify({ id }) }),
  appealComment: (id, body) => req(`/api/comments/${encodeURIComponent(id)}/appeal`, {
    method: 'POST', body: JSON.stringify({ body }),
  }),
  /* Raw bytes, not multipart — the browser already sends the type, and a parser would be a
     dependency and a class of bug to solve a problem that does not exist. Zoom and focal ride
     in headers for the same reason the filename does: they are metadata, not content. */
  uploadMedia: (workId, file, framing = {}) => fetch(`/api/works/${workId}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('tu_session')}`,
      'content-type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name || 'file'),
      ...(framing.zoom != null && { 'x-zoom': String(framing.zoom) }),
      ...(framing.focalX != null && { 'x-focal-x': String(framing.focalX) }),
      ...(framing.focalY != null && { 'x-focal-y': String(framing.focalY) }),
    },
    body: file,
  }).then(readBody),
  workspace: () => req('/api/workspace'),
  projects: () => req('/api/projects'),
  project: (id) => req(`/api/projects/${id}`),
  share: (body) => req('/api/projects/share', { method: 'POST', body: JSON.stringify(body) }),
  renameProject: (id, name) => req('/api/projects/rename', { method: 'POST', body: JSON.stringify({ id, name }) }),
  analyse: (note) => req('/api/notes/analyse', { method: 'POST', body: JSON.stringify({ note }) }),
  moveNote: (note, project) => req('/api/notes/move', { method: 'POST', body: JSON.stringify({ note, project }) }),
  seen: (posts) => req('/api/views', { method: 'POST', body: JSON.stringify({ posts }) }),
  seenWorks: (works) => req('/api/views', { method: 'POST', body: JSON.stringify({ works }) }),
  saveDraft: (body) => req('/api/drafts', { method: 'POST', body: JSON.stringify(body) }),
  deleteDraft: (id) => req('/api/drafts/delete', { method: 'POST', body: JSON.stringify({ id }) }),
  addWatch: (body) => req('/api/watch', { method: 'POST', body: JSON.stringify(body) }),
  watchSeen: (id) => req('/api/watch/seen', { method: 'POST', body: JSON.stringify({ id }) }),
  deleteWatch: (id) => req('/api/watch/delete', { method: 'POST', body: JSON.stringify({ id }) }),
  setKind: (body) => req('/api/account/kind', { method: 'POST', body: JSON.stringify(body) }),
  setFilterComments: (on) => req('/api/account/filter-comments', {
    method: 'POST', body: JSON.stringify({ filterComments: on }),
  }),
  orders: () => req('/api/orders'),
  order: (id) => req(`/api/orders/${id}`),
  moveOrder: (order, to) => req('/api/orders/transition', {
    method: 'POST', body: JSON.stringify({ order, to }),
  }),
  proposals: () => req('/api/proposals'),
  decide: (id, approve) => req('/api/proposals/decide', { method: 'POST', body: JSON.stringify({ id, approve }) }),
  messages: () => req('/api/messages'),
  sendMessage: (body) => req('/api/messages', { method: 'POST', body: JSON.stringify(body) }),
  conversations: () => req('/api/conversations'),
  conversation: (id) => req(`/api/conversations/${encodeURIComponent(id)}`),
  /* Session only. Instructs YOUR agent; the principal never writes the thread. */
  contact: (handle) => req('/api/conversations/contact', {
    method: 'POST', body: JSON.stringify({ handle }),
  }),
  createPost: (body) => req('/api/posts', { method: 'POST', body: JSON.stringify(body) }),
  post: (id) => req(`/api/posts/${encodeURIComponent(id)}`),
  /* Author session only. Empties title/body; citations stay and still resolve to the tombstone. */
  withdraw: (id) => req(`/api/posts/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }),
  receipts: () => req('/api/receipts'),

  /* Inspection. See docs/specs/ORDER-AND-INSPECTION.md. */
  orderInspections: (id) => req(`/api/orders/${id}/inspections`),
  inspection: (id) => req(`/api/inspections/${id}`),
  openInspections: () => req('/api/inspections/open'),

  /*
   * Evidence is captured, never uploaded. The frame comes from getUserMedia — a media stream, not
   * a file picker — so it is a Blob of the current frame, sent as raw bytes exactly like works
   * media. The device fix, the platform nonce and the timing ride in headers so the body is only
   * ever the image. The network fix is derived at the edge and never sent from here, because a
   * position the client could set would defeat the consistency check it exists to feed.
   */
  captureEvidence: (jobId, blob, { nonce, nonceInShot, live, device, requestedAt, observedAt }) =>
    fetch(`${API}/api/agent/inspections/${jobId}/evidence`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('tu_agent_token')}`,
        'content-type': blob.type || 'image/jpeg',
        'x-nonce': nonce ?? '',
        'x-nonce-in-shot': nonceInShot ? 'true' : 'false',
        'x-live': live === false ? 'false' : 'true',
        ...(device?.lat != null && {
          'x-geo-lat': String(device.lat),
          'x-geo-lng': String(device.lng),
          ...(device.accuracy_m != null && { 'x-geo-accuracy': String(device.accuracy_m) }),
        }),
        ...(requestedAt && { 'x-requested-at': requestedAt }),
        ...(observedAt && { 'x-observed-at': observedAt }),
      },
      body: blob,
    }).then(readBody),
};

export function setSession(token) {
  if (token) localStorage.setItem('tu_session', token);
  else localStorage.removeItem('tu_session');
}

export function setAgentToken(token) {
  if (token) localStorage.setItem('tu_agent_token', token);
  else localStorage.removeItem('tu_agent_token');
}

export function getAgentToken() {
  return localStorage.getItem('tu_agent_token');
}

export function clearAuth() {
  setSession(null);
  setAgentToken(null);
}

/** The session token, or null. One accessor, so the storage key lives in exactly one file. */
export function getSession() {
  return localStorage.getItem('tu_session');
}

export function hasSession() {
  return Boolean(localStorage.getItem('tu_session'));
}
