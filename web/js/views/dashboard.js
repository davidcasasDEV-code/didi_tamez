// Inicio: resumen previo antes de entrar al detalle.
import { S, esAdmin, ir } from '../app.js';
import { api } from '../api.js';
import { esc, icon, fmtNum, fmtMoney, fmtPct, avatar, hace } from '../util.js';
import { semanaLabel, planDelDia, DIAS, SEGMENTOS } from '../logic.js';
import { eventoHtml } from './actividad.js';

export function renderDashboard(el) {
  const yo = S.yo;
  S.ui.dashScope ||= esAdmin() ? 'equipo' : 'mios';
  const scope = S.ui.dashScope;
  const todosBase = [...S.d.values()];
  const todos = todosBase.filter((d) => d.cats.has('conduciendo'));
  const reclutas = todosBase.filter((d) => d.cats.has('recluta'));
  const ultAct = [...new Set(reclutas.map((d) => d.ch.activado_semana).filter(Boolean))].sort().pop();
  const lista = scope === 'mios' ? todos.filter((d) => d.ch.asignado_a === yo.usuario) : todos;
  const semanas = S.data.semanas;

  if (!todosBase.length) {
    el.innerHTML = `<div class="card empty"><img src="assets/didi-mark.jpg" alt=""><h2>Aún no hay choferes cargados</h2>
      <p>${esAdmin() ? 'Importa la lista de conductores asignados o el Dashboard semanal de DiDi para empezar.' : 'El administrador aún no ha importado información.'}</p>
      ${esAdmin() ? `<button class="btn primary" id="goimp">${icon('upload')} Importar Excel</button>` : ''}</div>`;
    el.querySelector('#goimp')?.addEventListener('click', () => ir('importar'));
    return;
  }

  const cnt = (f) => lista.filter(f).length;
  const prioridad = lista.filter((d) => d.seg);
  const contactadosPrio = prioridad.filter((d) => d.contactadoSemana).length;
  const seg = { A: cnt((d) => d.seg === 'A'), B: cnt((d) => d.seg === 'B'), C: cnt((d) => d.seg === 'C') };
  const segPend = { A: cnt((d) => d.seg === 'A' && !d.contactadoSemana), B: cnt((d) => d.seg === 'B' && !d.contactadoSemana), C: cnt((d) => d.seg === 'C' && !d.contactadoSemana) };
  const docs = reclutas.filter((d) => d.docs.length && !d.bloqueado && (scope !== 'mios' || d.ch.reclutado_por === yo.usuario)).length;
  const activados = ultAct ? reclutas.filter((d) => d.ch.activado_semana === ultAct && (scope !== 'mios' || d.ch.reclutado_por === yo.usuario)).length : 0;
  const recup = cnt((d) => d.cats.has('recuperacion'));
  const sinAsignar = todos.filter((d) => !d.ch.asignado_a).length;

  const hoy = new Date(); const plan = planDelDia(hoy);
  const filtroBase = scope === 'mios' ? { asignado: yo.usuario } : {};

  // Tendencia 3 semanas por grupo (no se mezclan poblaciones distintas: asignados vs. nuevos conductores)
  const ws = [...semanas].reverse();
  const hayFuente = (f) => lista.some((d) => Object.values(S.data.metricas[d.ch.id] || {}).some((m) => m.fuente === f));
  const fuentes = ['asignados', 'productividad', 'recuperacion'].filter(hayFuente);
  if (!fuentes.includes(S.ui.dashFuente)) S.ui.dashFuente = fuentes[0];
  const fuente = S.ui.dashFuente;
  const FUENTE_LBL = { asignados: 'Asignados', productividad: 'Nuevos', recuperacion: 'Recuperación' };
  const serie = ws.map((w) => {
    let viajes = 0, ingreso = 0, tsh = 0, activos = 0, n = 0;
    for (const d of lista) {
      const m = S.data.metricas[d.ch.id]?.[w]; if (!m || m.fuente !== fuente) continue;
      n++; viajes += +m.viajes || 0; ingreso += +m.ingreso || 0; tsh += +m.tsh || 0; if (+m.viajes > 0) activos++;
    }
    return { w, viajes, ingreso, tsh, activos, n, vpc: n ? viajes / n : 0, ipc: n ? ingreso / n : 0, hpc: n ? tsh / n : 0 };
  }).filter((s) => s.n);

  const general = semanas.map((w) => [w, S.data.general[w]]).find(([, g]) => g);

  el.innerHTML = `
  <div class="topbar">
    <div><h1>Hola, ${esc(yo.nombre.split(' ')[0])} 👋</h1>
      <div class="muted">Semanas en análisis: ${semanas.map(semanaLabel).join(' · ') || '—'} · hoy es ${DIAS[hoy.getDay()]}</div></div>
    <div class="spacer"></div>
    <div class="tabs" style="margin:0">
      <button class="tab ${scope === 'mios' ? 'active' : ''}" data-scope="mios">Mis choferes</button>
      <button class="tab ${scope === 'equipo' ? 'active' : ''}" data-scope="equipo">Todo el equipo</button>
    </div>
  </div>

  <div class="cols-2" style="margin-bottom:14px">
    <div class="card today">
      <div class="card-h"><h2>Hoy toca (${DIAS[hoy.getDay()]})</h2></div>
      <div class="muted small">Plan semanal de contacto · un solo segmento por conductor, prioridad A &gt; B &gt; C</div>
      <div class="today-items">
        ${plan.map((p) => `<div class="today-item">
          ${p.seg ? `<span class="seg ${p.seg}">${p.seg}</span>` : icon('check')}
          <div style="flex:1"><b>${esc(p.accion)}</b>${p.seg ? `<div class="small muted">${segPend[p.seg]} sin contactar esta semana de ${seg[p.seg]}</div>` : ''}</div>
          ${p.seg ? `<button class="btn sm" data-go-seg="${p.seg}">Ver lista</button>` : `<button class="btn sm" data-go="choferes">Ver choferes</button>`}
        </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Avance de contacto de la semana</h2></div>
      <div style="font-size:34px;font-weight:800">${fmtPct(prioridad.length ? contactadosPrio / prioridad.length : 0)}</div>
      <div class="muted small" style="margin-bottom:10px">${contactadosPrio} de ${prioridad.length} choferes prioritarios contactados desde el lunes</div>
      <div class="bar"><i style="width:${prioridad.length ? (contactadosPrio / prioridad.length) * 100 : 0}%"></i></div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-top:14px">
        ${['A', 'B', 'C'].map((s) => `<div><span class="seg ${s}">${s}</span> <b>${seg[s] - segPend[s]}</b><span class="muted">/${seg[s]}</span><div class="small muted">${SEGMENTOS[s].nombre}</div></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="kpis">
    ${kpi('A · Sin viajes', seg.A, 'Métrica: retención', { seg: 'A' }, 'A')}
    ${kpi('B · Horas a la baja', seg.B, 'Métrica: TSH total', { seg: 'B' }, 'B')}
    ${kpi('C · Alto potencial', seg.C, 'Métrica: TSH por conductor', { seg: 'C' }, 'C')}
    ${kpi('Reclutas con docs pendientes', docs, 'Ver en Reclutamiento', { vista: 'reclutamiento', tab: 'documentos' })}
    ${kpi(`Activados ${ultAct ? semanaLabel(ultAct) : ''}`, activados, 'Primer viaje (para pago)', { vista: 'reclutamiento', tab: 'activados' })}
    ${kpi('Recuperación', recup, 'Potencial comeback', { cat: 'recuperacion' })}
    ${scope === 'equipo' ? kpi('Sin asignar', sinAsignar, 'Pendientes de repartir', { asignado: '_none', cat: 'todos' }) : kpi('Mis choferes', lista.length, 'Asignados a mí', { cat: 'todos' })}
  </div>

  <div class="cols-2b" style="margin-bottom:14px">
    <div class="card">
      <div class="card-h" style="flex-wrap:wrap"><h2>Comparativa 3 semanas</h2><span class="spacer"></span>
        <div class="tabs" style="margin:0">${fuentes.map((f) => `<button class="tab ${f === fuente ? 'active' : ''}" data-fuente="${f}">${FUENTE_LBL[f]}</button>`).join('')}</div></div>
      <div class="small muted" style="margin:-6px 0 6px">Promedio por conductor · ${fuente === 'asignados' ? 'lista semanal de conductores asignados' : fuente === 'productividad' ? 'nuevos conductores (Dashboard DiDi)' : 'conductores en recuperación'}</div>
      ${serie.length ? chartSemanas(serie) : '<div class="empty">Sin métricas semanales</div>'}
      <div class="table-wrap" style="border:0"><table class="t" style="margin-top:8px"><thead><tr><th>Semana</th><th class="num">Conductores</th><th class="num">Viajes / cond.</th><th class="num">Ingreso / cond.</th><th class="num">Horas / cond.</th><th class="num">Con ≥1 viaje</th></tr></thead>
      <tbody>${serie.map((s, i) => `<tr style="cursor:default"><td><b>${semanaLabel(s.w)}</b></td><td class="num">${fmtNum(s.n)}</td>
        <td class="num nowrap">${fmtNum(s.vpc, 1)} ${delta(s.vpc, serie[i - 1]?.vpc)}</td><td class="num nowrap">${fmtMoney(s.ipc)} ${delta(s.ipc, serie[i - 1]?.ipc)}</td>
        <td class="num">${fmtNum(s.hpc, 1)}</td><td class="num nowrap">${fmtPct(s.n ? s.activos / s.n : null)}</td></tr>`).join('')}</tbody></table></div>
      <div class="small muted">Para ver la caída de un chofer en particular abre su detalle: compara su última semana contra el promedio de las previas.</div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Indicadores DiDi</h2><span class="spacer"></span>${general ? `<span class="badge">${semanaLabel(general[0])}</span>` : ''}</div>
      ${general ? kpisDidi(general[1]) : '<div class="empty small">Importa el “Dashboard V2.0” para ver los indicadores oficiales de la semana.</div>'}
    </div>
  </div>

  <div class="cols-2b">
    <div class="card">
      <div class="card-h"><h2>Carga por reclutador</h2></div>
      ${cargaEquipo(todos)}
    </div>
    <div class="card">
      <div class="card-h"><h2>Actividad reciente</h2><span class="spacer"></span><a href="#/actividad" class="small">Ver todo</a></div>
      <div class="timeline" id="dact"><div class="muted small">Cargando…</div></div>
    </div>
  </div>`;

  el.querySelectorAll('[data-fuente]').forEach((b) => (b.onclick = () => { S.ui.dashFuente = b.dataset.fuente; renderDashboard(el); }));
  el.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => { S.ui.dashScope = b.dataset.scope; renderDashboard(el); }));
  el.querySelectorAll('[data-filtro]').forEach((b) => (b.onclick = () => {
    const f = JSON.parse(b.dataset.filtro);
    if (f.vista === 'reclutamiento') { S.ui.rec = { tab: f.tab, q: '', rec: scope === 'mios' ? yo.usuario : '', pagina: 0 }; ir('reclutamiento'); return; }
    irChoferes({ ...filtroBase, ...f });
  }));
  el.querySelectorAll('[data-go-seg]').forEach((b) => (b.onclick = () => irChoferes({ ...filtroBase, seg: b.dataset.goSeg, contacto: 'no_semana' })));
  el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => ir(b.dataset.go)));
  el.querySelectorAll('[data-user]').forEach((b) => (b.onclick = () => irChoferes({ asignado: b.dataset.user, cat: 'todos' })));

  api('/actividad?limit=8').then((evs) => {
    const box = el.querySelector('#dact'); if (!box) return;
    box.innerHTML = evs.length ? evs.map(eventoHtml).join('') : '<div class="muted small">Sin actividad todavía.</div>';
  }).catch(() => {});
}

function irChoferes(f) {
  S.ui.filtros = { cat: f.seg ? 'prioridad' : 'todos', q: '', seg: '', asignado: '', contacto: '', ...f };
  S.ui.pagina = 0; ir('choferes');
}

const kpi = (lbl, val, sub, filtro, seg) => `<div class="kpi link" data-filtro='${esc(JSON.stringify(filtro))}'>
  <div class="lbl">${seg ? `<span class="seg ${seg}">${seg}</span>` : ''}${esc(lbl)}</div><div class="val">${fmtNum(val)}</div><div class="sub">${esc(sub)}</div></div>`;

function delta(a, b) {
  if (b == null || !b) return '';
  const p = (a - b) / b; const c = p > 0.02 ? 'up' : p < -0.02 ? 'down' : 'flat';
  return `<span class="trend ${c}">${p > 0 ? '▲' : p < 0 ? '▼' : '•'}${Math.abs(p * 100).toFixed(0)}%</span>`;
}

function chartSemanas(serie) {
  const W = 520, H = 170, pad = 28; const max = Math.max(1, ...serie.map((s) => s.vpc));
  const bw = Math.min(90, (W - pad * 2) / serie.length - 30);
  const bars = serie.map((s, i) => {
    const x = pad + i * ((W - pad * 2) / serie.length) + ((W - pad * 2) / serie.length - bw) / 2;
    const h = Math.max(2, (s.vpc / max) * (H - 50)); const y = H - 24 - h;
    const last = i === serie.length - 1;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="${last ? 'var(--brand)' : 'var(--brand-2)'}" opacity="${last ? 1 : 0.4}"/>
      <text class="v" x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${fmtNum(s.vpc, 1)}</text>
      <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${semanaLabel(s.w)}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Viajes por semana">${bars}</svg>
    <div class="legend"><span><i style="background:var(--brand)"></i>Viajes por conductor (última semana resaltada)</span></div>`;
}

function kpisDidi(kpis) {
  const total = kpis.find((k) => /total/i.test(k.indicador));
  const rows = kpis.filter((k) => k !== total);
  return `${total ? `<div style="font-size:34px;font-weight:800">${fmtPct(total.peso ?? total.cumplimiento, 1)}</div><div class="muted small" style="margin-bottom:12px">Cumplimiento semanal total</div>` : ''}
  <div class="grid">${rows.map((k) => {
    const pct = Math.max(0, Math.min(1, k.cumplimiento || 0)); const esPct = (k.target ?? 0) <= 1 && (k.actual ?? 0) <= 1;
    const f = (v) => (esPct ? fmtPct(v, 1) : fmtNum(v, 1));
    return `<div><div class="row small"><b style="flex:1">${esc(k.indicador)}</b><span class="muted">peso ${fmtPct(k.peso)}</span></div>
      <div class="row small muted"><span>Actual <b style="color:var(--text)">${f(k.actual)}</b> / meta ${f(k.target)}</span><span class="spacer"></span><b style="color:var(--text)">${fmtPct(k.cumplimiento)}</b></div>
      <div class="bar"><i style="width:${pct * 100}%;background:${pct >= 0.85 ? 'var(--ok)' : pct >= 0.5 ? 'var(--warn)' : 'var(--bad)'}"></i></div></div>`;
  }).join('')}</div>`;
}

function cargaEquipo(todos) {
  const us = S.data.usuarios.filter((u) => u.activo);
  const filas = us.map((u) => {
    const mios = todos.filter((d) => d.ch.asignado_a === u.usuario);
    const prio = mios.filter((d) => d.seg); const ok = prio.filter((d) => d.contactadoSemana).length;
    const ult = mios.map((d) => d.ch.ultimo_contacto).filter((x) => x && x.por === u.usuario).map((x) => x.fecha).sort().pop();
    return { u, total: mios.length, prio: prio.length, ok, ult };
  }).sort((a, b) => b.total - a.total);
  if (!filas.length) return '<div class="muted">Sin usuarios</div>';
  return `<div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>Reclutador</th><th class="num">Asignados</th><th class="num">Prioritarios</th><th>Avance semana</th><th>Último contacto</th></tr></thead><tbody>
  ${filas.map((f) => `<tr data-user="${esc(f.u.usuario)}"><td><div class="row" style="flex-wrap:nowrap">${avatar(f.u.nombre, f.u.usuario)}<b class="nowrap">${esc(f.u.nombre)}</b></div></td>
    <td class="num">${f.total}</td><td class="num">${f.prio}</td>
    <td style="min-width:120px"><div class="bar"><i style="width:${f.prio ? (f.ok / f.prio) * 100 : 0}%"></i></div><span class="small muted">${f.ok}/${f.prio}</span></td>
    <td class="small muted nowrap">${f.ult ? hace(f.ult) : '—'}</td></tr>`).join('')}
  </tbody></table></div>`;
}
