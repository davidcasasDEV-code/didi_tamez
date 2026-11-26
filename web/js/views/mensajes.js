// Bandeja de WhatsApp (API oficial): conversaciones con los choferes, respuestas y estados de entrega.
import { S, esAdmin, usuarioNombre, hashParams, recargar } from '../app.js';
import { api } from '../api.js';
import { esc, icon, hace, toast, titulo, celBonito } from '../util.js';
import { waListo, ventanaAbierta, componerWa } from '../wa.js';

let abierta = null; let cargando = false;
const TICKS = { enviado: '✓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠' };

export function renderMensajes(el) {
  S.ui.msg ||= { filtro: esAdmin() ? 'todos' : 'mios', q: '' };
  const f = S.ui.msg;
  abierta = hashParams().get('c') || abierta;
  if (!waListo()) {
    el.innerHTML = `<div class="topbar"><div><h1>Mensajes</h1><div class="muted">Bandeja de WhatsApp Business</div></div></div>
      <div class="card empty"><h2>WhatsApp aún no está conectado</h2>
      <p>Cuando Autos Tamez termine el alta de la API oficial de WhatsApp, aquí llegarán las respuestas de los choferes.</p>
      ${esAdmin() ? '<a class="btn primary" href="#/admin">Ir a Administración → WhatsApp</a>' : ''}</div>`;
    return;
  }
  const q = f.q.trim().toLowerCase();
  const convs = [...S.d.values()].filter((d) => d.ch.wa_ultimo).filter((d) => {
    if (f.filtro === 'mios' && d.ch.asignado_a !== S.yo.usuario && d.ch.reclutado_por !== S.yo.usuario && !(d.ch.listas || {})[S.yo.usuario]) return false;
    if (f.filtro === 'sinleer' && !(d.ch.wa_no_leidos > 0)) return false;
    if (q && !`${d.ch.nombre} ${d.ch.cel}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => String(b.ch.wa_ultimo.fecha).localeCompare(String(a.ch.wa_ultimo.fecha)));
  const sinLeer = [...S.d.values()].filter((d) => d.ch.wa_no_leidos > 0).length;

  el.innerHTML = `
  <div class="topbar"><div><h1>Mensajes</h1><div class="muted">WhatsApp de Autos Tamez · ${sinLeer ? `<b>${sinLeer} sin leer</b> · ` : ''}hoy llevas ${S.wa.enviados_hoy || 0} de ${S.wa.limite_diario} plantillas</div></div></div>
  <div class="wa-wrap">
    <div class="card wa-list">
      <div class="tabs" style="margin-bottom:8px">
        ${[['mios', 'Míos'], ['sinleer', `Sin leer${sinLeer ? ` (${sinLeer})` : ''}`], ['todos', 'Todos']].map(([k, l]) => `<button class="tab ${f.filtro === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}
      </div>
      <input class="input" id="mq" placeholder="Buscar…" value="${esc(f.q)}" style="margin-bottom:8px">
      <div class="wa-items">${convs.length ? convs.map((d) => {
        const c = d.ch; const u = c.wa_ultimo;
        return `<div class="wa-item ${c.id === abierta ? 'active' : ''}" data-c="${esc(c.id)}">
          <div class="row" style="flex-wrap:nowrap"><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(titulo(c.nombre || c.cel))}</b>
            <span class="small muted nowrap">${hace(u.fecha)}</span></div>
          <div class="row" style="flex-wrap:nowrap"><span class="small muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.dir === 'out' ? '↗ ' : ''}${esc(u.texto)}</span>
            ${c.wa_no_leidos > 0 ? `<span class="badge b-brand">${c.wa_no_leidos}</span>` : ''}</div>
        </div>`;
      }).join('') : '<div class="muted small" style="padding:12px">Sin conversaciones con este filtro.</div>'}</div>
    </div>
    <div class="card wa-chat" id="wchat">${abierta ? '<div class="muted">Cargando…</div>' : '<div class="empty muted">Elige una conversación</div>'}</div>
  </div>`;

  el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { f.filtro = b.dataset.f; renderMensajes(el); }));
  let t; el.querySelector('#mq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; renderMensajes(el); const i = el.querySelector('#mq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  el.querySelectorAll('[data-c]').forEach((x) => (x.onclick = () => { abierta = x.dataset.c; history.replaceState(null, '', `#/mensajes?c=${encodeURIComponent(abierta)}`); renderMensajes(el); }));
  if (abierta) pintarChat(el.querySelector('#wchat'), abierta);
}

async function pintarChat(box, id) {
  const d = S.d.get(id); if (!d) { box.innerHTML = '<div class="empty muted">Conversación no disponible</div>'; return; }
  if (cargando) return; cargando = true;
  let msgs = [];
  try { msgs = await api(`/whatsapp/conversacion/${encodeURIComponent(id)}`); } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; cargando = false; return; }
  cargando = false;
  if (d.ch.wa_no_leidos > 0) { d.ch.wa_no_leidos = 0; api(`/whatsapp/leido/${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {}); }
  const c = d.ch; const abiertaV = ventanaAbierta(c);
  const enfocado = document.activeElement?.id === 'wtext' ? document.activeElement.value : null;
  box.innerHTML = `
    <div class="row" style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px">
      <div style="flex:1;min-width:0"><b>${esc(titulo(c.nombre || ''))}</b><div class="small muted">${esc(celBonito(c.cel))}${c.asignado_a ? ` · asignado a ${esc(usuarioNombre(c.asignado_a))}` : ''}${c.reclutado_por ? ` · reclutó ${esc(usuarioNombre(c.reclutado_por))}` : ''}</div></div>
      <a class="btn sm" href="#/mensajes?c=${encodeURIComponent(id)}&chofer=${encodeURIComponent(id)}">Ver ficha</a>
    </div>
    <div class="wa-msgs" id="wmsgs">${msgs.length ? msgs.map((m) => `
      <div class="wa-msg ${m.dir}">
        <div class="txt">${esc(m.texto)}</div>
        <div class="meta">${m.dir === 'out' ? `${esc((m.por_nombre || '').split(' ')[0])} · ` : ''}${new Date(m.fecha).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          ${m.dir === 'out' ? `<span class="tick ${m.estado === 'read' ? 'leido' : ''}" title="${esc(m.estado || '')}${m.error ? ': ' + esc(m.error) : ''}">${TICKS[m.estado] || ''}</span>` : ''}</div>
        ${m.error ? `<div class="small" style="color:var(--bad)">${esc(m.error)}</div>` : ''}
      </div>`).join('') : '<div class="muted small">Aún no hay mensajes con este chofer.</div>'}</div>
    <div class="wa-compose">
      ${abiertaV ? `<textarea class="input" id="wtext" rows="2" placeholder="Escribe una respuesta… (Enter para enviar, Shift+Enter salto de línea)"></textarea>
        <div class="row" style="margin-top:6px"><span class="small muted">Ventana abierta hasta ${new Date(c.wa_ventana_hasta).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span><span class="spacer"></span>
        <button class="btn sm" id="wtpl">Plantilla…</button><button class="btn sm wa" id="wsendt">${icon('wa')} Enviar</button></div>`
      : `<div class="row"><span class="small muted" style="flex:1">Pasaron más de 24 h desde su último mensaje: para escribirle hay que usar una plantilla aprobada.</span><button class="btn sm wa" id="wtpl">${icon('wa')} Enviar plantilla</button></div>`}
    </div>`;
  const lista = box.querySelector('#wmsgs'); lista.scrollTop = lista.scrollHeight;
  const ta = box.querySelector('#wtext');
  if (ta && enfocado !== null) { ta.value = enfocado; ta.focus(); }
  box.querySelector('#wtpl')?.addEventListener('click', () => componerWa(id, { alEnviar: () => pintarChat(box, id) }));
  const enviar = async () => {
    const texto = ta.value.trim(); if (!texto) return;
    const b = box.querySelector('#wsendt'); b.disabled = true;
    try { await api('/whatsapp/enviar-texto', { method: 'POST', body: { id, texto } }); ta.value = ''; await recargar(); await pintarChat(box, id); }
    catch (e) { toast(e.message, { tipo: 'err', ms: 8000 }); b.disabled = false; }
  };
  box.querySelector('#wsendt')?.addEventListener('click', enviar);
  ta?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
}
