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
  deploy: (body) => req('/api/deploy', { method: 'POST', body: JSON.stringify(body) }),
  feed: () => req('/api/feed'),
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

export function hasSession() {
  return Boolean(localStorage.getItem('tu_session'));
}
