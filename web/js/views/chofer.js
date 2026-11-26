// Detalle de un chofer (panel lateral) y selector de plantillas de WhatsApp.
import { S, esAdmin, usuarioNombre, recargar, hashParams } from '../app.js';
import { api } from '../api.js';
import { esc, icon, fmtNum, fmtMoney, fmtFecha, celBonito, telLink, waLink, toast, modal, copiar, titulo, hace, confirmar } from '../util.js';
import { ESTATUS_CONTACTO, SEGMENTOS, semanaLabel, variables, llenar, sugerida, VARIABLES_DISPONIBLES } from '../logic.js';
import { segHtml, estatusHtml } from './choferes.js';
import { eventoHtml } from './actividad.js';

let abiertoId = null;
const RESULTADOS = ['Respondió SÍ (quiere el soporte)', 'Respondió NO (no quiere el soporte)', 'Respondió', 'Se queda', 'Se quiere ir · se mandó liga de salida', 'Sin respuesta', 'Número equivocado', 'Buzón / no contesta', 'Otro trabajo', 'No le entran viajes', 'Tarifas', 'Beneficios', 'Agendó visita a oficina', 'Subirá documentos', 'Ya subió documentos', 'Problema con la app', 'Otro'];

function cerrar() {
  abiertoId = null;
  document.querySelectorAll('.drawer, .drawer-scrim').forEach((x) => x.remove());
  const p = hashParams();
  if (p.has('chofer')) { p.delete('chofer'); const v = location.hash.replace(/^#\/?/, '').split('?')[0] || 'choferes'; history.replaceState(null, '', `#/${v}${[...p].length ? '?' + p : ''}`); }
}

export function abrirChofer(id) {
  const d = S.d.get(id);
  if (!d) { toast('Ese chofer ya no está en la base', { tipo: 'err' }); cerrar(); return; }
  abiertoId = id;
  let dr = document.querySelector('.drawer');
  if (!dr) {
    const scrim = document.createElement('div'); scrim.className = 'scrim drawer-scrim'; scrim.onclick = cerrar;
    dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('role', 'dialog');
    document.body.append(scrim, dr);
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape' && !document.querySelector('.modal')) { cerrar(); document.removeEventListener('keydown', onKey); } });
  }
  pintar(dr, d);
}

export function refrescarDrawer() {
  const dr = document.querySelector('.drawer'); if (!dr || !abiertoId) return;
  if (dr.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; // no interrumpir mientras escribe
  const d = S.d.get(abiertoId); if (d) pintar(dr, d);
}

function pintar(dr, d) {
  const c = d.ch; const ws = d.semanas.slice(0, 3);
  const m = S.data.metricas[c.id] || {};
  const puedeAsignarme = false; // el reparto lo hace el administrador
  const usuarios = S.data.usuarios.filter((u) => u.activo);
  const segTxt = d.seg ? `<b>${d.seg} · ${SEGMENTOS[d.seg].nombre}</b><div class="small muted">Plan: ${SEGMENTOS[d.seg].plan}</div>` : '<span class="muted">Sin segmento de contacto proactivo esta semana</span>';
  const fila = (lbl, k, dec = 0, money = false) => `<tr style="cursor:default"><td class="muted">${lbl}</td>${ws.map((w) => `<td class="num">${m[w] ? (money ? fmtMoney(m[w][k]) : fmtNum(m[w][k], dec)) : '—'}</td>`).join('')}</tr>`;
  const docCls = (v) => (/aprob|approved/i.test(v) ? 'b-ok' : /rechaz|reject|expir/i.test(v) ? 'b-bad' : /sin subir|pending|review/i.test(v) ? 'b-warn' : '');
  const scroll = dr.scrollTop;

  dr.innerHTML = `
  <div class="drawer-h">
    <div class="row" style="flex-wrap:nowrap">
      <div style="flex:1;min-width:0"><h2 style="font-size:18px">${esc(titulo(c.nombre || '(sin nombre)'))}</h2>
        <div class="small muted">${esc(celBonito(c.cel))} · ID ${esc(c.id)}</div></div>
      ${segHtml(d)}
      <button class="btn icon ghost" id="dedit" title="Editar datos">${icon('edit')}</button>
      ${puedeEliminar(c) ? `<button class="btn icon ghost danger" id="ddel" title="Eliminar">${icon('trash')}</button>` : ''}
      <button class="btn icon ghost" id="dx" title="Cerrar">${icon('x')}</button>
    </div>
    ${c.cel ? `<div class="row" style="margin-top:10px">
      <button class="btn wa" id="dwa">${icon('wa')} Plantillas WhatsApp</button>
      <a class="btn" href="${telLink(c.cel)}" id="dtel">${icon('phone')} Llamar</a>
      <a class="btn" href="${waLink(c.cel)}" target="_blank" rel="noopener" id="dchat">Abrir chat</a>
    </div>` : '<div class="small" style="margin-top:8px;color:var(--warn)">DiDi no envió celular para esta persona. Agrégalo abajo en “Celular alterno” para poder contactarla.</div>'}
  </div>
  <div class="drawer-b">
    <div class="card">
      <div class="row" style="align-items:flex-start"><div style="flex:1">${segTxt}</div>
        ${c.segmento_didi ? `<span class="badge" title="Segmento que venía en el Excel de DiDi">DiDi: ${esc(c.segmento_didi)}</span>` : ''}</div>
      <div class="row" style="margin-top:8px">
        ${d.contactadoSemana ? `<span class="badge b-ok">${icon('check')} Contactado esta semana</span>` : ''}
        ${c.bienvenida_enviada ? `<span class="badge b-ok">Bienvenida y Anexo D enviados · ${esc(fmtFecha(c.bienvenida_enviada))}</span>` : '<span class="badge b-warn">Falta mandar bienvenida y Anexo D</span>'}
        ${c.activado_semana ? `<span class="badge b-brand">Activado (primer viaje) en ${esc(semanaLabel(c.activado_semana))}</span>` : ''}
      </div>
    </div>

    ${ws.length ? `<div class="card"><h3 style="margin-bottom:8px">Comparativa por semana</h3>
      <table class="t"><thead><tr><th></th>${ws.map((w, i) => `<th class="num">${semanaLabel(w)}${i === 0 ? ' (última)' : ''}</th>`).join('')}</tr></thead><tbody>
      ${fila('Viajes', 'viajes')}${fila('Horas conectado (TSH)', 'tsh', 1)}${fila('Ingreso por viajes', 'ingreso', 0, true)}
      ${ws.some((w) => m[w]?.iph) ? fila('Ingreso por hora', 'iph', 0, true) : ''}
      </tbody></table>
      <div class="small muted" style="margin-top:6px">Última semana vs. promedio de las previas: viajes ${pct(d.trend.viajes)}, ingreso ${pct(d.trend.ingreso)}, horas ${pct(d.trend.tsh)}</div></div>` : ''}

    ${c.docs ? `<div class="card"><h3 style="margin-bottom:8px">Documentos</h3><div class="docs">
      ${[['ine', 'INE'], ['licencia', 'Licencia'], ['tarjeta', 'Tarjeta de circ.'], ['foto', 'Foto de perfil'], ['bgc', 'Antecedentes (BGC)']].map(([k, l]) => `<span class="badge ${docCls(c.docs[k] || '')}">${l}: ${esc(c.docs[k] || 'sin dato')}</span>`).join('')}
      </div>${c.comentario_didi ? `<p class="small" style="margin:10px 0 0"><b>Comentario DiDi:</b> ${esc(c.comentario_didi)}</p>` : ''}</div>` : ''}

    <div class="card"><h3 style="margin-bottom:10px">Seguimiento</h3>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <label class="field">Asignado a
          ${esAdmin() ? `<select class="input" id="dasig"><option value="">Sin asignar</option>${usuarios.map((u) => `<option value="${esc(u.usuario)}" ${c.asignado_a === u.usuario ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>`
            : `<div class="row" style="min-height:38px"><b>${esc(usuarioNombre(c.asignado_a))}</b>${puedeAsignarme ? '<button class="btn sm primary" id="dtomar">Asignármelo</button>' : ''}</div>`}
        </label>
        <label class="field">Estatus de contacto
          <select class="input" id="dest">${Object.entries(ESTATUS_CONTACTO).map(([k, v]) => `<option value="${k}" ${(c.estatus_contacto || 'pendiente') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        </label>
      </div>
      ${d.cats.has('recluta') || c.reclutado_por ? `<label class="field" style="margin-top:10px">Reclutado por (para el pago al activarse)
        ${esAdmin() ? `<select class="input" id="drec"><option value="">— Sin registrar —</option>${S.data.usuarios.map((u) => `<option value="${esc(u.usuario)}" ${c.reclutado_por === u.usuario ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>`
          : `<div style="min-height:24px"><b>${esc(c.reclutado_por ? usuarioNombre(c.reclutado_por) : 'Sin registrar')}</b>${c.reclutado_por ? '' : ' <span class="small muted">(regístralo en Reclutamiento → Nuevo recluta)</span>'}</div>`}
      </label>` : ''}
      ${c.reclutado_por ? `<div class="row" style="margin-top:10px">
        <span class="badge ${d.cats.has('rec_conduciendo') ? 'b-ok' : 'b-warn'}">${d.cats.has('rec_conduciendo') ? 'Conduciendo' : 'Esperando estatus'}</span>
        ${Object.keys(c.listas || {}).length ? `<span class="small muted">En Excel de ${Object.entries(c.listas).map(([u, h]) => `${esc(usuarioNombre(u))}: “${esc(h.join('”, “'))}”`).join(' · ')}</span>` : c.hoja_equipo ? `<span class="small muted">Pestaña de su Excel: “${esc(c.hoja_equipo)}”</span>` : ''}
        ${d.cats.has('didi_activo') ? '<span class="badge b-brand">DiDi ya lo reporta activo</span>' : ''}
        <span class="spacer"></span>
        <button class="btn sm" id="dcond" title="Cambia su estatus en Reclutamiento. Si vuelven a importar el Excel de su reclutador, manda lo que diga el Excel.">${(d.cats.has('rec_conduciendo') && !d.cats.has('rec_esperando')) ? 'Regresar a Esperando' : 'Mover a Conduciendo'}</button>
      </div>` : ''}
      <label class="field" style="margin-top:10px">Notas del chofer (visibles para todo el equipo)
        <textarea class="input" id="dnotas" rows="2" placeholder="Ej. prefiere que le llamen en la tarde">${esc(c.notas || '')}</textarea></label>
      <label class="field" style="margin-top:10px">Celular alterno (si DiDi no lo trae o cambió de número)
        <input class="input" id="dcel" inputmode="tel" placeholder="10 dígitos" value="${esc(c.celular_alt || '')}"></label>
      ${c.asignado_a && c.asignado_a !== S.yo.usuario ? `<div class="small muted" style="margin-top:6px">Este chofer lo sigue ${esc(usuarioNombre(c.asignado_a))}; lo que registres aparecerá con tu nombre.</div>` : ''}
    </div>

    <div class="card"><h3 style="margin-bottom:10px">Registrar contacto</h3>
      <form id="fseg" class="grid">
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <label class="field">Tipo<select class="input" name="tipo"><option value="whatsapp">WhatsApp</option><option value="llamada">Llamada</option><option value="visita">Visita a oficina</option><option value="nota">Nota interna</option></select></label>
          <label class="field">Resultado<select class="input" name="resultado">${RESULTADOS.map((r) => `<option>${r}</option>`).join('')}</select></label>
        </div>
        <label class="field">Comentario (motivo, acuerdos…)<textarea class="input" name="nota" rows="2"></textarea></label>
        <div class="row"><label class="field" style="flex:1">Cambiar estatus a
          <select class="input" name="estatus_contacto"><option value="">(automático)</option>${Object.entries(ESTATUS_CONTACTO).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
          <button class="btn primary" style="align-self:flex-end">Guardar</button></div>
      </form>
    </div>

    <div class="card"><h3 style="margin-bottom:8px">Datos de DiDi</h3>
      <dl class="kv">
        <dt>Estatus DiDi</dt><dd>${esc(c.estatus_didi || '—')}</dd>
        <dt>CURP</dt><dd>${esc(c.curp || '—')}</dd>
        <dt>Ciudad</dt><dd>${esc(c.ciudad || '—')}${c.ciudad_primer_viaje && c.ciudad_primer_viaje !== c.ciudad ? ` (1er viaje: ${esc(c.ciudad_primer_viaje)})` : ''}</dd>
        ${c.rol_vehiculo ? `<dt>Vehículo</dt><dd>${esc(c.rol_vehiculo)}</dd>` : ''}
        <dt>Primer viaje</dt><dd>${esc(fmtFecha(c.fecha_primer_viaje))}</dd>
        <dt>Último viaje</dt><dd>${esc(fmtFecha(c.fecha_ultimo_viaje))}</dd>
        ${c.semanas_desde_dft != null ? `<dt>Semanas desde 1er viaje</dt><dd>${esc(c.semanas_desde_dft)}</dd>` : ''}
        ${c.promocion ? `<dt>Promoción activa</dt><dd>${esc(c.promocion.replace(/\{\{[^}]+\}\}/g, ''))}</dd>` : ''}
        <dt>Viene en</dt><dd>${esc((c.fuentes || []).join(', '))}</dd>
        <dt>Alta en sistema</dt><dd>${esc(fmtFecha(c.creado_en))}</dd>
      </dl>
    </div>

    <div class="card"><h3 style="margin-bottom:10px">Historial</h3><div class="timeline" id="dhist"><div class="muted small">Cargando…</div></div></div>
  </div>`;
  dr.scrollTop = scroll;

  dr.querySelector('#dx').onclick = cerrar;
  dr.querySelector('#dedit').onclick = () => editarDatos(c);
  dr.querySelector('#ddel')?.addEventListener('click', () => eliminar(c));
  const cel = dr.querySelector('#dcel');
  cel.onblur = () => { if (cel.value.trim() !== (c.celular_alt || '')) patch(c.id, { celular_alt: cel.value.trim() }, 'Celular guardado'); };
  dr.querySelector('#dwa')?.addEventListener('click', () => abrirPlantillas(c.id));
  dr.querySelector('#dtel')?.addEventListener('click', () => toast('¿Registrar esta llamada?', { accion: 'Registrar', onAccion: () => seguimiento(c.id, { tipo: 'llamada', resultado: 'Llamada realizada' }) }));
  dr.querySelector('#dasig')?.addEventListener('change', async (e) => {
    try { await api('/choferes/asignar', { method: 'POST', body: { ids: [c.id], usuario: e.target.value || null } }); toast('Asignación actualizada'); await recargar(); }
    catch (err) { toast(err.message, { tipo: 'err' }); }
  });
  dr.querySelector('#dtomar')?.addEventListener('click', async () => {
    try { await api('/choferes/asignar', { method: 'POST', body: { ids: [c.id], usuario: S.yo.usuario } }); toast('Ahora este chofer es tuyo'); await recargar(); }
    catch (err) { toast(err.message, { tipo: 'err' }); }
  });
  dr.querySelector('#dcond')?.addEventListener('click', () => patch(c.id, { conduciendo_manual: !(d.cats.has('rec_conduciendo') && !d.cats.has('rec_esperando')) },
    (d.cats.has('rec_conduciendo') && !d.cats.has('rec_esperando')) ? 'Regresado a Esperando estatus' : 'Movido a Conduciendo'));
  dr.querySelector('#drec')?.addEventListener('change', (e) => patch(c.id, { reclutado_por: e.target.value || null }, 'Reclutador actualizado'));
  dr.querySelector('#dest').onchange = (e) => patch(c.id, { estatus_contacto: e.target.value }, 'Estatus actualizado');
  const notas = dr.querySelector('#dnotas');
  notas.onblur = () => { if (notas.value !== (c.notas || '')) patch(c.id, { notas: notas.value }, 'Notas guardadas'); };
  dr.querySelector('#fseg').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (!f.estatus_contacto) delete f.estatus_contacto;
    if (!f.estatus_contacto && f.resultado === 'Respondió') f.estatus_contacto = 'respondio';
    if (!f.estatus_contacto && /Sin respuesta|no contesta/.test(f.resultado)) f.estatus_contacto = 'sin_respuesta';
    if (!f.estatus_contacto && /visita/i.test(f.resultado)) f.estatus_contacto = 'visita_agendada';
    if (!f.estatus_contacto && f.resultado === 'Se queda') f.estatus_contacto = 'se_queda';
    if (!f.estatus_contacto && /^Respondió SÍ/.test(f.resultado)) f.estatus_contacto = 'se_queda';
    if (!f.estatus_contacto && /^Respondió NO/.test(f.resultado)) f.estatus_contacto = 'no_interesado';
    if (!f.estatus_contacto && /quiere ir/.test(f.resultado)) f.estatus_contacto = 'opt_out';
    await seguimiento(c.id, f);
  };
  cargarHistorial(c.id, dr);
}

// ---------------------------------------------------------------- editar / eliminar
const puedeEliminar = (c) => esAdmin() || (c.reclutado_por === S.yo.usuario && !(c.fuentes || []).includes('asignados'));

function editarDatos(c) {
  const m = modal(`<h2>Editar datos</h2>
    <form id="fed" class="grid">
      <label class="field">Nombre completo<input class="input" name="nombre" required value="${esc(c.nombre || '')}"></label>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <label class="field">Celular (10 dígitos)<input class="input" name="celular" inputmode="tel" value="${esc(String(c.celular || '').replace(/^52/, ''))}"></label>
        <label class="field">CURP<input class="input" name="curp" maxlength="18" style="text-transform:uppercase" value="${esc(c.curp || '')}"></label>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <label class="field">Ciudad<input class="input" name="ciudad" value="${esc(c.ciudad || '')}"></label>
        <label class="field">¿Tiene auto?<input class="input" name="tiene_auto" placeholder="Sí / No / va a rentar…" value="${esc(c.tiene_auto || '')}"></label>
      </div>
      <div class="small muted">Si DiDi manda después otro dato en su Excel (por ejemplo el nombre o el celular), el de DiDi lo actualiza.</div>
      <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
    </form>`);
  m.el.querySelector('#fed').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const orig = { nombre: c.nombre || '', celular: String(c.celular || '').replace(/^52/, ''), curp: c.curp || '', ciudad: c.ciudad || '', tiene_auto: c.tiene_auto || '' };
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).trim()]).filter(([k, v]) => v !== orig[k]));
    if (!Object.keys(body).length) { m.close(); return; }
    try { await api(`/choferes/${encodeURIComponent(c.id)}`, { method: 'PATCH', body }); toast('Datos actualizados'); m.close(); await recargar(); }
    catch (err) { toast(err.message, { tipo: 'err' }); }
  };
}

async function eliminar(c) {
  const deDidi = (c.fuentes || []).some((f) => f !== 'reclutamiento');
  const ok = await confirmar(`Se eliminará a ${titulo(c.nombre || c.id)} con todo su historial de contactos. No se puede deshacer.${deDidi ? ' Si DiDi lo vuelve a mandar en un Excel, aparecerá de nuevo.' : ''}`, { ok: 'Eliminar', peligro: true });
  if (!ok) return;
  try { await api(`/choferes/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); toast('Registro eliminado'); cerrar(); await recargar(); }
  catch (err) { toast(err.message, { tipo: 'err' }); }
}

const pct = (t) => (t == null ? '—' : `${t > 0 ? '+' : ''}${(t * 100).toFixed(0)}%`);

async function cargarHistorial(id, dr) {
  try {
    const evs = await api(`/choferes/${encodeURIComponent(id)}/seguimiento`);
    const box = dr.querySelector('#dhist'); if (!box || abiertoId !== id) return;
    box.innerHTML = evs.length ? evs.map((e) => eventoHtml(e, { sinNombre: true })).join('') : '<div class="muted small">Aún no hay contactos registrados.</div>';
  } catch { /* noop */ }
}

async function patch(id, body, msg) {
  try { await api(`/choferes/${encodeURIComponent(id)}`, { method: 'PATCH', body }); toast(msg); await recargar(); }
  catch (e) { toast(e.message, { tipo: 'err' }); }
}
export async function seguimiento(id, body) {
  try {
    await api(`/choferes/${encodeURIComponent(id)}/seguimiento`, { method: 'POST', body });
    toast('Contacto registrado'); await recargar();
  } catch (e) { toast(e.message, { tipo: 'err' }); }
}

// ---------------------------------------------------------------- plantillas
export function abrirPlantillas(id) {
  const d = S.d.get(id); if (!d) return;
  if (!d.ch.cel) { toast('Este chofer no tiene celular; agrégalo en su detalle', { tipo: 'err' }); return; }
  const pls = S.data.plantillas; if (!pls.length) { toast('No hay plantillas configuradas', { tipo: 'err' }); return; }
  const vars = variables(d, S.yo, S.data.ajustes);
  let actual = sugerida(d, pls);
  const m = modal(`
    <div class="row" style="margin-bottom:10px"><div style="flex:1"><h2 style="margin:0">Mensaje para ${esc(titulo(d.ch.nombre || ''))}</h2>
      <div class="small muted">${esc(celBonito(d.ch.cel))} · ${d.seg ? `Segmento ${d.seg}` : esc(d.ch.estatus_didi || '')}</div></div>
      <button class="btn icon ghost" data-close>${icon('x')}</button></div>
    <div class="grid" style="grid-template-columns:minmax(0,220px) minmax(0,1fr)" id="tplgrid">
      <div class="tpl-list">${pls.map((p) => `<div class="tpl-item" data-tpl="${esc(p.id)}">${p.categoria && /^[ABC]$/.test(p.categoria) ? `<span class="seg ${p.categoria}">${p.categoria}</span>` : icon('note')}<span style="flex:1">${esc(p.nombre)}</span>${p.id === actual.id ? '<span class="badge b-brand">sugerida</span>' : ''}</div>`).join('')}</div>
      <div class="grid">
        <textarea class="input" id="tpltxt" rows="12" style="min-height:260px"></textarea>
        <div class="small muted">Puedes ajustar el texto antes de enviarlo. Los cambios aquí no modifican la plantilla.</div>
        <div class="row">
          <button class="btn" id="tcopy">${icon('copy')} Copiar</button>
          <span class="spacer"></span>
          <button class="btn wa" id="tsend">${icon('wa')} Abrir en WhatsApp</button>
        </div>
      </div>
    </div>`, { wide: true });
  const ta = m.el.querySelector('#tpltxt');
  const pintarTpl = () => {
    m.el.querySelectorAll('[data-tpl]').forEach((x) => x.classList.toggle('active', x.dataset.tpl === actual.id));
    ta.value = llenar(actual.texto, vars);
  };
  m.el.querySelectorAll('[data-tpl]').forEach((x) => (x.onclick = () => { actual = pls.find((p) => p.id === x.dataset.tpl); pintarTpl(); }));
  if (matchMedia('(max-width: 820px)').matches) m.el.querySelector('#tplgrid').style.gridTemplateColumns = '1fr';
  pintarTpl();

  m.el.querySelector('#tcopy').onclick = async () => {
    const ok = await copiar(ta.value);
    toast(ok ? 'Mensaje copiado. ¿Ya lo enviaste?' : 'No se pudo copiar', ok
      ? { accion: 'Registrar envío', onAccion: () => seguimiento(id, cuerpoEnvio(actual)) }
      : { tipo: 'err' });
  };
  m.el.querySelector('#tsend').onclick = () => {
    window.open(waLink(d.ch.cel, ta.value), '_blank', 'noopener');
    seguimiento(id, cuerpoEnvio(actual));
    m.close();
  };
}
export { VARIABLES_DISPONIBLES };

function cuerpoEnvio(p) {
  const body = { tipo: 'whatsapp', resultado: p.categoria === 'bienvenida' ? 'Se envió Anexo D y mensaje de bienvenida' : 'Mensaje enviado', plantilla: p.nombre };
  if (p.categoria === 'bienvenida') body.bienvenida = true;
  if (p.categoria === 'salida') { body.resultado = 'Se le mandó la liga de salida (opt-out)'; body.estatus_contacto = 'opt_out'; }
  return body;
}
