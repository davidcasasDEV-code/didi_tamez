// Reclutamiento: base de todos los reclutas del equipo, quién metió a quién, estado de documentos y activaciones (para pago).
import { S, esAdmin, usuarioNombre, recargar, hashParams } from '../app.js';
import { api } from '../api.js';
import { esc, icon, fmtNum, celBonito, telLink, avatar, hace, toast, modal, cargarXLSX, titulo, colorDe, iniciales } from '../util.js';
import { semanaLabel, DOC_LABEL } from '../logic.js';
import { abrirPlantillas } from './chofer.js';
import { estatusHtml } from './choferes.js';

const POR_PAGINA = 100;
const rechazado = (d) => Object.values(d.ch.docs || {}).some((v) => /rechaz|reject/i.test(v || ''));
const listo = (d) => /listo para conducir/i.test(d.ch.estatus_didi || '');
const enProceso = (d) => /en proceso|sin registro|aún s|registrado por el equipo/i.test(d.ch.estatus_didi || '');
const TABS = [
  ['todos', 'Todos', () => true],
  ['documentos', 'Documentos pendientes', (d) => d.docs.length > 0 && !d.bloqueado],
  ['rechazados', 'Rechazados', rechazado],
  ['listos', 'Listos, sin viajes', listo],
  ['proceso', 'En proceso / sin registro', enProceso],
  ['activados', 'Activados', (d) => !!d.ch.activado_semana],
];

function lista(f) {
  const q = f.q.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
  const tab = TABS.find((t) => t[0] === f.tab)?.[2] || (() => true);
  return [...S.d.values()].filter((d) => {
    if (!d.cats.has('recluta')) return false;
    if (!tab(d)) return false;
    if (f.rec === '_none' && d.ch.reclutado_por) return false;
    if (f.rec && f.rec !== '_none' && d.ch.reclutado_por !== f.rec) return false;
    if (q) {
      const hay = `${d.ch.nombre || ''} ${d.ch.curp || ''} ${d.ch.id}`.toLowerCase();
      if (!hay.includes(q) && !(qd.length >= 4 && String(d.ch.cel || '').includes(qd))) return false;
    }
    return true;
  }).sort((a, b) => String(b.ch.activado_en || b.ch.reclutado_en || b.ch.creado_en || '').localeCompare(String(a.ch.activado_en || a.ch.reclutado_en || a.ch.creado_en || '')));
}

const docChip = (lbl, v) => {
  const cls = /aprob|approved/i.test(v) ? 'b-ok' : /rechaz|reject|expir/i.test(v) ? 'b-bad' : /sin subir|pending|review/i.test(v) ? 'b-warn' : '';
  return `<span class="badge ${cls}" title="${esc(lbl)}: ${esc(v || 'sin dato')}">${esc(lbl)}</span>`;
};
const docsHtml = (c) => (c.docs ? `<div class="docs">${docChip('INE', c.docs.ine)}${docChip('Lic', c.docs.licencia)}${docChip('Tarj', c.docs.tarjeta)}${docChip('Foto', c.docs.foto)}${docChip('BGC', c.docs.bgc)}</div>` : '<span class="small muted">Aún sin datos de DiDi</span>');
const recHtml = (u) => (u ? `<span class="row" style="gap:6px;flex-wrap:nowrap"><span class="avatar" style="width:24px;height:24px;font-size:10px;background:${colorDe(u)}">${esc(iniciales(usuarioNombre(u)))}</span><span class="nowrap">${esc(usuarioNombre(u).split(' ')[0])}</span></span>` : '<span class="badge b-warn">Sin registrar</span>');

export function renderReclutamiento(el) {
  S.ui.rec ||= { tab: 'todos', q: '', rec: '', pagina: 0 };
  const f = S.ui.rec;
  const todos = [...S.d.values()].filter((d) => d.cats.has('recluta'));
  const arr = lista(f);
  const paginas = Math.max(1, Math.ceil(arr.length / POR_PAGINA));
  f.pagina = Math.min(f.pagina || 0, paginas - 1);
  const pag = arr.slice(f.pagina * POR_PAGINA, (f.pagina + 1) * POR_PAGINA);
  const usuarios = S.data.usuarios;

  // Activaciones por reclutador y semana (base para el pago)
  const semanasAct = [...new Set(todos.map((d) => d.ch.activado_semana).filter(Boolean))].sort().reverse().slice(0, 4);
  const filasAct = [...usuarios.map((u) => u.usuario), null].map((u) => {
    const mios = todos.filter((d) => (d.ch.reclutado_por || null) === u);
    return { u, total: mios.length, act: mios.filter((d) => d.ch.activado_semana), porSem: semanasAct.map((w) => mios.filter((d) => d.ch.activado_semana === w).length) };
  }).filter((r) => r.total || r.act.length);
  const ultimaAct = semanasAct[0];

  el.innerHTML = `
  <div class="topbar">
    <div><h1>Reclutamiento</h1><div class="muted">Todos los reclutas del equipo, quién los metió y cómo van con DiDi</div></div>
    <div class="spacer"></div>
    <button class="btn" id="rexp">${icon('down')} Exportar</button>
    <button class="btn primary" id="rnuevo">+ Nuevo recluta</button>
  </div>
  <div class="kpis">
    ${kpi('Reclutas', todos.length, 'en la base', 'todos')}
    ${kpi('Documentos pendientes', todos.filter(TABS[1][2]).length, 'hay que darles seguimiento', 'documentos')}
    ${kpi('Rechazados', todos.filter(rechazado).length, 'INE, licencia, etc.', 'rechazados')}
    ${kpi('Listos sin viajes', todos.filter(listo).length, 'empujar al primer viaje', 'listos')}
    ${kpi(`Activados ${ultimaAct ? semanaLabel(ultimaAct) : ''}`, ultimaAct ? todos.filter((d) => d.ch.activado_semana === ultimaAct).length : 0, 'primer viaje esta semana', 'activados')}
    ${kpi('Sin reclutador', todos.filter((d) => !d.ch.reclutado_por).length, 'nadie los ha registrado', null, '_none')}
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-h"><h2 style="flex:1">Activados por reclutador (para pago)</h2><span class="small muted">Activado = primer viaje reportado por DiDi</span></div>
    ${filasAct.length ? `<div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>Reclutador</th><th class="num">Reclutas</th>${semanasAct.map((w) => `<th class="num">${semanaLabel(w)}</th>`).join('')}<th class="num">Total activados</th></tr></thead><tbody>
      ${filasAct.map((r) => `<tr data-rec="${esc(r.u || '_none')}"><td>${recHtml(r.u)}</td><td class="num">${r.total}</td>${r.porSem.map((n) => `<td class="num"><b>${n || '—'}</b></td>`).join('')}<td class="num"><b>${r.act.length}</b></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="muted small">Aún no hay reclutas registrados.</div>'}
  </div>

  <div class="tabs">${TABS.map(([k, l, fn]) => `<button class="tab ${f.tab === k ? 'active' : ''}" data-tab="${k}">${l} <span class="badge">${todos.filter(fn).filter((d) => !f.rec || (f.rec === '_none' ? !d.ch.reclutado_por : d.ch.reclutado_por === f.rec)).length}</span></button>`).join('')}</div>
  <div class="filters" style="grid-template-columns:2fr 1fr">
    <input class="input search" id="rq" placeholder="Buscar por nombre, celular, CURP o ID…" value="${esc(f.q)}">
    <select class="input" id="rrec">
      <option value="">Reclutado por: todos</option>
      <option value="${esc(S.yo.usuario)}" ${f.rec === S.yo.usuario ? 'selected' : ''}>Mis reclutas</option>
      <option value="_none" ${f.rec === '_none' ? 'selected' : ''}>Sin registrar</option>
      ${usuarios.filter((u) => u.usuario !== S.yo.usuario).map((u) => `<option value="${esc(u.usuario)}" ${f.rec === u.usuario ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
    </select>
  </div>

  ${arr.length ? `<div class="table-wrap table-desktop"><table class="t"><thead><tr>
      <th>Recluta</th><th>Reclutado por</th><th>Estatus DiDi</th><th>Documentos</th><th>Activado</th><th>Contacto</th><th style="width:96px"></th></tr></thead>
    <tbody>${pag.map((d) => {
      const c = d.ch;
      return `<tr data-open="${esc(c.id)}">
        <td class="name-cell"><b>${esc(titulo(c.nombre || '(sin nombre)'))}</b><span>${esc(c.cel ? celBonito(c.cel) : c.curp ? 'CURP ' + c.curp + ' · sin celular' : 'sin celular')}${c.comentario_didi ? ` · <span title="${esc(c.comentario_didi)}" style="color:var(--warn)">nota DiDi</span>` : ''}</span></td>
        <td>${recHtml(c.reclutado_por)}</td>
        <td class="small" style="max-width:200px">${esc(c.estatus_didi || '—')}</td>
        <td>${docsHtml(c)}</td>
        <td class="nowrap">${c.activado_semana ? `<span class="badge b-ok">${esc(semanaLabel(c.activado_semana))}</span>` : '<span class="muted small">—</span>'}</td>
        <td>${estatusHtml(c.estatus_contacto)}<div class="small muted nowrap">${c.ultimo_contacto ? hace(c.ultimo_contacto.fecha) : 'nunca'}</div></td>
        <td class="nowrap">${c.cel ? `<button class="btn icon sm wa" data-wa="${esc(c.id)}" title="Mensaje por WhatsApp">${icon('wa')}</button>
          <a class="btn icon sm" href="${telLink(c.cel)}" title="Llamar" data-stop>${icon('phone')}</a>` : ''}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div class="cards-mobile">${pag.map((d) => {
      const c = d.ch;
      return `<div class="mcard" data-open="${esc(c.id)}"><div class="top"><div style="flex:1;min-width:0"><b>${esc(titulo(c.nombre || ''))}</b>
        <div class="small muted">${esc(c.estatus_didi || '')}</div></div>${c.activado_semana ? `<span class="badge b-ok">Activado ${esc(semanaLabel(c.activado_semana))}</span>` : ''}</div>
        ${docsHtml(c)}
        <div class="row">${recHtml(c.reclutado_por)}<span class="spacer"></span>${c.cel ? `<button class="btn sm wa" data-wa="${esc(c.id)}">${icon('wa')} WhatsApp</button>` : '<span class="small muted">sin celular</span>'}</div></div>`;
    }).join('')}</div>
    ${paginas > 1 ? `<div class="pager"><span class="muted small">Página ${f.pagina + 1} de ${paginas}</span>
      <button class="btn sm" id="rprev" ${f.pagina === 0 ? 'disabled' : ''}>Anterior</button><button class="btn sm" id="rnext" ${f.pagina >= paginas - 1 ? 'disabled' : ''}>Siguiente</button></div>` : ''}`
  : '<div class="card empty"><h2>Sin resultados</h2><p>No hay reclutas con estos filtros.</p></div>'}`;

  const set = (p) => { Object.assign(f, p, { pagina: 0 }); renderReclutamiento(el); };
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => set({ tab: b.dataset.tab })));
  el.querySelectorAll('[data-kpi]').forEach((b) => (b.onclick = () => set(JSON.parse(b.dataset.kpi))));
  el.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => set({ rec: b.dataset.rec, tab: 'activados' })));
  let t; el.querySelector('#rq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { set({ q: e.target.value }); const i = el.querySelector('#rq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  el.querySelector('#rrec').onchange = (e) => set({ rec: e.target.value });
  el.querySelector('#rprev')?.addEventListener('click', () => { f.pagina--; renderReclutamiento(el); window.scrollTo(0, 0); });
  el.querySelector('#rnext')?.addEventListener('click', () => { f.pagina++; renderReclutamiento(el); window.scrollTo(0, 0); });
  el.querySelectorAll('[data-open]').forEach((r) => (r.onclick = () => { const p = hashParams(); p.set('chofer', r.dataset.open); location.hash = `#/reclutamiento?${p}`; }));
  el.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); abrirPlantillas(b.dataset.wa); }));
  el.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = (e) => e.stopPropagation()));
  el.querySelector('#rnuevo').onclick = nuevoRecluta;
  el.querySelector('#rexp').onclick = () => exportar(arr);
}

function kpi(lbl, val, sub, tab, rec) {
  const filtro = { ...(tab ? { tab } : {}), ...(rec ? { rec, tab: 'todos' } : {}) };
  return `<div class="kpi link" data-kpi='${esc(JSON.stringify(filtro))}'><div class="lbl">${esc(lbl)}</div><div class="val">${fmtNum(val)}</div><div class="sub">${esc(sub)}</div></div>`;
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
      toast(r.yaExistia ? 'Ya estaba en la base de DiDi; quedó registrado como tu recluta' : 'Recluta registrado');
      m.close(); await recargar();
    } catch (err) { toast(err.message, { tipo: 'err', ms: 6000 }); btn.disabled = false; }
  };
}

async function exportar(arr) {
  try {
    const XLSX = await cargarXLSX();
    const filas = arr.map((d) => {
      const c = d.ch; const docs = c.docs || {};
      return {
        id_conductor: c.id.startsWith('CURP-') || c.id.startsWith('TEL-') ? '' : c.id, nombre: c.nombre, celular: c.cel, curp: c.curp,
        reclutado_por: c.reclutado_por ? usuarioNombre(c.reclutado_por) : '', fecha_registro: (c.reclutado_en || '').slice(0, 10),
        estatus_didi: c.estatus_didi, ine: docs.ine || '', licencia: docs.licencia || '', tarjeta_circulacion: docs.tarjeta || '',
        foto_perfil: docs.foto || '', bgc: docs.bgc || '', comentario_didi: c.comentario_didi || '',
        documentos_pendientes: d.docs.map((x) => `${DOC_LABEL[x.k]}: ${x.estado}`).join('; '),
        activado_semana: c.activado_semana ? semanaLabel(c.activado_semana) : '', notas: c.notas || '',
      };
    });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Reclutamiento');
    XLSX.writeFile(wb, `Reclutamiento_Tamez_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { toast(e.message, { tipo: 'err' }); }
}
