// WhatsApp Business API desde el portal: estado, envío de plantillas (uno o varios) y mensajes dentro de la ventana de 24 h.
import { S, recargar } from './app.js';
import { api } from './api.js';
import { esc, icon, modal, toast, titulo, celBonito } from './util.js';
import { variables } from './logic.js';

export const waListo = () => !!S.wa?.configurado;
export const plantillasAprobadas = () => (S.wa?.plantillas || []).filter((p) => p.estado === 'APPROVED');
export const ventanaAbierta = (ch) => !!(ch.wa_ventana_hasta && ch.wa_ventana_hasta > new Date().toISOString());

export async function cargarEstadoWa() {
  try { S.wa = await api('/whatsapp/estado'); } catch { S.wa = null; }
  return S.wa;
}

/** Valores de las variables {{1}}, {{2}}… de una plantilla para un chofer, según el mapeo hecho en Administración. */
export function valoresPlantilla(p, d) {
  const v = variables(d, S.yo, S.data.ajustes);
  return (p.params || []).map((k) => String(v[k] ?? '').replace(/\s*\n\s*/g, ' · ') || '-');
}
const llenarMeta = (p, valores) => p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, i) => valores[+i - 1] ?? '');

function sugerirPlantilla(d, pls) {
  const by = (uso) => pls.find((p) => p.uso === uso);
  if (!d.ch.bienvenida_enviada) return by('bienvenida') || pls[0];
  if (d.docs?.length && !d.cats.has('asignacion')) return by('documentos') || pls[0];
  return by('seguimiento') || pls[0];
}

/** Ventana para escribirle a un chofer por la API (plantilla o, si contestó en las últimas 24 h, mensaje libre). */
export function componerWa(id, { alEnviar } = {}) {
  const d = S.d.get(id); if (!d) return;
  if (!waListo()) { toast('WhatsApp API aún no está configurado (Administración)', { tipo: 'err' }); return; }
  const pls = plantillasAprobadas();
  const abierta = ventanaAbierta(d.ch);
  let actual = sugerirPlantilla(d, pls);
  const m = modal(`
    <div class="row" style="margin-bottom:8px"><div style="flex:1"><h2 style="margin:0">WhatsApp a ${esc(titulo(d.ch.nombre || ''))}</h2>
      <div class="small muted">${esc(celBonito(d.ch.cel))} · enviado desde el número de Autos Tamez</div></div>
      <button class="btn icon ghost" data-close>${icon('x')}</button></div>
    ${abierta ? `<div class="badge b-ok" style="margin-bottom:10px">Ventana abierta: puedes escribirle libre hasta ${new Date(d.ch.wa_ventana_hasta).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</div>` : '<div class="small muted" style="margin-bottom:10px">Solo se puede iniciar con una plantilla aprobada por Meta. Cuando conteste, podrás escribirle libre durante 24 h.</div>'}
    <div class="tabs" style="margin-bottom:10px">
      <button class="tab ${abierta ? '' : 'active'}" data-modo="plantilla">Plantilla</button>
      ${abierta ? '<button class="tab active" data-modo="texto">Mensaje libre</button>' : ''}
    </div>
    <div id="mplant" class="${abierta ? 'hidden' : ''}">
      ${pls.length ? `<select class="input" id="wsel">${pls.map((p) => `<option value="${esc(p.nombre)}|${esc(p.idioma)}" ${p === actual ? 'selected' : ''}>${esc(p.nombre)} · ${esc(p.uso || '')}</option>`).join('')}</select>
      <div class="tpl-preview" id="wprev" style="margin-top:10px"></div>` : '<div class="err">No hay plantillas aprobadas. Pide al administrador sincronizarlas.</div>'}
    </div>
    <div id="mtexto" class="${abierta ? '' : 'hidden'}">
      <textarea class="input" id="wtxt" rows="6" placeholder="Escribe tu mensaje…"></textarea>
      <div class="small muted" style="margin-top:4px">Tip: aquí va el mensaje largo de bienvenida con el Anexo D cuando el chofer contesta SÍ.</div>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="wbienv">Insertar bienvenida completa</button></div>
    </div>
    <div class="actions"><span class="small muted" style="margin-right:auto">Hoy llevas ${S.wa.enviados_hoy || 0} de ${S.wa.limite_diario} plantillas · <a href="#" id="wmanual">usar mi WhatsApp</a></span>
      <button class="btn" data-close>Cancelar</button><button class="btn wa" id="wsend">${icon('wa')} Enviar</button></div>`, { wide: true });
  let modo = abierta ? 'texto' : 'plantilla';
  const prev = () => { const p = m.el.querySelector('#wprev'); if (p && actual) p.textContent = llenarMeta(actual, valoresPlantilla(actual, d)); };
  prev();
  m.el.querySelector('#wsel')?.addEventListener('change', (e) => { const [n, l] = e.target.value.split('|'); actual = pls.find((p) => p.nombre === n && p.idioma === l); prev(); });
  m.el.querySelectorAll('[data-modo]').forEach((b) => (b.onclick = () => {
    modo = b.dataset.modo; m.el.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('active', x === b));
    m.el.querySelector('#mplant').classList.toggle('hidden', modo !== 'plantilla'); m.el.querySelector('#mtexto').classList.toggle('hidden', modo !== 'texto');
  }));
  m.el.querySelector('#wbienv')?.addEventListener('click', () => {
    const t = S.data.plantillas.find((p) => p.categoria === 'bienvenida');
    if (t) m.el.querySelector('#wtxt').value = t.texto.replace(/\{(\w+)\}/g, (x, k) => variables(d, S.yo, S.data.ajustes)[k] ?? x);
  });
  m.el.querySelector('#wmanual').onclick = (e) => { e.preventDefault(); m.close(); import('./views/chofer.js').then((x) => x.abrirPlantillasManual(id)); };
  m.el.querySelector('#wsend').onclick = async () => {
    const btn = m.el.querySelector('#wsend'); btn.disabled = true;
    try {
      if (modo === 'texto') {
        const texto = m.el.querySelector('#wtxt').value.trim(); if (!texto) throw new Error('Escribe un mensaje');
        await api('/whatsapp/enviar-texto', { method: 'POST', body: { id, texto, bienvenida: /anexo d/i.test(texto) } });
      } else {
        if (!actual) throw new Error('Elige una plantilla');
        await enviarPlantilla(d, actual);
      }
      toast('Mensaje enviado'); m.close(); await cargarEstadoWa(); await recargar(); alEnviar?.();
    } catch (e) {
      if (/pidió no recibir/.test(e.message) && confirm(`${e.message}\n\n¿Enviar de todas formas?`)) {
        try { await enviarPlantilla(d, actual, true); toast('Mensaje enviado'); m.close(); await recargar(); return; } catch (e2) { toast(e2.message, { tipo: 'err', ms: 8000 }); }
      } else toast(e.message, { tipo: 'err', ms: 8000 });
      btn.disabled = false;
    }
  };
}

const enviarPlantilla = (d, p, forzar = false) => api('/whatsapp/enviar-plantilla', {
  method: 'POST', body: { id: d.ch.id, nombre: p.nombre, idioma: p.idioma, valores: valoresPlantilla(p, d), forzar },
});

/** Envío de una plantilla a varios choferes seleccionados (uno por uno, con avance). */
export function enviarLote(ids, { alTerminar } = {}) {
  if (!waListo()) { toast('WhatsApp API aún no está configurado (Administración)', { tipo: 'err' }); return; }
  const pls = plantillasAprobadas();
  if (!pls.length) { toast('No hay plantillas aprobadas', { tipo: 'err' }); return; }
  const ds = ids.map((id) => S.d.get(id)).filter(Boolean);
  const sinCel = ds.filter((d) => !d.ch.cel).length;
  const bloqueados = ds.filter((d) => ['opt_out', 'no_interesado'].includes(d.ch.estatus_contacto)).length;
  const restantes = Math.max(0, (S.wa.limite_diario || 0) - (S.wa.enviados_hoy || 0));
  let actual = pls[0];
  const ejemplo = ds.find((d) => d.ch.cel) || ds[0];
  const m = modal(`<h2>Enviar plantilla a ${ds.length} chofer(es)</h2>
    <select class="input" id="lsel">${pls.map((p) => `<option value="${esc(p.nombre)}|${esc(p.idioma)}">${esc(p.nombre)} · ${esc(p.uso || '')}</option>`).join('')}</select>
    <div class="small muted" style="margin:8px 0 4px">Vista previa con ${esc(titulo(ejemplo?.ch.nombre || ''))}:</div>
    <div class="tpl-preview" id="lprev"></div>
    <div class="small" style="margin-top:10px">${sinCel ? `${sinCel} sin celular se omiten · ` : ''}${bloqueados ? `${bloqueados} pidieron no recibir mensajes y se omiten · ` : ''}Te quedan <b>${restantes}</b> envíos hoy.</div>
    <div class="progress hidden" id="lbar" style="margin-top:10px"><i></i></div><div class="small muted" id="lmsg"></div>
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn wa" id="lgo">${icon('wa')} Enviar</button></div>`);
  const prev = () => { m.el.querySelector('#lprev').textContent = ejemplo ? llenarMeta(actual, valoresPlantilla(actual, ejemplo)) : ''; };
  prev();
  m.el.querySelector('#lsel').onchange = (e) => { const [n, l] = e.target.value.split('|'); actual = pls.find((p) => p.nombre === n && p.idioma === l); prev(); };
  m.el.querySelector('#lgo').onclick = async () => {
    const btn = m.el.querySelector('#lgo'); btn.disabled = true;
    const lista = ds.filter((d) => d.ch.cel && !['opt_out', 'no_interesado'].includes(d.ch.estatus_contacto));
    const bar = m.el.querySelector('#lbar'); const msg = m.el.querySelector('#lmsg'); bar.classList.remove('hidden');
    let ok = 0; const errores = [];
    for (let i = 0; i < lista.length; i++) {
      msg.textContent = `Enviando ${i + 1} de ${lista.length}…`;
      try { await enviarPlantilla(lista[i], actual); ok++; } catch (e) {
        errores.push(`${titulo(lista[i].ch.nombre || '')}: ${e.message}`);
        if (/límite/.test(e.message)) break;
      }
      bar.firstElementChild.style.width = `${((i + 1) / lista.length) * 100}%`;
      await new Promise((r) => setTimeout(r, 400)); // ritmo moderado
    }
    msg.innerHTML = `<b>${ok} enviados</b>${errores.length ? ` · ${errores.length} con error:<br>${errores.slice(0, 5).map(esc).join('<br>')}` : ''}`;
    btn.textContent = 'Listo'; btn.disabled = false; btn.onclick = () => m.close();
    await cargarEstadoWa(); await recargar(); alTerminar?.();
  };
}
