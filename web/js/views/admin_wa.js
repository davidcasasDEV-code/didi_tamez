// Administración → tarjeta de WhatsApp Business API: credenciales, webhook, prueba de conexión y mapeo de plantillas.
import { S } from '../app.js';
import { api } from '../api.js';
import { esc, icon, toast, copiar } from '../util.js';
import { VARIABLES_DISPONIBLES } from '../logic.js';
import { cargarEstadoWa } from '../wa.js';

const USOS = [['bienvenida', 'Bienvenida (primer contacto)'], ['seguimiento', 'Seguimiento'], ['documentos', 'Documentos pendientes'], ['otro', 'Otro']];

export function waCardHtml() {
  const w = S.wa || {};
  const n = w.numero;
  const pls = w.plantillas || [];
  return `
    <div class="card-h"><h2 style="flex:1">WhatsApp Business API (oficial)</h2>
      ${w.configurado ? '<span class="badge b-ok">Conectado</span>' : '<span class="badge b-warn">Sin conectar</span>'}</div>
    <p class="small muted" style="margin-top:-4px">Datos de la app de Meta (ver la guía “Alta WhatsApp Business API - paso a paso”). El token y la clave secreta se guardan cifrados en AWS y no se vuelven a mostrar.</p>
    <form id="fwa" class="grid" style="grid-template-columns:1fr 1fr">
      <label class="field">Phone number ID<input class="input" name="phone_number_id" value="${esc(w.phone_number_id || '')}" inputmode="numeric"></label>
      <label class="field">WABA ID (cuenta de WhatsApp Business)<input class="input" name="waba_id" value="${esc(w.waba_id || '')}" inputmode="numeric"></label>
      <label class="field">Token del usuario del sistema ${w.tiene_token ? '<span class="badge b-ok">guardado</span>' : ''}
        <input class="input" type="password" name="token" autocomplete="off" placeholder="${w.tiene_token ? 'déjalo vacío para no cambiarlo' : 'EAAG…'}"></label>
      <label class="field">Clave secreta de la app (App Secret) ${w.tiene_app_secret ? '<span class="badge b-ok">guardada</span>' : ''}
        <input class="input" type="password" name="app_secret" autocomplete="off" placeholder="${w.tiene_app_secret ? 'déjalo vacío para no cambiarlo' : ''}"></label>
      <label class="field">Límite de plantillas por persona al día<input class="input" type="number" min="1" max="1000" name="limite_diario" value="${w.limite_diario || 100}"></label>
      <div class="field">Webhook para configurar en Meta (campo <b>messages</b>)
        <div class="small">URL: <code>${esc(w.webhook_url || '')}</code> <button type="button" class="btn sm" data-copiar="${esc(w.webhook_url || '')}">${icon('copy')}</button></div>
        <div class="small">Token de verificación: ${w.verify_token ? `<code>${esc(w.verify_token)}</code> <button type="button" class="btn sm" data-copiar="${esc(w.verify_token)}">${icon('copy')}</button>` : '<span class="muted">se genera al guardar</span>'}</div>
      </div>
      <div class="actions" style="grid-column:1/-1;margin-top:0">
        ${n ? `<span class="small" style="margin-right:auto">${esc(n.telefono || '')} · ${esc(n.nombre || '')} · calidad <b>${esc(n.calidad || '—')}</b>${n.limite ? ` · límite ${esc(n.limite)}` : ''}</span>` : ''}
        <button type="button" class="btn" id="waprobar" ${w.configurado ? '' : 'disabled'}>Probar conexión</button>
        <button class="btn primary">Guardar</button>
      </div>
    </form>
    <div class="card-h" style="margin-top:14px"><h3 style="flex:1">Plantillas de Meta</h3>
      <button class="btn sm" id="wasync" ${w.waba_id && w.tiene_token ? '' : 'disabled'}>${icon('refresh')} Sincronizar con Meta</button></div>
    ${pls.length ? `<div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>Plantilla</th><th>Estado</th><th>Texto</th><th>Qué dato va en cada {{n}}</th><th>Uso</th></tr></thead><tbody>
      ${pls.map((p, i) => `<tr style="cursor:default"><td><b>${esc(p.nombre)}</b><div class="small muted">${esc(p.idioma)} · ${esc(p.categoria || '')}</div></td>
        <td><span class="badge ${p.estado === 'APPROVED' ? 'b-ok' : p.estado === 'REJECTED' ? 'b-bad' : 'b-warn'}">${esc(p.estado)}</span></td>
        <td class="small" style="max-width:320px;white-space:pre-wrap">${esc(p.cuerpo)}</td>
        <td>${Array.from({ length: p.n_variables }, (_, k) => `<div class="row small" style="flex-wrap:nowrap;margin-bottom:4px">{{${k + 1}}}
          <select class="input" data-wap="${i}" data-k="${k}" style="padding:4px 6px">${VARIABLES_DISPONIBLES.map((v) => `<option ${p.params?.[k] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('') || '<span class="muted small">sin variables</span>'}</td>
        <td><select class="input" data-wauso="${i}" style="padding:4px 6px">${USOS.map(([k, l]) => `<option value="${k}" ${p.uso === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="muted small">Aún no hay plantillas. Créalas en WhatsApp Manager y pulsa “Sincronizar con Meta”.</div>'}`;
}

export function waCardEventos(el) {
  const card = el.querySelector('#wacard'); if (!card) return;
  const repintar = async () => { await cargarEstadoWa(); card.innerHTML = waCardHtml(); waCardEventos(el); };
  card.querySelectorAll('[data-copiar]').forEach((b) => (b.onclick = async () => { await copiar(b.dataset.copiar); toast('Copiado'); }));
  card.querySelector('#fwa').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (!body.token) delete body.token;
    if (!body.app_secret) delete body.app_secret;
    try { await api('/whatsapp/config', { method: 'PUT', body }); toast('Configuración de WhatsApp guardada'); await repintar(); }
    catch (err) { toast(err.message, { tipo: 'err', ms: 8000 }); }
  };
  card.querySelector('#waprobar')?.addEventListener('click', async () => {
    try { const n = await api('/whatsapp/probar', { method: 'POST' }); toast(`Conectado: ${n.telefono} · ${n.nombre}`); await repintar(); }
    catch (err) { toast(err.message, { tipo: 'err', ms: 10000 }); }
  });
  card.querySelector('#wasync')?.addEventListener('click', async () => {
    try { const p = await api('/whatsapp/plantillas/sincronizar', { method: 'POST' }); toast(`${p.length} plantilla(s) sincronizadas`); await repintar(); }
    catch (err) { toast(err.message, { tipo: 'err', ms: 10000 }); }
  });
  const guardarMapeo = async (i, cambio) => {
    const p = S.wa.plantillas[+i];
    try { await api('/whatsapp/plantillas', { method: 'PUT', body: { nombre: p.nombre, idioma: p.idioma, ...cambio } }); toast('Plantilla actualizada'); await cargarEstadoWa(); }
    catch (err) { toast(err.message, { tipo: 'err' }); }
  };
  card.querySelectorAll('[data-wap]').forEach((s) => (s.onchange = () => {
    const p = S.wa.plantillas[+s.dataset.wap]; const params = [...(p.params || [])]; params[+s.dataset.k] = s.value;
    guardarMapeo(s.dataset.wap, { params });
  }));
  card.querySelectorAll('[data-wauso]').forEach((s) => (s.onchange = () => guardarMapeo(s.dataset.wauso, { uso: s.value })));
}
