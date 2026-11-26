// Importación de los Excel de DiDi: detección automática, semana, carga en lotes y depuración (solo 3 semanas).
import { S, recargar, ir, esAdmin } from '../app.js';
import { api } from '../api.js';
import { esc, icon, fmtNum, fmtFecha, toast } from '../util.js';
import { leerArchivo, TIPO_LABEL } from '../importer.js';
import { semanaLabel, semanaKey } from '../logic.js';

const LOTE = 150;
let estado = null; // { archivo, conjuntos }

export function renderImportar(el) {
  const hist = S.data.importaciones || [];
  el.innerHTML = `
  <div class="topbar"><div><h1>Importar Excel de DiDi</h1>
    <div class="muted">Acepta la “Lista de conductores asignados” y el “Dashboard V2.0” semanal. Se conservan solo las 3 semanas más recientes; la 4ª se elimina automáticamente.</div></div></div>
  <div class="cols-2">
    <div class="grid">
      <label class="dropzone" id="dz">
        <input type="file" id="fin" accept=".xlsx,.xls" hidden>
        ${icon('upload', 'svg-i" style="width:34px;height:34px;color:var(--brand)')}
        <h2 style="margin-top:8px">Arrastra aquí el Excel o haz clic</h2>
        <div class="muted small">Se lee en tu navegador; solo se envían los datos necesarios.</div>
      </label>
      <div id="prev"></div>
    </div>
    <div class="card"><h2>Semanas en la base</h2>
      <div class="row" style="margin:8px 0 14px">${S.data.semanas.length ? S.data.semanas.map((w, i) => `<span class="badge ${i === 0 ? 'b-brand' : ''}">${semanaLabel(w)} · ${w.slice(0, 4)}</span>`).join('') : '<span class="muted">Ninguna todavía</span>'}</div>
      <h3 style="margin-bottom:8px">Últimas importaciones</h3>
      <div class="grid small">${hist.length ? hist.slice(0, 12).map((h) => `<div><b>${esc(h.archivo || h.tipo)}</b> <span class="badge">${h.tipo === 'reclutas' ? 'Reclutas' : semanaLabel(h.semana)}</span>
        <div class="muted">${esc(h.usuario)} · ${fmtFecha(h.fecha, true)} · ${h.resumen?.nuevos ?? 0} nuevos, ${h.resumen?.actualizados ?? 0} actualizados${h.depuradas?.length ? ` · depuró ${h.depuradas.map(semanaLabel).join(', ')}` : ''}</div></div>`).join('') : '<span class="muted">Aún no hay importaciones.</span>'}</div>
    </div>
  </div>`;

  const dz = el.querySelector('#dz'); const fin = el.querySelector('#fin');
  fin.onchange = () => fin.files[0] && procesar(fin.files[0], el);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) procesar(f, el); };
  if (estado) pintarPrevia(el);
}

async function procesar(file, el) {
  const prev = el.querySelector('#prev');
  prev.innerHTML = '<div class="card muted">Leyendo archivo…</div>';
  try {
    const conjuntos = await leerArchivo(file);
    if (!conjuntos.length) { prev.innerHTML = '<div class="card err">No reconocí ninguna hoja de DiDi en este archivo.</div>'; estado = null; return; }
    estado = { archivo: file.name, conjuntos: conjuntos.map((c) => ({ ...c, incluir: true })) };
    pintarPrevia(el);
  } catch (e) { prev.innerHTML = `<div class="card err">${esc(e.message)}</div>`; estado = null; }
}

function pintarPrevia(el) {
  const prev = el.querySelector('#prev'); const { archivo, conjuntos } = estado;
  const existentes = new Set(S.data.choferes.map((c) => c.id));
  const top3 = S.data.semanas.slice(0, 3);
  prev.innerHTML = `<div class="card">
    <div class="card-h"><h2 style="flex:1">${esc(archivo)}</h2><button class="btn icon ghost" id="pcan">${icon('x')}</button></div>
    ${conjuntos.some((c) => c.tipo === 'reclutas') ? `<div class="card" style="background:var(--surface-2);box-shadow:none;margin-bottom:10px">
      ${esAdmin() ? `<div class="row"><label class="field" style="flex:1;min-width:200px">¿Quién reclutó a las personas de este archivo?
        <select class="input" id="prec">${S.data.usuarios.filter((u) => u.activo).map((u) => `<option value="${esc(u.usuario)}" ${u.usuario === (estado.reclutador || S.yo.usuario) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></label>
        <label class="row small" style="align-self:flex-end"><input type="checkbox" id="preem" ${estado.reemplazar ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--brand)"> Reemplazar si ya tienen otro reclutador</label></div>`
      : `<div><b>Quedarán registrados como reclutados por ti (${esc(S.yo.nombre)}).</b> Si alguno ya es recluta de otra persona, se respeta.</div>`}
      <div class="small muted" style="margin-top:6px">Se empatan por CURP o celular con lo que ya reportó DiDi (no se duplican). Los que DiDi aún no reporta se crean como reclutas en espera. Esto no toca Asignaciones.</div>
    </div>` : ''}
    <div class="grid">${conjuntos.map((c, i) => {
      if (c.tipo === 'reclutas') {
        return `<div class="row" style="border:1px solid var(--border);border-radius:12px;padding:10px">
          <input type="checkbox" data-inc="${i}" ${c.incluir ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--brand)">
          <div style="flex:1"><b>${esc(TIPO_LABEL.reclutas)}</b> <span class="badge ${c.conduciendo ? 'b-ok' : 'b-warn'}">${c.conduciendo ? 'Conduciendo' : 'Esperando estatus'}</span>
          <div class="small muted">Hoja “${esc(c.hoja)}” · ${fmtNum(c.total)} personas</div></div></div>`;
      }
      const nuevos = c.tipo === 'general' ? 0 : c.filas.filter((f) => !existentes.has(f.id)).length;
      const [y, w] = c.semana.split('-W');
      const vieja = top3.length >= 3 && c.semana < top3[2] && !top3.includes(c.semana);
      return `<div class="row" style="border:1px solid var(--border);border-radius:12px;padding:10px">
        <input type="checkbox" data-inc="${i}" ${c.incluir ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--brand)">
        <div style="flex:1;min-width:180px"><b>${esc(TIPO_LABEL[c.tipo])}</b>
          <div class="small muted">Hoja “${esc(c.hoja)}” · ${fmtNum(c.total)} ${c.tipo === 'general' ? 'indicadores' : `choferes (${nuevos} nuevos)`}</div>
          ${vieja ? '<div class="small" style="color:var(--warn)">Esta semana es más antigua que las 3 que se conservan: se depurará al terminar.</div>' : ''}</div>
        <label class="row small">Semana <input class="input" type="number" min="1" max="53" value="${+w}" data-w="${i}" style="width:70px;padding:6px 8px">
          <input class="input" type="number" min="2024" max="2100" value="${y}" data-y="${i}" style="width:84px;padding:6px 8px"></label>
      </div>`;
    }).join('')}</div>
    <div class="progress hidden" id="pbar" style="margin-top:14px"><i></i></div>
    <div class="small muted" id="pmsg" style="margin-top:6px"></div>
    <div class="actions"><button class="btn" id="pcan2">Cancelar</button><button class="btn primary" id="pgo">${icon('upload')} Importar</button></div>
  </div>`;
  const cancelar = () => { estado = null; prev.innerHTML = ''; };
  prev.querySelector('#pcan').onclick = cancelar; prev.querySelector('#pcan2').onclick = cancelar;
  prev.querySelectorAll('[data-inc]').forEach((x) => (x.onchange = () => (conjuntos[+x.dataset.inc].incluir = x.checked)));
  const setW = (i) => { conjuntos[i].semana = semanaKey(+prev.querySelector(`[data-y="${i}"]`).value, +prev.querySelector(`[data-w="${i}"]`).value); };
  prev.querySelectorAll('[data-w],[data-y]').forEach((x) => (x.onchange = () => { setW(+(x.dataset.w ?? x.dataset.y)); pintarPrevia(el); }));
  prev.querySelector('#prec')?.addEventListener('change', (e) => (estado.reclutador = e.target.value));
  prev.querySelector('#preem')?.addEventListener('change', (e) => (estado.reemplazar = e.target.checked));
  prev.querySelector('#pgo').onclick = () => importar(el);
}

async function importar(el) {
  const { archivo, conjuntos } = estado;
  const sel = conjuntos.filter((c) => c.incluir);
  if (!sel.length) return toast('Selecciona al menos una hoja', { tipo: 'err' });
  const btn = el.querySelector('#pgo'); btn.disabled = true; el.querySelector('#pcan2').disabled = true;
  const bar = el.querySelector('#pbar'); const msg = el.querySelector('#pmsg'); bar.classList.remove('hidden');
  // Orden: conversion/recuperacion antes que productividad/asignados, para que las métricas de operación ganen si se repite un chofer.
  const ORD = { general: 0, conversion: 1, recuperacion: 2, productividad: 3, asignados: 4, reclutas: 5 };
  sel.sort((a, b) => ORD[a.tipo] - ORD[b.tipo]);
  const reclutador = esAdmin() ? (estado.reclutador || S.yo.usuario) : S.yo.usuario; const reemplazar = !!estado.reemplazar;
  const resRec = { empatados: 0, nuevos: 0, yaTenianOtro: 0, sinDatos: 0 };
  // Excel de reclutas: una fila por persona con todas las pestañas donde aparece (una persona puede venir en varias).
  const hojasRec = sel.filter((c) => c.tipo === 'reclutas');
  if (hojasRec.length) {
    const porPersona = new Map();
    for (const c of hojasRec) for (const r of c.filas) {
      const k = r.curp || 'T' + String(r.celular || '').replace(/\D/g, '').slice(-10);
      const p = porPersona.get(k);
      if (!p) { porPersona.set(k, { ...r, hojas: [r.hoja] }); continue; }
      if (!p.hojas.includes(r.hoja)) p.hojas.push(r.hoja);
      p.conduciendo ||= r.conduciendo; p.recuperado ||= r.recuperado;
      if (r.notas && !String(p.notas || '').includes(r.notas)) p.notas = [p.notas, r.notas].filter(Boolean).join(' · ');
      if (!p.celular && r.celular) p.celular = r.celular;
    }
    sel.splice(0, sel.length, ...sel.filter((c) => c.tipo !== 'reclutas'), { tipo: 'reclutas', hoja: hojasRec.map((c) => c.hoja).join(' + '), filas: [...porPersona.values()] });
    await api('/import/reclutas-inicio', { method: 'POST', body: { reclutado_por: reclutador } });
  }
  const total = sel.reduce((a, c) => a + Math.ceil(c.filas.length / LOTE), 0); let hechos = 0;
  const resumen = { nuevos: 0, actualizados: 0 };
  const ids = new Set();
  try {
    for (const c of sel) {
      for (let i = 0; i < c.filas.length; i += LOTE) {
        msg.textContent = `${TIPO_LABEL[c.tipo]}: ${Math.min(i + LOTE, c.filas.length)} de ${c.filas.length}…`;
        const rows = c.filas.slice(i, i + LOTE);
        if (c.tipo === 'reclutas') {
          const rr = await api('/import/reclutas', { method: 'POST', body: { reclutado_por: reclutador, reemplazar, rows } });
          for (const k in resRec) resRec[k] += rr[k] || 0;
          hechos++; bar.firstElementChild.style.width = `${(hechos / total) * 100}%`; continue;
        }
        const r = await api('/import/lote', { method: 'POST', body: { tipo: c.tipo, semana: c.semana, rows } });
        resumen.nuevos += r.nuevos; resumen.actualizados += r.actualizados;
        if (c.tipo !== 'general') rows.forEach((x) => ids.add(x.id));
        hechos++; bar.firstElementChild.style.width = `${(hechos / total) * 100}%`;
      }
    }
    msg.textContent = 'Depurando semanas antiguas…';
    const semanas = [...new Set(sel.filter((c) => c.tipo !== 'reclutas').map((c) => c.semana))].sort();
    let fin = { semanas: S.data.semanas, depuradas: [], registrosBorrados: 0 };
    for (const s of semanas) fin = await api('/import/finalizar', { method: 'POST', body: { semana: s, archivo, tipo: sel.map((c) => c.tipo).join('+'), resumen } });
    const conReclutas = sel.some((c) => c.tipo === 'reclutas');
    if (conReclutas) await api('/import/finalizar-reclutas', { method: 'POST', body: { archivo, reclutado_por: reclutador, resumen: resRec } });
    bar.firstElementChild.style.width = '100%';
    estado = null;
    await recargar();
    const sinAsignar = [...ids].filter((id) => !S.d.get(id)?.ch.asignado_a).length;
    el.querySelector('#prev').innerHTML = `<div class="card">
      <h2>${icon('check')} Importación terminada</h2>
      ${conReclutas ? `<p><b>Reclutas:</b> ${resRec.empatados} empatados con lo que ya reportó DiDi · ${resRec.nuevos} nuevos en espera${resRec.yaTenianOtro ? ` · ${resRec.yaTenianOtro} ya tenían otro reclutador${reemplazar ? ' (se reemplazó)' : ' (se respetó)'}` : ''}${resRec.sinDatos ? ` · ${resRec.sinDatos} sin CURP ni celular (no se cargaron)` : ''}</p>` : ''}
      ${semanas.length ? `<p>${resumen.nuevos} choferes nuevos · ${resumen.actualizados} actualizados.<br>
      Semanas en la base: ${fin.semanas.map(semanaLabel).join(', ')}${fin.depuradas.length ? `<br><b>Se depuraron:</b> ${fin.depuradas.map(semanaLabel).join(', ')} (${fin.registrosBorrados} registros)` : ''}</p>` : ''}
      ${esAdmin() && sinAsignar && sel.some((c) => c.tipo === 'asignados') ? `<button class="btn primary" id="gasig">Asignar los ${sinAsignar} sin asignar</button>` : ''}
    </div>`;
    el.querySelector('#gasig')?.addEventListener('click', () => {
      S.ui.filtros = { cat: 'todos', q: '', seg: '', asignado: '_none', contacto: '', orden: 'prioridad' };
      S.ui.sel = new Set([...ids].filter((id) => !S.d.get(id)?.ch.asignado_a)); S.ui.pagina = 0; ir('choferes');
    });
    toast('Importación completa');
  } catch (e) {
    msg.textContent = ''; toast(`Error al importar: ${e.message}`, { tipo: 'err' });
    btn.disabled = false; el.querySelector('#pcan2').disabled = false;
  }
}
