// Reclutamiento: la base de reclutas del equipo en dos partes (esperando estatus / ya conduciendo),
// más los que aparecen en el reporte de DiDi sin que nadie los haya registrado.
import { S, esAdmin, usuarioNombre, recargar, hashParams } from '../app.js';
import { api } from '../api.js';
import { esc, icon, fmtNum, celBonito, telLink, hace, toast, modal, cargarXLSX, titulo, colorDe, iniciales, confirmar } from '../util.js';
import { semanaLabel, DOC_LABEL } from '../logic.js';
import { abrirPlantillas } from './chofer.js';
import { estatusHtml } from './choferes.js';

const POR_PAGINA = 100;
const rechazado = (d) => Object.values(d.ch.docs || {}).some((v) => /rechaz|reject/i.test(v || ''));
const listo = (d) => /listo para conducir/i.test(d.ch.estatus_didi || '');
const enProceso = (d) => !listo(d) && !rechazado(d) && !d.docs.length;
const ultimaSemana = () => S.data.semanas[0];
const sinViajes = (d) => d.s0 === ultimaSemana() ? !(+d.m0?.viajes > 0) : true;

const PARTES = {
  esperando: {
    label: 'Esperando estatus', desc: 'Reclutados que todavía no hacen su primer viaje',
    base: (d) => d.ch.reclutado_por && d.cats.has('rec_esperando'),
    tabs: [
      ['todos', 'Todos', () => true],
      ['documentos', 'Documentos pendientes', (d) => d.docs.length > 0 && !d.bloqueado],
      ['rechazados', 'Rechazados', rechazado],
      ['listos', 'Listos, sin viajes', listo],
      ['proceso', 'En proceso / sin datos de DiDi', enProceso],
    ],
  },
  conduciendo: {
    label: 'Conduciendo', desc: 'Reclutados que ya están manejando',
    base: (d) => d.ch.reclutado_por && d.cats.has('rec_conduciendo'),
    tabs: [
      ['todos', 'Todos', () => true],
      ['activados', 'Activados (para pago)', (d) => !!d.ch.activado_semana],
      ['recuperados', 'Recuperados (+1 año)', (d) => d.cats.has('recuperado')],
      ['sinviajes', 'Sin viajes la última semana', sinViajes],
    ],
  },
  didi: {
    label: 'En DiDi sin reclutador', desc: 'Aparecen en el reporte de DiDi pero nadie del equipo los ha registrado',
    base: (d) => !d.ch.reclutado_por,
    tabs: [['todos', 'Todos', () => true], ['conduciendo', 'Ya conducen', (d) => d.cats.has('rec_conduciendo')], ['esperando', 'Esperando estatus', (d) => d.cats.has('rec_esperando')]],
  },
};

function lista(f) {
  const parte = PARTES[f.parte] || PARTES.esperando;
  const tab = parte.tabs.find((t) => t[0] === f.tab)?.[2] || (() => true);
  const q = f.q.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
  return [...S.d.values()].filter((d) => {
    if (!d.cats.has('recluta') || !parte.base(d) || !tab(d)) return false;
    if (f.parte !== 'didi' && f.rec && d.ch.reclutado_por !== f.rec) return false;
    if (q) {
      const hay = `${d.ch.nombre || ''} ${d.ch.curp || ''} ${d.ch.id}`.toLowerCase();
      if (!hay.includes(q) && !(qd.length >= 4 && String(d.ch.cel || '').includes(qd))) return false;
    }
    return true;
  }).sort((a, b) => String(a.ch.nombre || '').localeCompare(String(b.ch.nombre || '')));
}

const docChip = (lbl, v) => {
  const cls = /aprob|approved/i.test(v) ? 'b-ok' : /rechaz|reject|expir/i.test(v) ? 'b-bad' : /sin subir|pending|review/i.test(v) ? 'b-warn' : '';
  return `<span class="badge ${cls}" title="${esc(lbl)}: ${esc(v || 'sin dato')}">${esc(lbl)}</span>`;
};
const docsHtml = (c) => (c.docs ? `<div class="docs">${docChip('INE', c.docs.ine)}${docChip('Lic', c.docs.licencia)}${docChip('Tarj', c.docs.tarjeta)}${docChip('Foto', c.docs.foto)}${docChip('BGC', c.docs.bgc)}</div>` : '<span class="small muted">Aún sin datos de DiDi</span>');
const recHtml = (u) => (u ? `<span class="row" style="gap:6px;flex-wrap:nowrap"><span class="avatar" style="width:24px;height:24px;font-size:10px;background:${colorDe(u)}">${esc(iniciales(usuarioNombre(u)))}</span><span class="nowrap">${esc(usuarioNombre(u).split(' ')[0])}</span></span>` : '<span class="badge b-warn">Sin registrar</span>');
const viajesHtml = (d) => (d.m0 ? `<b>${fmtNum(d.m0.viajes)}</b> <span class="small muted">${esc(semanaLabel(d.s0))}</span>` : '<span class="muted small">—</span>');

export function renderReclutamiento(el) {
  S.ui.rec ||= { parte: 'esperando', tab: 'todos', q: '', rec: '', pagina: 0 };
  const f = S.ui.rec; f.parte ||= 'esperando';
  const parte = PARTES[f.parte];
  const todos = [...S.d.values()].filter((d) => d.cats.has('recluta'));
  const cuenta = (p) => todos.filter(PARTES[p].base).filter((d) => p === 'didi' || !f.rec || d.ch.reclutado_por === f.rec).length;
  const arr = lista(f);
  const paginas = Math.max(1, Math.ceil(arr.length / POR_PAGINA));
  f.pagina = Math.min(f.pagina || 0, paginas - 1);
  const pag = arr.slice(f.pagina * POR_PAGINA, (f.pagina + 1) * POR_PAGINA);
  const usuarios = S.data.usuarios;
  const sel = (S.ui.recSel ||= new Set());
  const seleccionable = esAdmin() && f.parte === 'didi';

  // Activaciones por reclutador y semana (base para el pago)
  const reclutados = todos.filter((d) => d.ch.reclutado_por);
  const semanasAct = [...new Set(reclutados.map((d) => d.ch.activado_semana).filter(Boolean))].sort().reverse().slice(0, 4);
  const filasAct = usuarios.map((u) => {
    const mios = reclutados.filter((d) => d.ch.reclutado_por === u.usuario);
    return { u: u.usuario, total: mios.length, esp: mios.filter((d) => d.cats.has('rec_esperando')).length, cond: mios.filter((d) => d.cats.has('rec_conduciendo')).length,
      act: mios.filter((d) => d.ch.activado_semana).length, porSem: semanasAct.map((w) => mios.filter((d) => d.ch.activado_semana === w).length) };
  }).filter((r) => r.total);

  const tabsHtml = parte.tabs.map(([k, l, fn]) => `<button class="tab ${f.tab === k ? 'active' : ''}" data-tab="${k}">${l} <span class="badge">${todos.filter(parte.base).filter(fn).filter((d) => f.parte === 'didi' || !f.rec || d.ch.reclutado_por === f.rec).length}</span></button>`).join('');

  el.innerHTML = `
  <div class="topbar">
    <div><h1>Reclutamiento</h1><div class="muted">Tu base de reclutas: quién los metió, cómo van con DiDi y quién ya conduce</div></div>
    <div class="spacer"></div>
    <button class="btn" id="rexp">${icon('down')} Exportar</button>
    <button class="btn primary" id="rnuevo">+ Nuevo recluta</button>
  </div>

  <div class="kpis">
    ${Object.entries(PARTES).map(([k, p]) => `<div class="kpi link" data-parte="${k}" style="${f.parte === k ? 'border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-soft)' : ''}">
      <div class="lbl">${esc(p.label)}</div><div class="val">${fmtNum(cuenta(k))}</div><div class="sub">${esc(p.desc)}</div></div>`).join('')}
  </div>

  ${reclutados.length ? `<div class="card" style="margin-bottom:14px">
    <div class="card-h"><h2 style="flex:1">Por reclutador</h2><span class="small muted">Activado = primer viaje reportado por DiDi (base para el pago)</span></div>
    <div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>Reclutador</th><th class="num">Esperando</th><th class="num">Conduciendo</th>${semanasAct.map((w) => `<th class="num">Activados ${semanaLabel(w)}</th>`).join('')}<th class="num">Total activados</th></tr></thead><tbody>
      ${filasAct.map((r) => `<tr data-rec="${esc(r.u)}"><td>${recHtml(r.u)}</td><td class="num">${r.esp}</td><td class="num">${r.cond}</td>${r.porSem.map((n) => `<td class="num"><b>${n || '—'}</b></td>`).join('')}<td class="num"><b>${r.act}</b></td></tr>`).join('')}
    </tbody></table></div></div>` : `<div class="card" style="margin-bottom:14px"><b>Aún no hay reclutas registrados.</b> <span class="muted">Importa tu Excel de reclutas en Importar, o da de alta uno por uno con “+ Nuevo recluta”.</span></div>`}

  <div class="tabs">${tabsHtml}</div>
  <div class="filters" style="grid-template-columns:2fr 1fr">
    <input class="input search" id="rq" placeholder="Buscar por nombre, celular, CURP o ID…" value="${esc(f.q)}">
    ${f.parte !== 'didi' ? `<select class="input" id="rrec">
      <option value="">Reclutado por: todos</option>
      <option value="${esc(S.yo.usuario)}" ${f.rec === S.yo.usuario ? 'selected' : ''}>Mis reclutas</option>
      ${usuarios.filter((u) => u.usuario !== S.yo.usuario).map((u) => `<option value="${esc(u.usuario)}" ${f.rec === u.usuario ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
    </select>` : '<div></div>'}
  </div>

  ${seleccionable && sel.size ? `<div class="bulkbar"><b>${sel.size} seleccionado(s)</b><span class="spacer"></span>
    <select class="input" id="rasig" style="width:auto;padding:6px 10px"><option value="">Marcar como reclutados por…</option>${usuarios.filter((u) => u.activo).map((u) => `<option value="${esc(u.usuario)}">${esc(u.nombre)}</option>`).join('')}</select>
    <button class="btn sm" id="rclr">${icon('x')}</button></div>`
  : f.parte === 'didi' ? `<div class="small muted" style="margin-bottom:10px">Si alguno es tuyo o de tu equipo, ábrelo y marca quién lo reclutó${esAdmin() ? ' (o selecciona varios)' : ' (o regístralo con “+ Nuevo recluta”)'}. Así pasa a Esperando estatus o Conduciendo.</div>` : ''}

  ${arr.length ? `<div class="table-wrap table-desktop"><table class="t"><thead><tr>
      ${seleccionable ? `<th style="width:34px"><input type="checkbox" id="rall" ${pag.length && pag.every((d) => sel.has(d.ch.id)) ? 'checked' : ''}></th>` : ''}
      <th>Recluta</th><th>Reclutado por</th><th>Estatus DiDi</th>
      ${f.parte === 'conduciendo' ? '<th class="num">Viajes</th><th>Activado</th>' : '<th>Documentos</th>'}
      <th>Contacto</th><th style="width:96px"></th></tr></thead>
    <tbody>${pag.map((d) => {
      const c = d.ch;
      return `<tr data-open="${esc(c.id)}" class="${sel.has(c.id) ? 'sel' : ''}">
        ${seleccionable ? `<td><input type="checkbox" data-chk="${esc(c.id)}" ${sel.has(c.id) ? 'checked' : ''}></td>` : ''}
        <td class="name-cell"><b>${esc(titulo(c.nombre || '(sin nombre)'))}${d.cats.has('recuperado') ? ' <span class="badge b-brand">recuperado</span>' : ''}</b><span>${esc(c.cel ? celBonito(c.cel) : c.curp ? 'CURP ' + c.curp + ' · sin celular' : 'sin celular')}${c.notas ? ` · <span title="${esc(c.notas)}">📝</span>` : ''}</span></td>
        <td>${recHtml(c.reclutado_por)}</td>
        <td class="small" style="max-width:200px">${esc(c.estatus_didi || '—')}</td>
        ${f.parte === 'conduciendo' ? `<td class="num nowrap">${viajesHtml(d)}</td><td class="nowrap">${c.activado_semana ? `<span class="badge b-ok">${esc(semanaLabel(c.activado_semana))}</span>` : '<span class="muted small">—</span>'}</td>` : `<td>${docsHtml(c)}</td>`}
        <td>${estatusHtml(c.estatus_contacto)}<div class="small muted nowrap">${c.ultimo_contacto ? hace(c.ultimo_contacto.fecha) : 'nunca'}</div></td>
        <td class="nowrap">${c.cel ? `<button class="btn icon sm wa" data-wa="${esc(c.id)}" title="Mensaje por WhatsApp">${icon('wa')}</button>
          <a class="btn icon sm" href="${telLink(c.cel)}" title="Llamar" data-stop>${icon('phone')}</a>` : ''}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div class="cards-mobile">${pag.map((d) => {
      const c = d.ch;
      return `<div class="mcard" data-open="${esc(c.id)}"><div class="top"><div style="flex:1;min-width:0"><b>${esc(titulo(c.nombre || ''))}</b>
        <div class="small muted">${esc(c.estatus_didi || '')}</div></div>${c.activado_semana ? `<span class="badge b-ok">Activado ${esc(semanaLabel(c.activado_semana))}</span>` : ''}</div>
        ${f.parte === 'conduciendo' ? `<div class="small">Viajes: ${viajesHtml(d)}</div>` : docsHtml(c)}
        <div class="row">${recHtml(c.reclutado_por)}<span class="spacer"></span>${c.cel ? `<button class="btn sm wa" data-wa="${esc(c.id)}">${icon('wa')} WhatsApp</button>` : '<span class="small muted">sin celular</span>'}</div></div>`;
    }).join('')}</div>
    ${paginas > 1 ? `<div class="pager"><span class="muted small">Página ${f.pagina + 1} de ${paginas}</span>
      <button class="btn sm" id="rprev" ${f.pagina === 0 ? 'disabled' : ''}>Anterior</button><button class="btn sm" id="rnext" ${f.pagina >= paginas - 1 ? 'disabled' : ''}>Siguiente</button></div>` : ''}`
  : '<div class="card empty"><h2>Sin resultados</h2><p>No hay reclutas con estos filtros.</p></div>'}`;

  const set = (p) => { Object.assign(f, p, { pagina: 0 }); renderReclutamiento(el); };
  el.querySelectorAll('[data-parte]').forEach((b) => (b.onclick = () => { sel.clear(); set({ parte: b.dataset.parte, tab: 'todos' }); }));
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => set({ tab: b.dataset.tab })));
  el.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => set({ rec: b.dataset.rec })));
  let t; el.querySelector('#rq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { set({ q: e.target.value }); const i = el.querySelector('#rq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  el.querySelector('#rrec')?.addEventListener('change', (e) => set({ rec: e.target.value }));
  el.querySelector('#rprev')?.addEventListener('click', () => { f.pagina--; renderReclutamiento(el); window.scrollTo(0, 0); });
  el.querySelector('#rnext')?.addEventListener('click', () => { f.pagina++; renderReclutamiento(el); window.scrollTo(0, 0); });
  el.querySelectorAll('[data-open]').forEach((r) => (r.onclick = () => { const p = hashParams(); p.set('chofer', r.dataset.open); location.hash = `#/reclutamiento?${p}`; }));
  el.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); abrirPlantillas(b.dataset.wa); }));
  el.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = (e) => e.stopPropagation()));
  el.querySelectorAll('[data-chk]').forEach((c) => { c.onclick = (e) => e.stopPropagation(); c.onchange = () => { c.checked ? sel.add(c.dataset.chk) : sel.delete(c.dataset.chk); renderReclutamiento(el); }; });
  el.querySelector('#rall')?.addEventListener('change', (e) => { pag.forEach((d) => (e.target.checked ? sel.add(d.ch.id) : sel.delete(d.ch.id))); renderReclutamiento(el); });
  el.querySelector('#rclr')?.addEventListener('click', () => { sel.clear(); renderReclutamiento(el); });
  el.querySelector('#rasig')?.addEventListener('change', async (e) => {
    const u = e.target.value; if (!u) return;
    if (!(await confirmar(`Marcar ${sel.size} persona(s) como reclutadas por ${usuarioNombre(u)}?`, { ok: 'Marcar' }))) { e.target.value = ''; return; }
    const ids = [...sel]; let ok = 0;
    for (let i = 0; i < ids.length; i += 8) {
      const r = await Promise.allSettled(ids.slice(i, i + 8).map((id) => api(`/choferes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { reclutado_por: u } })));
      ok += r.filter((x) => x.status === 'fulfilled').length;
    }
    toast(`${ok} persona(s) marcadas como reclutadas por ${usuarioNombre(u)}`); sel.clear(); await recargar();
  });
  el.querySelector('#rnuevo').onclick = nuevoRecluta;
  el.querySelector('#rexp').onclick = () => exportar(arr, parte.label);
}

function nuevoRecluta() {
  const m = modal(`<h2>Nuevo recluta</h2>
    <p class="small muted" style="margin-top:-6px">Regístralo en cuanto lo metas. Cuando DiDi lo reporte en su Excel, el sistema lo empata por CURP o celular y le pone su estatus y documentos. Así queda claro quién lo reclutó para el pago.</p>
    <form id="fr" class="grid">
      <label class="field">Nombre completo<input class="input" name="nombre" required></label>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <label class="field">Celular (10 dígitos)<input class="input" name="celular" inputmode="tel" placeholder="81 1234 5678"></label>
        <label class="field">CURP<input class="input" name="curp" maxlength="18" style="text-transform:uppercase" placeholder="18 caracteres"></label>
      </div>
      ${esAdmin() ? `<label class="field">Reclutado por<select class="input" name="reclutado_por">${S.data.usuarios.filter((u) => u.activo).map((u) => `<option value="${esc(u.usuario)}" ${u.usuario === S.yo.usuario ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></label>`
        : `<div class="small">Quedará registrado como reclutado por <b>${esc(S.yo.nombre)}</b>.</div>`}
      <label class="field">Notas (opcional)<textarea class="input" name="notas" rows="2" placeholder="Ej. tiene coche propio, lo refirió su primo"></textarea></label>
      <div class="small muted">Captura al menos el celular o la CURP. Con la CURP el empate con DiDi es más seguro.</div>
      <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Registrar</button></div>
    </form>`);
  m.el.querySelector('#fr').onsubmit = async (e) => {
    e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('.primary'); btn.disabled = true;
    try {
      const r = await api('/reclutas', { method: 'POST', body: b });
      toast(r.yaExistia ? 'Ya estaba en el reporte de DiDi; quedó registrado como tu recluta' : 'Recluta registrado');
      m.close(); await recargar();
    } catch (err) { toast(err.message, { tipo: 'err', ms: 6000 }); btn.disabled = false; }
  };
}

async function exportar(arr, hoja) {
  try {
    const XLSX = await cargarXLSX();
    const filas = arr.map((d) => {
      const c = d.ch; const docs = c.docs || {};
      return {
        id_conductor: /^(CURP|TEL)-/.test(c.id) ? '' : c.id, nombre: c.nombre, celular: c.cel, curp: c.curp,
        reclutado_por: c.reclutado_por ? usuarioNombre(c.reclutado_por) : '', estatus_didi: c.estatus_didi,
        conduciendo: d.cats.has('rec_conduciendo') ? 'Sí' : 'No', recuperado: d.cats.has('recuperado') ? 'Sí' : '',
        activado_semana: c.activado_semana ? semanaLabel(c.activado_semana) : '', viajes_ultima_semana: d.m0?.viajes ?? '',
        ine: docs.ine || '', licencia: docs.licencia || '', tarjeta_circulacion: docs.tarjeta || '', foto_perfil: docs.foto || '', bgc: docs.bgc || '',
        documentos_pendientes: d.docs.map((x) => `${DOC_LABEL[x.k]}: ${x.estado}`).join('; '), comentario_didi: c.comentario_didi || '', notas: c.notas || '',
      };
    });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), hoja.slice(0, 31));
    XLSX.writeFile(wb, `Reclutamiento_Tamez_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { toast(e.message, { tipo: 'err' }); }
}
