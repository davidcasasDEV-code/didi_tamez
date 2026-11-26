// Feed de actividad del equipo (se actualiza con la sincronización automática).
import { S } from '../app.js';
import { api } from '../api.js';
import { esc, icon, hace, fmtFecha, titulo, avatar } from '../util.js';

const ICONO = { whatsapp: 'wa', llamada: 'phone', visita: 'pin', nota: 'note', estatus: 'check', asignacion: 'users', import: 'upload', copiado: 'copy' };
const VERBO = { whatsapp: 'WhatsApp', llamada: 'Llamada', visita: 'Visita', nota: 'Nota', estatus: 'Estatus', asignacion: 'Asignación', import: 'Importación' };

export function eventoHtml(e, { sinNombre = false } = {}) {
  const chofer = e.extra?.nombre && !sinNombre && e.id && !e.id.startsWith('_')
    ? ` · <a href="#/actividad?chofer=${encodeURIComponent(e.id)}">${esc(titulo(e.extra.nombre))}</a>` : '';
  return `<div class="tl">
    <div class="ic ${esc(e.tipo)}">${icon(ICONO[e.tipo] || 'note')}</div>
    <div style="min-width:0">
      <div><b>${esc(e.usuario_nombre || e.usuario)}</b> <span class="muted">· ${esc(VERBO[e.tipo] || e.tipo)}</span>${chofer}</div>
      <div class="txt">${esc(e.resultado || '')}${e.plantilla ? ` <span class="badge">${esc(e.plantilla)}</span>` : ''}</div>
      ${e.nota ? `<div class="txt muted">${esc(e.nota)}</div>` : ''}
      <div class="meta" title="${esc(fmtFecha(e.fecha, true))}">${hace(e.fecha)}</div>
    </div></div>`;
}

export async function renderActividad(el) {
  const filtro = S.ui.actUsuario || '';
  el.innerHTML = `<div class="topbar"><div><h1>Actividad del equipo</h1><div class="muted">Lo que cada quien está haciendo, en vivo</div></div>
    <div class="spacer"></div>
    <select class="input" id="afu" style="width:auto"><option value="">Todo el equipo</option>${S.data.usuarios.map((u) => `<option value="${esc(u.usuario)}" ${filtro === u.usuario ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></div>
    <div class="cols-2"><div class="card"><div class="timeline" id="afeed"><div class="muted">Cargando…</div></div></div>
    <div class="card"><h2>Hoy por persona</h2><div id="ahoy" class="grid" style="margin-top:10px"></div></div></div>`;
  el.querySelector('#afu').onchange = (e) => { S.ui.actUsuario = e.target.value; renderActividad(el); };
  try {
    const evs = await api('/actividad?limit=200');
    const lista = filtro ? evs.filter((e) => e.usuario === filtro) : evs;
    const feed = el.querySelector('#afeed'); if (!feed) return;
    feed.innerHTML = lista.length ? lista.map((e) => eventoHtml(e)).join('') : '<div class="muted">Sin actividad.</div>';
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const porU = {};
    evs.filter((e) => new Date(e.fecha) >= hoy && ['whatsapp', 'llamada', 'visita', 'nota', 'estatus'].includes(e.tipo))
      .forEach((e) => { (porU[e.usuario] ||= { n: e.usuario_nombre, wa: 0, ll: 0, otros: 0 }); const x = porU[e.usuario]; e.tipo === 'whatsapp' ? x.wa++ : e.tipo === 'llamada' ? x.ll++ : x.otros++; });
    const rows = Object.entries(porU).sort((a, b) => (b[1].wa + b[1].ll) - (a[1].wa + a[1].ll));
    el.querySelector('#ahoy').innerHTML = rows.length ? rows.map(([u, x]) => `<div class="row">${avatar(x.n, u)}<b style="flex:1">${esc(x.n)}</b>
      <span class="badge">${icon('wa')} ${x.wa}</span><span class="badge">${icon('phone')} ${x.ll}</span><span class="badge">${x.otros} otros</span></div>`).join('')
      : '<div class="muted small">Nadie ha registrado contactos hoy.</div>';
  } catch (e) { el.querySelector('#afeed').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
