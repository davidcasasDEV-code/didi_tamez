// Lista de choferes: filtros, selección múltiple, asignación/reparto y exportación.
import { S, esAdmin, usuarioNombre, recargar, hashParams } from '../app.js';
import { api } from '../api.js';
import { esc, icon, fmtNum, fmtMoney, celBonito, telLink, avatar, hace, toast, modal, confirmar, cargarXLSX, titulo, colorDe, iniciales } from '../util.js';
import { ESTATUS_CONTACTO, semanaLabel } from '../logic.js';
import { abrirPlantillas } from './chofer.js';

const POR_PAGINA = 100;
const SEG_ORD = { A: 0, B: 1, C: 2 };
const CATS = [
  ['prioridad', 'Prioridad A/B/C'], ['documentos', 'Documentos pendientes'], ['registro', 'En registro'],
  ['recuperacion', 'Recuperación'], ['todos', 'Todos'],
];

function filtrosDefault() {
  return { cat: esAdmin() ? 'todos' : 'prioridad', q: '', seg: '', asignado: esAdmin() ? '' : S.yo.usuario, contacto: '', orden: 'prioridad' };
}

export function filtrar(f = S.ui.filtros) {
  const q = f.q.trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  let arr = [...S.d.values()].filter((d) => {
    if (f.cat !== 'todos' && !d.cats.has(f.cat)) return false;
    if (f.seg && d.seg !== f.seg) return false;
    if (f.asignado === '_none' && d.ch.asignado_a) return false;
    if (f.asignado && f.asignado !== '_none' && d.ch.asignado_a !== f.asignado) return false;
    if (f.contacto === 'no_semana' && d.contactadoSemana) return false;
    if (f.contacto === 'si_semana' && !d.contactadoSemana) return false;
    if (f.contacto && ESTATUS_CONTACTO[f.contacto] && (d.ch.estatus_contacto || 'pendiente') !== f.contacto) return false;
    if (q) {
      const hay = `${d.ch.nombre || ''} ${d.ch.curp || ''} ${d.ch.id}`.toLowerCase();
      if (!hay.includes(q) && !(qd.length >= 4 && String(d.ch.cel || '').includes(qd))) return false;
    }
    return true;
  });
  const v = (d) => +d.m0?.viajes || 0;
  const ord = {
    prioridad: (a, b) => (SEG_ORD[a.seg] ?? 9) - (SEG_ORD[b.seg] ?? 9) || (a.contactadoSemana - b.contactadoSemana) || v(b) - v(a),
    nombre: (a, b) => String(a.ch.nombre).localeCompare(String(b.ch.nombre)),
    viajes_desc: (a, b) => v(b) - v(a),
    viajes_asc: (a, b) => v(a) - v(b),
    caida: (a, b) => (a.trend.viajes ?? 9) - (b.trend.viajes ?? 9),
    contacto: (a, b) => String(a.ch.ultimo_contacto?.fecha || '').localeCompare(String(b.ch.ultimo_contacto?.fecha || '')),
  }[f.orden || 'prioridad'];
  return arr.sort(ord);
}

const trendHtml = (t) => {
  if (t == null) return '';
  const c = t > 0.05 ? 'up' : t < -0.05 ? 'down' : 'flat';
  return `<span class="trend ${c}" title="vs. promedio de las semanas previas">${t > 0 ? '▲' : t < 0 ? '▼' : '•'}${Math.abs(t * 100).toFixed(0)}%</span>`;
};
export const segHtml = (d) => (d.seg ? `<span class="seg ${d.seg}" title="Segmento calculado">${d.seg}</span>` : '<span class="seg none">—</span>');
export const estatusHtml = (e = 'pendiente') => `<span class="badge ${ESTATUS_CONTACTO[e]?.cls || ''}">${esc(ESTATUS_CONTACTO[e]?.label || e)}</span>`;
function asignadoHtml(u) {
  if (!u) return '<span class="badge b-warn">Sin asignar</span>';
  const n = usuarioNombre(u);
  return `<span class="row" style="gap:6px;flex-wrap:nowrap"><span class="avatar" style="width:24px;height:24px;font-size:10px;background:${colorDe(u)}">${esc(iniciales(n))}</span><span class="nowrap">${esc(n.split(' ')[0])}</span></span>`;
}

export function renderChoferes(el) {
  S.ui.filtros ||= filtrosDefault();
  const f = S.ui.filtros;
  const todos = [...S.d.values()];
  const lista = filtrar();
  // descarta de la selección los que ya no existen
  for (const id of S.ui.sel) if (!S.d.has(id)) S.ui.sel.delete(id);
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  S.ui.pagina = Math.min(S.ui.pagina || 0, paginas - 1);
  const pag = lista.slice(S.ui.pagina * POR_PAGINA, (S.ui.pagina + 1) * POR_PAGINA);
  const base = { ...f, cat: 'todos' };
  const cuentaCat = (c) => filtrar({ ...base, cat: c }).length;
  const usuarios = S.data.usuarios.filter((u) => u.activo);
  const sel = S.ui.sel;
  const todosSel = lista.length > 0 && lista.every((d) => sel.has(d.ch.id));

  el.innerHTML = `
  <div class="topbar">
    <div><h1>Choferes</h1><div class="muted">${fmtNum(lista.length)} de ${fmtNum(todos.length)} · semanas ${S.data.semanas.map(semanaLabel).join(', ') || '—'}</div></div>
    <div class="spacer"></div>
    <button class="btn" id="bexp">${icon('down')} Exportar Excel</button>
  </div>
  <div class="tabs">${CATS.map(([k, l]) => `<button class="tab ${f.cat === k ? 'active' : ''}" data-cat="${k}">${l} <span class="badge">${cuentaCat(k)}</span></button>`).join('')}</div>
  <div class="filters">
    <input class="input search" id="fq" placeholder="Buscar por nombre, celular, CURP o ID…" value="${esc(f.q)}">
    <select class="input" id="fseg"><option value="">Segmento: todos</option>${['A', 'B', 'C'].map((s) => `<option value="${s}" ${f.seg === s ? 'selected' : ''}>Segmento ${s}</option>`).join('')}</select>
    <select class="input" id="fasig">
      <option value="">Asignado: todos</option>
      <option value="${esc(S.yo.usuario)}" ${f.asignado === S.yo.usuario ? 'selected' : ''}>Mis choferes</option>
      <option value="_none" ${f.asignado === '_none' ? 'selected' : ''}>Sin asignar</option>
      ${usuarios.filter((u) => u.usuario !== S.yo.usuario).map((u) => `<option value="${esc(u.usuario)}" ${f.asignado === u.usuario ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
    </select>
    <select class="input" id="fcont">
      <option value="">Contacto: todos</option>
      <option value="no_semana" ${f.contacto === 'no_semana' ? 'selected' : ''}>Sin contactar esta semana</option>
      <option value="si_semana" ${f.contacto === 'si_semana' ? 'selected' : ''}>Contactados esta semana</option>
      ${Object.entries(ESTATUS_CONTACTO).map(([k, v]) => `<option value="${k}" ${f.contacto === k ? 'selected' : ''}>Estatus: ${v.label}</option>`).join('')}
    </select>
    <select class="input" id="ford">
      ${[['prioridad', 'Orden: prioridad'], ['viajes_desc', 'Más viajes'], ['viajes_asc', 'Menos viajes'], ['caida', 'Mayor caída'], ['contacto', 'Contacto más antiguo'], ['nombre', 'Nombre A-Z']]
        .map(([k, l]) => `<option value="${k}" ${f.orden === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
  </div>

  ${sel.size ? `<div class="bulkbar">
    <b>${sel.size} seleccionado(s)</b>
    ${lista.length > sel.size && !todosSel ? `<button class="btn sm" id="bselall">Seleccionar los ${lista.length} filtrados</button>` : ''}
    <span class="spacer"></span>
    ${esAdmin() ? `
      <select class="input" id="basig" style="width:auto;padding:6px 10px"><option value="">Asignar a…</option>${usuarios.map((u) => `<option value="${esc(u.usuario)}">${esc(u.nombre)}</option>`).join('')}</select>
      <button class="btn sm primary" id="brep">${icon('split')} Repartir entre…</button>
      <button class="btn sm" id="blib">Quitar asignación</button>`
    : `<button class="btn sm primary" id="btomar">Asignármelos</button><button class="btn sm" id="bsoltar">Liberar los míos</button>`}
    <button class="btn sm" id="bclr">${icon('x')}</button>
  </div>` : `<div class="row small muted" style="margin-bottom:10px">
    ${esAdmin() ? `<span>Tip: selecciona varios (o "primeros N") para asignarlos o repartirlos entre el equipo.</span>
    <span class="spacer"></span><label class="row">Seleccionar primeros <input class="input" id="nsel" type="number" min="1" max="${lista.length}" style="width:84px;padding:5px 8px" placeholder="100"></label><button class="btn sm" id="bnsel">Seleccionar</button>` : '<span>Toca un chofer para ver su detalle, plantillas e historial.</span>'}
  </div>`}

  ${lista.length ? `
  <div class="table-wrap table-desktop"><table class="t">
    <thead><tr>
      <th style="width:34px"><input type="checkbox" id="chkall" ${todosSel ? 'checked' : ''} title="Seleccionar página"></th>
      <th>Chofer</th><th>Seg.</th><th class="num">Viajes</th><th class="num">Horas</th><th class="num">Ingreso</th>
      <th>Estatus DiDi</th><th>Asignado</th><th>Contacto</th><th style="width:96px"></th>
    </tr></thead>
    <tbody>${pag.map(filaHtml).join('')}</tbody>
  </table></div>
  <div class="cards-mobile">${pag.map(cardHtml).join('')}</div>
  ${paginas > 1 ? `<div class="pager"><span class="muted small">Página ${S.ui.pagina + 1} de ${paginas}</span>
    <button class="btn sm" id="pprev" ${S.ui.pagina === 0 ? 'disabled' : ''}>Anterior</button>
    <button class="btn sm" id="pnext" ${S.ui.pagina >= paginas - 1 ? 'disabled' : ''}>Siguiente</button></div>` : ''}`
  : `<div class="card empty"><h2>Sin resultados</h2><p>No hay choferes con estos filtros.</p><button class="btn" id="bclrf">Limpiar filtros</button></div>`}`;

  // ---------- eventos
  const set = (patch) => { Object.assign(f, patch); S.ui.pagina = 0; renderChoferes(el); };
  el.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => set({ cat: b.dataset.cat })));
  let tq; el.querySelector('#fq').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { set({ q: e.target.value }); const i = el.querySelector('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  el.querySelector('#fseg').onchange = (e) => set({ seg: e.target.value, cat: e.target.value && f.cat !== 'todos' ? 'prioridad' : f.cat });
  el.querySelector('#fasig').onchange = (e) => set({ asignado: e.target.value });
  el.querySelector('#fcont').onchange = (e) => set({ contacto: e.target.value });
  el.querySelector('#ford').onchange = (e) => set({ orden: e.target.value });
  el.querySelector('#bclrf')?.addEventListener('click', () => { S.ui.filtros = { ...filtrosDefault(), asignado: '', cat: 'todos' }; renderChoferes(el); });
  el.querySelector('#pprev')?.addEventListener('click', () => { S.ui.pagina--; renderChoferes(el); window.scrollTo(0, 0); });
  el.querySelector('#pnext')?.addEventListener('click', () => { S.ui.pagina++; renderChoferes(el); window.scrollTo(0, 0); });
  el.querySelector('#bexp').onclick = () => exportar(lista);

  const rer = () => renderChoferes(el);
  el.querySelector('#chkall')?.addEventListener('change', (e) => { pag.forEach((d) => (e.target.checked ? sel.add(d.ch.id) : sel.delete(d.ch.id))); rer(); });
  el.querySelector('#bselall')?.addEventListener('click', () => { lista.forEach((d) => sel.add(d.ch.id)); rer(); });
  el.querySelector('#bclr')?.addEventListener('click', () => { sel.clear(); rer(); });
  el.querySelector('#bnsel')?.addEventListener('click', () => {
    const n = Math.max(1, Math.min(lista.length, +el.querySelector('#nsel').value || 100));
    sel.clear(); lista.slice(0, n).forEach((d) => sel.add(d.ch.id)); rer();
  });
  el.querySelectorAll('[data-chk]').forEach((c) => {
    c.onclick = (e) => e.stopPropagation();
    c.onchange = () => { c.checked ? sel.add(c.dataset.chk) : sel.delete(c.dataset.chk); rer(); };
  });
  el.querySelectorAll('[data-open]').forEach((r) => (r.onclick = () => abrir(r.dataset.open)));
  el.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); abrirPlantillas(b.dataset.wa); }));
  el.querySelectorAll('[data-tel]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const id = b.dataset.tel;
    toast('¿Registrar esta llamada?', { accion: 'Registrar', onAccion: () => registrarLlamada(id) });
  }));

  el.querySelector('#basig')?.addEventListener('change', async (e) => {
    const u = e.target.value; if (!u) return;
    if (!(await confirmar(`Asignar ${sel.size} chofer(es) a ${usuarioNombre(u)}?`, { ok: 'Asignar' }))) { e.target.value = ''; return; }
    await asignar([...sel], u);
  });
  el.querySelector('#blib')?.addEventListener('click', async () => {
    if (await confirmar(`Quitar la asignación de ${sel.size} chofer(es)?`, { ok: 'Quitar', peligro: true })) await asignar([...sel], null);
  });
  el.querySelector('#brep')?.addEventListener('click', () => repartir([...sel]));
  el.querySelector('#btomar')?.addEventListener('click', () => asignar([...sel], S.yo.usuario));
  el.querySelector('#bsoltar')?.addEventListener('click', () => asignar([...sel], null));
}

function abrir(id) {
  const p = hashParams(); p.set('chofer', id);
  location.hash = `#/choferes?${p}`;
}

function filaHtml(d) {
  const c = d.ch; const sel = S.ui.sel.has(c.id);
  return `<tr data-open="${esc(c.id)}" class="${sel ? 'sel' : ''}">
    <td><input type="checkbox" data-chk="${esc(c.id)}" ${sel ? 'checked' : ''}></td>
    <td class="name-cell"><b>${esc(titulo(c.nombre || '(sin nombre)'))}</b><span>${esc(celBonito(c.cel))}${d.docs.length ? ` · <span style="color:var(--warn)">${d.docs.length} doc. pendiente(s)</span>` : ''}</span></td>
    <td>${segHtml(d)}</td>
    <td class="num nowrap"><b>${d.m0 ? fmtNum(d.m0.viajes) : '—'}</b> ${trendHtml(d.trend.viajes)}</td>
    <td class="num nowrap">${d.m0 ? fmtNum(d.m0.tsh, 1) : '—'} ${d.caidaTsh != null && d.caidaTsh < -0.149 ? trendHtml(d.caidaTsh) : ''}</td>
    <td class="num nowrap">${d.m0 ? fmtMoney(d.m0.ingreso) : '—'}</td>
    <td class="small" style="max-width:180px">${esc(c.estatus_didi || '—')}</td>
    <td>${asignadoHtml(c.asignado_a)}</td>
    <td>${estatusHtml(c.estatus_contacto)}<div class="small muted nowrap">${c.ultimo_contacto ? hace(c.ultimo_contacto.fecha) : 'nunca'}${d.contactadoSemana ? ' ✓' : ''}</div></td>
    <td class="nowrap">${c.cel ? `<button class="btn icon sm wa" data-wa="${esc(c.id)}" title="Mensaje por WhatsApp">${icon('wa')}</button>
      <a class="btn icon sm" href="${telLink(c.cel)}" data-tel="${esc(c.id)}" title="Llamar">${icon('phone')}</a>` : '<span class="small muted">sin celular</span>'}</td>
  </tr>`;
}
function cardHtml(d) {
  const c = d.ch; const sel = S.ui.sel.has(c.id);
  return `<div class="mcard ${sel ? 'sel' : ''}" data-open="${esc(c.id)}">
    <div class="top">
      <input type="checkbox" data-chk="${esc(c.id)}" ${sel ? 'checked' : ''} style="margin-top:4px;width:18px;height:18px;accent-color:var(--brand)">
      <div style="flex:1;min-width:0"><b>${esc(titulo(c.nombre || '(sin nombre)'))}</b><div class="small muted">${esc(celBonito(c.cel))} · ${esc(c.estatus_didi || '')}</div></div>
      ${segHtml(d)}
    </div>
    <div class="stats"><span>Viajes <b>${d.m0 ? fmtNum(d.m0.viajes) : '—'}</b> ${trendHtml(d.trend.viajes)}</span><span>Horas <b>${d.m0 ? fmtNum(d.m0.tsh, 1) : '—'}</b></span><span>Ingreso <b>${d.m0 ? fmtMoney(d.m0.ingreso) : '—'}</b></span>${d.docs.length ? `<span style="color:var(--warn)">${d.docs.length} doc.</span>` : ''}</div>
    <div class="row">${asignadoHtml(c.asignado_a)} ${estatusHtml(c.estatus_contacto)}<span class="spacer"></span>
      ${c.cel ? `<button class="btn sm wa" data-wa="${esc(c.id)}">${icon('wa')} WhatsApp</button>
      <a class="btn icon sm" href="${telLink(c.cel)}" data-tel="${esc(c.id)}">${icon('phone')}</a>` : '<span class="small muted">sin celular</span>'}</div>
  </div>`;
}

async function registrarLlamada(id) {
  try { await api(`/choferes/${encodeURIComponent(id)}/seguimiento`, { method: 'POST', body: { tipo: 'llamada', resultado: 'Llamada realizada' } }); toast('Llamada registrada'); await recargar(); }
  catch (e) { toast(e.message, { tipo: 'err' }); }
}

export async function asignar(ids, usuario) {
  try {
    const r = await api('/choferes/asignar', { method: 'POST', body: { ids, usuario } });
    toast(usuario ? `${r.asignados} chofer(es) asignados a ${usuarioNombre(usuario)}${r.omitidos ? ` · ${r.omitidos} omitidos` : ''}` : `${r.asignados} chofer(es) liberados`);
    S.ui.sel.clear(); await recargar();
  } catch (e) { toast(e.message, { tipo: 'err' }); }
}

function repartir(ids) {
  const usuarios = S.data.usuarios.filter((u) => u.activo);
  const m = modal(`<h2>Repartir ${ids.length} choferes</h2>
    <p class="muted small">Se reparten en partes iguales entre las personas marcadas, respetando el orden actual de la lista (prioridad primero, de forma alternada para que todos reciban A, B y C).</p>
    <div class="grid" id="rus">${usuarios.map((u) => `<label class="row"><input type="checkbox" value="${esc(u.usuario)}" style="width:18px;height:18px;accent-color:var(--brand)"> ${avatar(u.nombre, u.usuario)} <b>${esc(u.nombre)}</b> <span class="muted small">${[...S.d.values()].filter((d) => d.ch.asignado_a === u.usuario).length} asignados hoy</span></label>`).join('')}</div>
    <div class="muted small" id="rprev" style="margin-top:10px"></div>
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="rok" disabled>Repartir</button></div>`);
  const chks = [...m.el.querySelectorAll('#rus input')];
  const elegidos = () => chks.filter((c) => c.checked).map((c) => c.value);
  const prev = () => {
    const e = elegidos(); m.el.querySelector('#rok').disabled = !e.length;
    m.el.querySelector('#rprev').textContent = e.length ? `≈ ${Math.floor(ids.length / e.length)}${ids.length % e.length ? '–' + Math.ceil(ids.length / e.length) : ''} choferes por persona` : '';
  };
  chks.forEach((c) => (c.onchange = prev));
  m.el.querySelector('#rok').onclick = async () => {
    const e = elegidos(); const grupos = Object.fromEntries(e.map((u) => [u, []]));
    const ordenados = filtrar().map((d) => d.ch.id).filter((id) => ids.includes(id));
    ids.filter((id) => !ordenados.includes(id)).forEach((id) => ordenados.push(id));
    ordenados.forEach((id, i) => grupos[e[i % e.length]].push(id));
    m.el.querySelector('#rok').disabled = true; m.el.querySelector('#rok').textContent = 'Repartiendo…';
    try {
      for (const u of e) await api('/choferes/asignar', { method: 'POST', body: { ids: grupos[u], usuario: u } });
      toast(`Repartidos ${ids.length} choferes entre ${e.length} persona(s)`);
      S.ui.sel.clear(); m.close(); await recargar();
    } catch (err) { toast(err.message, { tipo: 'err' }); m.el.querySelector('#rok').disabled = false; }
  };
}

async function exportar(lista) {
  try {
    const XLSX = await cargarXLSX();
    const [w0, w1, w2] = S.data.semanas;
    const filas = lista.map((d) => {
      const c = d.ch; const m = S.data.metricas[c.id] || {};
      return {
        id_conductor: c.id, nombre: c.nombre, celular: c.celular, curp: c.curp, ciudad: c.ciudad,
        segmento_calculado: d.seg || '', segmento_didi: c.segmento_didi || '',
        [`viajes ${semanaLabel(w0)}`]: m[w0]?.viajes ?? '', [`viajes ${semanaLabel(w1)}`]: m[w1]?.viajes ?? '', [`viajes ${semanaLabel(w2)}`]: m[w2]?.viajes ?? '',
        [`horas ${semanaLabel(w0)}`]: m[w0]?.tsh ?? '', [`ingreso ${semanaLabel(w0)}`]: m[w0]?.ingreso ?? '',
        estatus_didi: c.estatus_didi || '', documentos_pendientes: d.docs.map((x) => `${x.label}: ${x.estado}`).join('; '),
        asignado_a: c.asignado_a ? usuarioNombre(c.asignado_a) : '', estatus_contacto: ESTATUS_CONTACTO[c.estatus_contacto || 'pendiente']?.label,
        contactos: c.contactos || 0, ultimo_contacto: c.ultimo_contacto?.fecha?.slice(0, 16).replace('T', ' ') || '',
        ultimo_resultado: c.ultimo_contacto?.resultado || '', notas: c.notas || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(filas); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Choferes');
    XLSX.writeFile(wb, `Choferes_Tamez_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { toast(e.message, { tipo: 'err' }); }
}
