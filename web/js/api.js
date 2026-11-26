// Cliente de la API (/api/* lo sirve CloudFront → Lambda; mismo dominio, sin CORS).
const BASE = window.API_BASE || '/api';
let token = null;
try { token = localStorage.getItem('token'); } catch {}

export const getToken = () => token;
export function setToken(t) {
  token = t;
  try { t ? localStorage.setItem('token', t) : localStorage.removeItem('token'); } catch {}
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/login') {
    setToken(null);
    window.dispatchEvent(new CustomEvent('sesion-expirada'));
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
