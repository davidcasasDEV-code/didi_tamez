// Shell de la aplicación: sesión, estado global, navegación y sincronización en tiempo (casi) real.
import { api, getToken, setToken } from './api.js';
import { $, $$, esc, icon, avatar, toast, modal, hace } from './util.js';
import { derivar } from './logic.js';
import { renderDashboard } from './views/dashboard.js';
import { renderChoferes } from './views/choferes.js';
import { renderReclutamiento } from './views/reclutamiento.js';
import { renderMensajes } from './views/mensajes.js';
import { cargarEstadoWa } from './wa.js';
import { renderActividad } from './views/actividad.js';
import { renderImportar } from './views/importar.js';
import { renderAdmin } from './views/admin.js';
import { abrirChofer, refrescarDrawer } from './views/chofer.js';

const POLL_MS = 20000;

export const S = {
  data: null,        // respuesta de /bootstrap
  d: new Map(),      // derivados por chofer
  yo: null,
  version: -1,
  sincronizado: null,
  ui: { filtros: null, sel: new Set(), pagina: 0, orden: null },
};
export const esAdmin = () => S.yo?.rol === 'admin';
export const usuarioNombre = (u) => S.data?.usuarios.find((x) => x.usuario === u)?.nombre || u || 'Sin asignar';

const VISTAS = {
  dashboard: { label: 'Inicio', icon: 'home', render: renderDashboard },
  choferes: { label: 'Asignaciones', corto: 'Asignados', icon: 'car', render: renderChoferes },
  reclutamiento: { label: 'Reclutamiento', corto: 'Reclutas', icon: 'users', render: renderReclutamiento },
  mensajes: { label: 'Mensajes', corto: 'Mensajes', icon: 'wa', render: renderMensajes },
  actividad: { label: 'Actividad', icon: 'pulse', render: renderActividad },
  importar: { label: 'Importar', icon: 'upload', render: renderImportar }, // todo el equipo puede importar los Excel de DiDi
  admin: { label: 'Administración', corto: 'Admin', icon: 'gear', render: renderAdmin, admin: true },
};

export function vistaActual() { return (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard'); }
export function ir(v, params) { location.hash = `#/${v}${params ? '?' + new URLSearchParams(params) : ''}`; }
export function hashParams() { return new URLSearchParams(location.hash.split('?')[1] || ''); }

// ---------------------------------------------------------------- datos
export async function cargar({ silencioso = false } = {}) {
  const data = await api('/bootstrap');
  S.data = data; S.yo = data.yo; S.version = data.version; S.sincronizado = new Date();
  S.d = derivar(data);
  await cargarEstadoWa();
  if (!silencioso) render(); else rerender();
}
/** Recarga tras una acción propia, conservando la vista. */
export async function recargar() { await cargar({ silencioso: true }); }

// Versión publicada del portal: si se publica una nueva mientras alguien lo tiene abierto, se recarga sola
// (así nadie importa con código viejo). Si está a media importación o con una ventana abierta, solo avisa.
let buildActual = null; let avisoBuild = false;
async function revisarBuild() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' }); if (!r.ok) return;
    const { v } = await r.json();
    if (!buildActual) { buildActual = v; return; }
    if (v === buildActual) return;
    const ocupado = vistaActual() === 'importar' || document.querySelector('.modal') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
    if (!ocupado) { location.reload(); return; }
    if (!avisoBuild) { avisoBuild = true; toast('Hay una versión nueva del portal', { accion: 'Actualizar', onAccion: () => location.reload(), ms: 60000 }); }
  } catch { /* sin conexión: se revisa en la siguiente vuelta */ }
}

let pollTimer;
async function poll() {
  clearTimeout(pollTimer);
  if (getToken() && document.visibilityState === 'visible' && S.data) {
    revisarBuild();
    try {
      const { version } = await api('/version');
      if (version !== S.version) await cargar({ silencioso: true });
      else S.sincronizado = new Date();
      marcarLive(true);
    } catch { marcarLive(false); }
  }
  pollTimer = setTimeout(poll, POLL_MS);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
function marcarLive(ok) {
  $$('.live').forEach((el) => {
    el.classList.toggle('off', !ok);
    el.querySelector('span').textContent = ok ? `En vivo · ${hace(S.sincronizado?.toISOString())}` : 'Sin conexión';
  });
}
setInterval(() => marcarLive(!$('.live.off')), 15000);

// ---------------------------------------------------------------- tema
export function toggleTema() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('tema', dark ? 'dark' : 'light'); } catch {}
  rerender();
}
const temaIcon = () => (document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');

// ---------------------------------------------------------------- login
function renderLogin(msg = '') {
  $('#root').innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <img class="logo" src="assets/didi-mark.jpg" alt="">
    <h1>Choferes Tamez</h1>
    <p class="muted" style="margin:4px 0 0">Seguimiento de conductores · Aliado Autorizado de DiDi</p>
    <form id="flogin" autocomplete="on">
      <label class="field">Usuario<input class="input" name="usuario" autocomplete="username" required autocapitalize="none"></label>
      <label class="field">Contraseña<input class="input" type="password" name="password" autocomplete="current-password" required></label>
      <div class="err" id="lerr">${esc(msg)}</div>
      <button class="btn primary" style="justify-content:center;padding:11px">Entrar</button>
    </form>
    <div class="row" style="margin-top:14px;justify-content:center">
      <button class="btn ghost sm" id="ltema">${icon(temaIcon())} Modo ${document.documentElement.dataset.theme === 'dark' ? 'día' : 'noche'}</button>
    </div>
  </div></div>`;
  $('#ltema').onclick = () => { toggleTema(); renderLogin(); };
  $('#flogin').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const btn = e.target.querySelector('button.primary');
    btn.disabled = true; $('#lerr').textContent = '';
    try {
      const r = await api('/login', { method: 'POST', body: { usuario: f.get('usuario'), password: f.get('password') } });
      setToken(r.token); await iniciar();
    } catch (err) { $('#lerr').textContent = err.message; btn.disabled = false; }
  };
}

// ---------------------------------------------------------------- layout
function navHtml(clase) {
  const v = vistaActual();
  return Object.entries(VISTAS).filter(([, x]) => !x.admin || esAdmin()).map(([k, x]) => {
    let badge = '';
    if (k === 'mensajes') {
      const n = [...S.d.values()].filter((d) => d.ch.wa_no_leidos > 0).length;
      if (n) badge = `<span class="badge b-brand">${n}</span>`;
    }
    if (k === 'choferes') {
      const mios = [...S.d.values()].filter((d) => d.ch.asignado_a === S.yo.usuario && d.seg && !d.contactadoSemana).length;
      if (mios) badge = `<span class="badge b-brand">${mios}</span>`;
    }
    return `<a href="#/${k}" class="${v === k ? 'active' : ''}">${icon(x.icon)}<span>${clase === 'm' ? x.corto || x.label : x.label}</span>${clase === 'm' ? '' : badge}</a>`;
  }).join('');
}

function shell() {
  $('#root').innerHTML = `
  <div class="app">
    <aside class="side">
      <div class="brand"><img src="assets/didi-mark.jpg" alt=""><div><b>Choferes Tamez</b><span>Aliado Autorizado DiDi</span></div></div>
      <nav class="nav" id="nav">${navHtml()}</nav>
      <div class="foot">
        <div class="live"><i></i><span>En vivo</span></div>
        <div class="me">${avatar(S.yo.nombre, S.yo.usuario)}<div style="min-width:0;flex:1"><b style="display:block;font-size:13px">${esc(S.yo.nombre)}</b><span class="small muted">${S.yo.rol === 'admin' ? 'Administrador' : 'Reclutador'}</span></div></div>
        <div class="row">
          <button class="btn sm" id="btema" title="Cambiar tema">${icon(temaIcon())}</button>
          <button class="btn sm" id="bpass" title="Cambiar contraseña">${icon('key')}</button>
          <button class="btn sm" id="bsalir" title="Cerrar sesión">${icon('logout')} Salir</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="mobile-top"><img src="assets/didi-mark.jpg" alt=""><b style="flex:1">Choferes Tamez</b>
        <div class="live"><i></i><span>En vivo</span></div>
        <button class="btn icon sm" id="btema2">${icon(temaIcon())}</button>
        <button class="btn icon sm" id="bmenu">${icon('user')}</button></div>
      <div id="view"></div>
    </main>
    <nav class="mobile-nav" id="mnav">${navHtml('m')}</nav>
  </div>`;
  $('#btema').onclick = toggleTema; $('#btema2').onclick = toggleTema;
  $('#bsalir').onclick = salir; $('#bpass').onclick = cambiarPassword;
  $('#bmenu').onclick = () => {
    const m = modal(`<div class="me" style="margin-bottom:14px">${avatar(S.yo.nombre, S.yo.usuario)}<div><b>${esc(S.yo.nombre)}</b><div class="small muted">${esc(S.yo.usuario)} · ${S.yo.rol}</div></div></div>
      <div class="grid"><button class="btn" id="mp">${icon('key')} Cambiar contraseña</button><button class="btn danger" id="ms">${icon('logout')} Cerrar sesión</button></div>
      <div class="actions"><button class="btn" data-close>Cerrar</button></div>`);
    m.el.querySelector('#mp').onclick = () => { m.close(); cambiarPassword(); };
    m.el.querySelector('#ms').onclick = () => { m.close(); salir(); };
  };
}

function cambiarPassword() {
  const m = modal(`<h2>Cambiar contraseña</h2><form id="fp" class="grid">
    <label class="field">Contraseña actual<input class="input" type="password" name="actual" required autocomplete="current-password"></label>
    <label class="field">Nueva contraseña (mín. 8)<input class="input" type="password" name="nueva" minlength="8" required autocomplete="new-password"></label>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  m.el.querySelector('#fp').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await api('/password', { method: 'POST', body: { actual: f.get('actual'), nueva: f.get('nueva') } }); toast('Contraseña actualizada'); m.close(); }
    catch (err) { toast(err.message, { tipo: 'err' }); }
  };
}

function salir() { setToken(null); S.data = null; location.hash = ''; renderLogin(); }
window.addEventListener('sesion-expirada', () => renderLogin('Tu sesión expiró. Vuelve a entrar.'));

// ---------------------------------------------------------------- render
export function render() {
  if (!S.data) return;
  if (!$('#nav')) shell();
  let v = vistaActual();
  if (!VISTAS[v] || (VISTAS[v].admin && !esAdmin())) { v = 'dashboard'; }
  $('#nav').innerHTML = navHtml(); $('#mnav').innerHTML = navHtml('m');
  const el = $('#view');
  el.dataset.vista = v;
  VISTAS[v].render(el);
  const id = hashParams().get('chofer');
  if (id) abrirChofer(id);
  marcarLive(true);
}
/** Re-render sin perder scroll (para la sincronización). */
function rerender() {
  if (!S.data || !$('#nav')) return render();
  const y = window.scrollY;
  const v = vistaActual();
  $('#nav').innerHTML = navHtml(); $('#mnav').innerHTML = navHtml('m');
  // No re-pintamos Importar mientras hay un proceso en curso
  if (v !== 'importar' && !document.querySelector('.modal')) { const el = $('#view'); el.dataset.vista = v; VISTAS[VISTAS[v] ? v : 'dashboard'].render(el); }
  refrescarDrawer();
  window.scrollTo(0, y);
}

let ultimaVista = null;
window.addEventListener('hashchange', () => {
  const v = vistaActual();
  if (v !== ultimaVista) { ultimaVista = v; window.scrollTo(0, 0); }
  const id = hashParams().get('chofer');
  if (!id) document.querySelectorAll('.drawer, .drawer-scrim').forEach((x) => x.remove());
  if (S.data && $('#view')?.dataset.vista === v && id) { abrirChofer(id); return; }
  render();
});

async function iniciar() {
  $('#root').innerHTML = '<div class="login-wrap"><div class="muted">Cargando…</div></div>';
  try { await cargar(); ultimaVista = vistaActual(); poll(); }
  catch (e) { if (getToken()) renderLogin(e.message); }
}

if (getToken()) iniciar(); else renderLogin();
