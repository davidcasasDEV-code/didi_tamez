// Administración: usuarios del equipo, plantillas de mensajes y umbrales de segmentación.
import { S, recargar } from '../app.js';
import { api } from '../api.js';
import { esc, icon, avatar, toast, modal, confirmar, fmtFecha } from '../util.js';
import { VARIABLES_DISPONIBLES, llenar, variables, SEGMENTOS } from '../logic.js';

const CATEGORIAS = [['bienvenida', 'Bienvenida'], ['A', 'Segmento A'], ['B', 'Segmento B'], ['C', 'Segmento C'], ['seguimiento', 'Seguimiento'], ['documentos', 'Documentos'], ['recuperacion', 'Recuperación'], ['salida', 'Salida (opt-out)'], ['general', 'General']];

export function renderAdmin(el) {
  const u = S.data.umbrales;
  el.innerHTML = `
  <div class="topbar"><div><h1>Administración</h1><div class="muted">Equipo, plantillas y reglas de segmentación</div></div></div>
  <div class="cols-2b" style="margin-bottom:14px">
    <div class="card">
      <div class="card-h"><h2 style="flex:1">Equipo</h2><button class="btn sm primary" id="nuevoU">+ Agregar persona</button></div>
      <div class="grid">${S.data.usuarios.sort((a, b) => a.nombre.localeCompare(b.nombre)).map((x) => `
        <div class="row" style="border:1px solid var(--border);border-radius:12px;padding:10px;${x.activo ? '' : 'opacity:.55'}">
          ${avatar(x.nombre, x.usuario)}
          <div style="flex:1;min-width:0"><b>${esc(x.nombre)}</b><div class="small muted">${esc(x.usuario)} · ${x.rol === 'admin' ? 'Administrador' : 'Reclutador'}${x.activo ? '' : ' · inactivo'}</div></div>
          <span class="badge">${[...S.d.values()].filter((d) => d.ch.asignado_a === x.usuario).length} choferes</span>
          <button class="btn sm" data-editu="${esc(x.usuario)}">Editar</button>
        </div>`).join('')}</div>
    </div>
    <div class="card">
      <h2>Reglas de segmentación</h2>
      <p class="small muted">Un solo segmento por conductor, prioridad A &gt; B &gt; C; fuera de los tres no hay contacto proactivo esa semana. Los umbrales son iniciales y se ajustan tras 4 semanas del primer lote.</p>
      <form id="fum" class="grid">
        <div class="small"><span class="seg A">A</span> <b>${SEGMENTOS.A.nombre}</b>: viajes = 0 en su última semana.</div>
        <div class="small"><span class="seg B">B</span> <b>${SEGMENTOS.B.nombre}</b>: viajes &gt; 0 y (menos de
          <input class="input" type="number" name="b_viajes_max" value="${u.b_viajes_max}" style="width:70px;padding:4px 6px;display:inline-block"> viajes, o TSH ≥
          <input class="input" type="number" name="b_caida_tsh_pct" value="${u.b_caida_tsh_pct}" style="width:60px;padding:4px 6px;display:inline-block">% menor que la semana previa)</div>
        <div class="small"><span class="seg C">C</span> <b>${SEGMENTOS.C.nombre}</b>: más de
          <input class="input" type="number" name="c_viajes_min" value="${u.c_viajes_min}" style="width:70px;padding:4px 6px;display:inline-block"> viajes.</div>
        <div class="actions" style="margin-top:4px"><button class="btn primary">Guardar umbrales</button></div>
      </form>
    </div>
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="card-h"><h2 style="flex:1">Anexo D · Aviso de Privacidad</h2>
      <label class="btn sm primary">${icon('upload')} ${S.data.ajustes?.anexo_d ? 'Reemplazar archivo' : 'Subir archivo'}<input type="file" id="anexo" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" hidden></label></div>
    ${S.data.ajustes?.anexo_d
      ? `<div class="row"><span class="badge b-ok">${icon('check')} Cargado</span><a href="${esc(S.data.ajustes.anexo_d.url)}" target="_blank" rel="noopener">${esc(S.data.ajustes.anexo_d.nombre)}</a>
         <span class="small muted">· ${esc(S.data.ajustes.anexo_d.por || '')} · ${fmtFecha(S.data.ajustes.anexo_d.fecha)}</span></div>
         <p class="small muted" style="margin:8px 0 0">La plantilla de bienvenida incluye la liga con <code>{liga_anexo_d}</code>: el chofer lo abre con un clic, ya no hay que adjuntarlo.</p>`
      : '<p class="small muted" style="margin:0">Sube el Anexo D (de preferencia en PDF, máx. 4 MB). Se publica con una liga que se pone sola en el mensaje de bienvenida.</p>'}
  </div>
  <div class="card">
    <div class="card-h"><h2 style="flex:1">Plantillas de WhatsApp</h2><button class="btn sm primary" id="nuevaP">+ Nueva plantilla</button></div>
    <div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>Nombre</th><th>Categoría</th><th>Vista previa</th><th>Actualizada</th></tr></thead><tbody>
    ${S.data.plantillas.map((p) => `<tr data-editp="${esc(p.id)}"><td><b>${esc(p.nombre)}</b></td><td><span class="badge">${esc(CATEGORIAS.find(([k]) => k === p.categoria)?.[1] || p.categoria)}</span></td>
      <td class="small muted" style="max-width:420px">${esc(p.texto.slice(0, 120))}…</td><td class="small muted nowrap">${fmtFecha(p.actualizado_en)}</td></tr>`).join('')}
    </tbody></table></div>
  </div>`;

  el.querySelector('#nuevoU').onclick = () => editarUsuario(null);
  el.querySelector('#anexo').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast('El archivo debe pesar menos de 4 MB', { tipo: 'err' });
    if (/\.docx?$/i.test(file.name)) toast('Tip: en PDF se abre directo en el celular; Word obliga a descargarlo.', { ms: 6000 });
    try {
      const buf = new Uint8Array(await file.arrayBuffer()); let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await api('/anexo', { method: 'POST', body: { nombre: file.name, base64: btoa(bin) } });
      toast('Anexo D publicado'); await recargar();
    } catch (err) { toast(err.message, { tipo: 'err' }); }
  };
  el.querySelectorAll('[data-editu]').forEach((b) => (b.onclick = () => editarUsuario(S.data.usuarios.find((x) => x.usuario === b.dataset.editu))));
  el.querySelector('#nuevaP').onclick = () => editarPlantilla(null);
  el.querySelectorAll('[data-editp]').forEach((r) => (r.onclick = () => editarPlantilla(S.data.plantillas.find((p) => p.id === r.dataset.editp))));
  el.querySelector('#fum').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/umbrales', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Umbrales guardados; segmentos recalculados'); await recargar(); }
    catch (err) { toast(err.message, { tipo: 'err' }); }
  };
}

function editarUsuario(u) {
  const nuevo = !u;
  const m = modal(`<h2>${nuevo ? 'Agregar persona' : `Editar ${esc(u.nombre)}`}</h2>
    <form id="fu" class="grid">
      <label class="field">Nombre (aparece en los mensajes como {mi_nombre})<input class="input" name="nombre" required value="${esc(u?.nombre || '')}"></label>
      <label class="field">Usuario para entrar<input class="input" name="usuario" required ${nuevo ? '' : 'disabled'} value="${esc(u?.usuario || '')}" autocapitalize="none" pattern="[a-zA-Z0-9._-]{3,30}"></label>
      <label class="field">Teléfono (opcional)<input class="input" name="telefono" value="${esc(u?.telefono || '')}"></label>
      <label class="field">Rol<select class="input" name="rol"><option value="reclutador" ${u?.rol !== 'admin' ? 'selected' : ''}>Reclutador · ve todo, registra contactos, se asigna choferes libres</option><option value="admin" ${u?.rol === 'admin' ? 'selected' : ''}>Administrador · además importa, asigna/reparte y administra</option></select></label>
      <label class="field">${nuevo ? 'Contraseña inicial' : 'Nueva contraseña (déjala vacía para no cambiarla)'}<input class="input" name="password" type="text" minlength="8" ${nuevo ? 'required' : ''} autocomplete="new-password" placeholder="mínimo 8 caracteres"></label>
      ${nuevo ? '' : `<label class="row"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--brand)"> Usuario activo (si lo desactivas ya no podrá entrar)</label>`}
      <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
    </form>`);
  m.el.querySelector('#fu').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try {
      if (nuevo) await api('/usuarios', { method: 'POST', body: f });
      else {
        const body = { nombre: f.nombre, telefono: f.telefono, rol: f.rol, activo: !!f.activo };
        if (f.password) body.password = f.password;
        await api(`/usuarios/${encodeURIComponent(u.usuario)}`, { method: 'PATCH', body });
      }
      toast(nuevo ? 'Persona agregada. Compártele su usuario y contraseña.' : 'Cambios guardados'); m.close(); await recargar();
    } catch (err) { toast(err.message, { tipo: 'err' }); }
  };
}

function editarPlantilla(p) {
  const ejemplo = [...S.d.values()].find((d) => d.m0) || [...S.d.values()][0];
  const vars = ejemplo ? variables(ejemplo, S.yo, S.data.ajustes) : Object.fromEntries(VARIABLES_DISPONIBLES.map((k) => [k, `{${k}}`]));
  const m = modal(`<h2>${p ? 'Editar plantilla' : 'Nueva plantilla'}</h2>
    <form id="fp" class="grid">
      <div class="grid" style="grid-template-columns:2fr 1fr">
        <label class="field">Nombre<input class="input" name="nombre" required value="${esc(p?.nombre || '')}"></label>
        <label class="field">Categoría<select class="input" name="categoria">${CATEGORIAS.map(([k, l]) => `<option value="${k}" ${p?.categoria === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="small muted">Variables (clic para insertar): <div class="chips" style="margin-top:4px">${VARIABLES_DISPONIBLES.map((v) => `<span class="chip" data-var="${v}">{${v}}</span>`).join('')}</div></div>
      <div class="grid" style="grid-template-columns:1fr 1fr" id="pgrid">
        <label class="field">Texto<textarea class="input" name="texto" id="ptxt" rows="14" required>${esc(p?.texto || '')}</textarea></label>
        <div class="field">Vista previa${ejemplo ? ` (con ${esc(ejemplo.ch.nombre?.split(' ')[0] || '')})` : ''}<div class="tpl-preview" id="pprev"></div></div>
      </div>
      <input type="hidden" name="orden" value="${p?.orden ?? 50}">
      <div class="actions">${p ? '<button type="button" class="btn danger" id="pdel" style="margin-right:auto">Eliminar</button>' : ''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
    </form>`, { wide: true });
  if (matchMedia('(max-width: 820px)').matches) m.el.querySelector('#pgrid').style.gridTemplateColumns = '1fr';
  const ta = m.el.querySelector('#ptxt'); const pv = m.el.querySelector('#pprev');
  const upd = () => (pv.textContent = llenar(ta.value, vars)); ta.oninput = upd; upd();
  m.el.querySelectorAll('[data-var]').forEach((c) => (c.onclick = () => {
    const t = `{${c.dataset.var}}`; const s = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd ?? s); ta.focus(); ta.selectionStart = ta.selectionEnd = s + t.length; upd();
  }));
  m.el.querySelector('#pdel')?.addEventListener('click', async () => {
    if (!(await confirmar(`Eliminar la plantilla “${p.nombre}”?`, { ok: 'Eliminar', peligro: true }))) return;
    try { await api(`/plantillas/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('Plantilla eliminada'); m.close(); await recargar(); }
    catch (err) { toast(err.message, { tipo: 'err' }); }
  });
  m.el.querySelector('#fp').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try {
      await api(p ? `/plantillas/${encodeURIComponent(p.id)}` : '/plantillas', { method: p ? 'PUT' : 'POST', body: f });
      toast('Plantilla guardada'); m.close(); await recargar();
    } catch (err) { toast(err.message, { tipo: 'err' }); }
  };
}
