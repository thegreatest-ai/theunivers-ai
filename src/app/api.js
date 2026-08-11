/** Browser client for the pilot API. Session + agent token live in localStorage. */

const API = import.meta.env.VITE_API_URL ?? '';

function headers(extra = {}) {
  const h = { 'content-type': 'application/json', ...extra };
  const session = localStorage.getItem('tu_session');
  if (session) h.Authorization = `Bearer ${session}`;
  return h;
}

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: headers(opts.headers),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
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
  feed: () => req('/api/feed'),
  setMandate: (body) => req('/api/mandate', { method: 'POST', body: JSON.stringify(body) }),
  profile: () => req('/api/profile'),
  workspace: () => req('/api/workspace'),
  projects: () => req('/api/projects'),
  project: (id) => req(`/api/projects/${id}`),
  share: (body) => req('/api/projects/share', { method: 'POST', body: JSON.stringify(body) }),
  renameProject: (id, name) => req('/api/projects/rename', { method: 'POST', body: JSON.stringify({ id, name }) }),
  analyse: (note) => req('/api/notes/analyse', { method: 'POST', body: JSON.stringify({ note }) }),
  moveNote: (note, project) => req('/api/notes/move', { method: 'POST', body: JSON.stringify({ note, project }) }),
  seen: (posts) => req('/api/views', { method: 'POST', body: JSON.stringify({ posts }) }),
  saveDraft: (body) => req('/api/drafts', { method: 'POST', body: JSON.stringify(body) }),
  deleteDraft: (id) => req('/api/drafts/delete', { method: 'POST', body: JSON.stringify({ id }) }),
  addWatch: (body) => req('/api/watch', { method: 'POST', body: JSON.stringify(body) }),
  watchSeen: (id) => req('/api/watch/seen', { method: 'POST', body: JSON.stringify({ id }) }),
  deleteWatch: (id) => req('/api/watch/delete', { method: 'POST', body: JSON.stringify({ id }) }),
  setKind: (body) => req('/api/account/kind', { method: 'POST', body: JSON.stringify(body) }),
  orders: () => req('/api/orders'),
  order: (id) => req(`/api/orders/${id}`),
  moveOrder: (order, to) => req('/api/orders/transition', {
    method: 'POST', body: JSON.stringify({ order, to }),
  }),
  proposals: () => req('/api/proposals'),
  decide: (id, approve) => req('/api/proposals/decide', { method: 'POST', body: JSON.stringify({ id, approve }) }),
  messages: () => req('/api/messages'),
  sendMessage: (body) => req('/api/messages', { method: 'POST', body: JSON.stringify(body) }),
  createPost: (body) => req('/api/posts', { method: 'POST', body: JSON.stringify(body) }),
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
