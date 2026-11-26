// Utilidades de UI y formato.
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const fmtNum = (n, d = 0) => (n == null || Number.isNaN(+n) ? '—' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const fmtMoney = (n) => (n == null || Number.isNaN(+n) ? '—' : '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 }));
export const fmtPct = (n, d = 0) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`);

export function fmtFecha(iso, conHora = false) {
  if (!iso) return '—';
  const d = new Date(iso); if (Number.isNaN(+d)) return String(iso);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: conHora ? undefined : 'numeric' }) +
    (conHora ? ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '');
}
export function hace(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `hace ${Math.floor(s / 86400)} d`;
  return fmtFecha(iso);
}

/** Normaliza un celular mexicano a formato internacional 52 + 10 dígitos (wa.me). */
export function normalizaCel(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3);
  if (d.length === 10) d = '52' + d;
  return d;
}
export function celBonito(v) {
  const d = normalizaCel(v);
  if (d.length === 12 && d.startsWith('52')) return `${d.slice(2, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;
  return d || '—';
}
export const waLink = (cel, texto = '') => `https://wa.me/${normalizaCel(cel)}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
export const telLink = (cel) => `tel:+${normalizaCel(cel)}`;

export function iniciales(nombre = '') {
  const p = String(nombre).trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}
const PALETA = ['#ff5000', '#1d5fd1', '#138a4d', '#8e44ad', '#c0392b', '#16a085', '#d35400', '#2c3e50', '#b8860b', '#e84393'];
export function colorDe(str = '') { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETA[h % PALETA.length]; }
export const avatar = (nombre, key) => `<span class="avatar" style="background:${colorDe(key || nombre)}">${esc(iniciales(nombre))}</span>`;

export const primerNombre = (n = '') => {
  const p = String(n).trim().split(/\s+/)[0] || '';
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
};
export const titulo = (n = '') => String(n).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// ---------- toasts
export function toast(msg, { tipo = 'ok', accion, onAccion, ms = 3500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${tipo === 'err' ? 'err' : ''}`;
  el.innerHTML = `<span style="flex:1">${esc(msg)}</span>${accion ? `<button class="btn sm">${esc(accion)}</button>` : ''}`;
  if (accion) el.querySelector('button').onclick = () => { onAccion?.(); el.remove(); };
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), accion ? Math.max(ms, 8000) : ms);
}

// ---------- modales
export function modal(html, { wide = false, onClose } = {}) {
  const scrim = document.createElement('div'); scrim.className = 'scrim modal-scrim';
  const box = document.createElement('div'); box.className = `modal ${wide ? 'wide' : ''}`; box.innerHTML = html;
  box.setAttribute('role', 'dialog');
  const close = () => { scrim.remove(); box.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.onclick = close; document.addEventListener('keydown', onKey);
  box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  document.body.append(scrim, box);
  box.querySelector('input,select,textarea')?.focus();
  return { el: box, close };
}
export function confirmar(msg, { ok = 'Confirmar', peligro = false } = {}) {
  return new Promise((res) => {
    const m = modal(`<h2>¿Seguro?</h2><p>${esc(msg)}</p><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn ${peligro ? 'danger' : 'primary'}" id="okc">${esc(ok)}</button></div>`,
      { onClose: () => res(false) });
    m.el.querySelector('#okc').onclick = () => { res(true); m.close(); };
  });
}

export async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/** Carga perezosa de SheetJS (solo cuando se importa/exporta Excel). */
let xlsxPromise;
export function cargarXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel'));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

// ---------- íconos (trazos SVG en línea)
const P = {
  home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  wa: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2.3-2.3l.8-1-1-2z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  down: '<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  pin: '<path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  car: '<path d="M5 17h14M5 17a2 2 0 1 1-4 0v-4l2-6h18l2 6v4a2 2 0 1 1-4 0M7 17a2 2 0 1 0 4 0m2 0a2 2 0 1 0 4 0"/>',
  split: '<path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22v-8"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M19 4l2 2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
};
export const icon = (n, cls = 'svg-i') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
