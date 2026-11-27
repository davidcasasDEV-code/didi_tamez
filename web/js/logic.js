// Reglas de negocio: segmentos A/B/C, comparativa de 3 semanas, documentos pendientes, plantillas y plan del día.
import { primerNombre, titulo, fmtNum, fmtMoney } from './util.js';

export const DOC_LABEL = { ine: 'INE', licencia: 'Licencia de conducir', tarjeta: 'Tarjeta de circulación', foto: 'Foto de perfil' };
const DOC_MALO = /sin subir|rechaz|expirad/i;

export const ESTATUS_CONTACTO = {
  pendiente: { label: 'Pendiente', cls: '' },
  contactado: { label: 'Contactado', cls: 'b-brand' },
  respondio: { label: 'Respondió', cls: 'b-ok' },
  se_queda: { label: 'Se queda', cls: 'b-ok' },
  sin_respuesta: { label: 'Sin respuesta', cls: 'b-warn' },
  visita_agendada: { label: 'Visita agendada', cls: 'b-ok' },
  no_interesado: { label: 'No interesado', cls: 'b-bad' },
  opt_out: { label: 'Opt-out (no contactar)', cls: 'b-bad' },
};
export const SEGMENTOS = {
  A: { nombre: 'Sin viajes', metrica: 'Retención', plan: 'Lun mensaje · Mar llamada · Jue seguimiento' },
  B: { nombre: 'Horas a la baja', metrica: 'TSH total / por conductor', plan: 'Mar recomendación de horarios y zonas · Jue seguimiento' },
  C: { nombre: 'Alto potencial', metrica: 'TSH por conductor', plan: 'Mié impulsar a que complete' },
};

// ---------- semanas ISO
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}
export const semanaKey = (year, week) => `${year}-W${String(week).padStart(2, '0')}`;
export const semanaLabel = (k) => (k ? `Sem ${Number(String(k).split('-W')[1])}` : '—');
/** "Sem 48 (en curso, datos al 26 nov)" si DiDi mandó la semana incompleta. */
export function semanaLabelInfo(k, info = {}) {
  const i = info[k];
  if (!i?.parcial) return semanaLabel(k);
  const f = new Date(i.hasta + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  return `${semanaLabel(k)} (en curso, datos al ${f})`;
}
export function inicioSemana(d = new Date()) {
  const x = new Date(d); const day = x.getDay() || 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day + 1); return x;
}

export function docsPendientes(ch) {
  const d = ch.docs || {};
  return Object.keys(DOC_LABEL).filter((k) => d[k] && DOC_MALO.test(d[k])).map((k) => ({ k, label: DOC_LABEL[k], estado: d[k] }));
}

/**
 * Parte de Reclutamiento de una persona vista desde un reclutador (o desde todo el equipo si u = '').
 * Devuelve { esperando, conduciendo, sinCarro } — puede estar en varias a la vez si viene en varias pestañas.
 */
export function partesRecluta(d, u = '') {
  const ch = d.ch; const listas = ch.listas || {};
  const hojas = u ? listas[u] || [] : Object.values(listas).flat();
  if (hojas.length) {
    return {
      esperando: hojas.some((h) => !/conduc/i.test(h)),
      conduciendo: hojas.some((h) => /conduc/i.test(h)),
      sinCarro: hojas.some((h) => /sin carro/i.test(h)),
      estatusHoja: hojas.some((h) => /esperando/i.test(h)),
    };
  }
  // Sin lista de Excel: altas manuales (por su reclutador) o registros de DiDi sin reclutador
  if (u && ch.reclutado_por !== u) return { esperando: false, conduciendo: false, sinCarro: false, estatusHoja: false };
  if (u && Object.keys(listas).length === 0 && ch.reclutado_por === u) {
    return { esperando: d.cats.has('rec_esperando'), conduciendo: d.cats.has('rec_conduciendo'), sinCarro: false, estatusHoja: false };
  }
  return { esperando: d.cats.has('rec_esperando'), conduciendo: d.cats.has('rec_conduciendo'), sinCarro: /sin carro/i.test(ch.hoja_equipo || ''), estatusHoja: false };
}
const enEquipo = (d) => !!d.ch.reclutado_por || Object.keys(d.ch.listas || {}).length > 0;
export { enEquipo };

/** Calcula, para cada chofer, sus métricas por semana, tendencia, segmento y categorías. */
export function derivar(data) {
  const u = data.umbrales; const lunes = inicioSemana().toISOString();
  const out = new Map();
  for (const ch of data.choferes) {
    ch.cel = ch.celular || ch.celular_alt || '';
    const m = data.metricas[ch.id] || {};
    const semanas = Object.keys(m).sort().reverse();
    const [s0, s1, s2] = semanas;
    const m0 = s0 ? m[s0] : null, m1 = s1 ? m[s1] : null, m2 = s2 ? m[s2] : null;
    const fuentes = new Set(ch.fuentes || []);
    const est = ch.estatus_didi || '';
    const bloqueado = /bloquead|bgc no aprob|curp erron/i.test(est);

    // Segmento (prioridad A > B > C). Solo para choferes en operación (lista de asignados o productividad).
    let seg = null;
    if (m0 && m0.fuente === 'asignados' && !bloqueado) {
      const v = +m0.viajes || 0; const t0 = +m0.tsh || 0; const t1 = m1 ? +m1.tsh || 0 : 0;
      if (v === 0) seg = 'A';
      else if (v < u.b_viajes_max || (t1 > 0 && t0 <= t1 * (1 - u.b_caida_tsh_pct / 100))) seg = 'B';
      else if (v > u.c_viajes_min) seg = 'C';
    }
    const prev = [m1, m2].filter(Boolean);
    const prom = (k) => (prev.length ? prev.reduce((a, x) => a + (+x[k] || 0), 0) / prev.length : null);
    const tend = (k) => { const p = prom(k); if (!m0 || p == null) return null; if (p === 0) return (+m0[k] || 0) > 0 ? 1 : null; return ((+m0[k] || 0) - p) / p; };
    const caidaTsh = m0 && m1 && +m1.tsh > 0 ? ((+m0.tsh || 0) - m1.tsh) / m1.tsh : null;

    const docs = docsPendientes(ch);
    const cats = new Set();
    if (seg) cats.add('prioridad');
    if (fuentes.has('conversion') && !/primer viaje/i.test(est) && !bloqueado) cats.add('registro');
    if (docs.length && !bloqueado) cats.add('documentos');
    if (fuentes.has('recuperacion') && /comeback/i.test(est)) cats.add('recuperacion');
    // Dos universos: los que ya conducen (Asignaciones) y los reclutas en proceso (Reclutamiento)
    // Asignaciones = solo la lista de conductores asignados que manda DiDi (los 300)
    if (fuentes.has('asignados')) cats.add('asignacion');
    // Reclutas: en registro (Conversión), dados de alta por el equipo, o nuevos conductores (Productividad de DiDi)
    // Reclutamiento = todo lo que no es la lista de 300: registro (Conversión), nuevos (Productividad), recuperados y altas del equipo
    if (!fuentes.has('asignados') || ch.reclutado_por) cats.add('recluta');
    // "Conduciendo" de un recluta lo define el equipo (pestaña "conduciendo" de su Excel o botón en el detalle).
    // Si DiDi ya lo reporta activo pero el equipo aún no lo mueve, se avisa en Esperando → "Ya conduce según DiDi".
    const conduceDidi = !!(ch.activado_semana || /conductor activo|comeback driver|primer viaje/i.test(est));
    // Listas del equipo: { usuario: [pestañas de su Excel donde viene esta persona] }
    const listas = {};
    for (const k of Object.keys(ch)) if (k.startsWith('lista_') && Array.isArray(ch[k]) && ch[k].length) listas[k.slice(6)] = ch[k];
    ch.listas = listas;
    const hayListas = Object.keys(listas).length > 0;
    if (hayListas) cats.add('recluta');
    let conduce;
    if (hayListas) {
      // Con listas, la pestaña manda: puede estar en Esperando para uno y en Conduciendo para otro.
      const todas = Object.values(listas).flat();
      if (todas.some((h) => /conduc/i.test(h))) cats.add('rec_conduciendo');
      if (todas.some((h) => !/conduc/i.test(h))) cats.add('rec_esperando');
      conduce = cats.has('rec_conduciendo') && !cats.has('rec_esperando');
    } else {
      conduce = ch.reclutado_por ? ch.conduciendo_manual === true : (ch.conduciendo_manual === true || conduceDidi);
      cats.add(conduce ? 'rec_conduciendo' : 'rec_esperando');
    }
    if (cats.has('rec_esperando') && !cats.has('rec_conduciendo') && conduceDidi) cats.add('didi_activo');
    if (fuentes.has('recuperacion') || ch.recuperado) cats.add('recuperado');
    if (ch.activado_semana) cats.add('activado');

    const contactadoSemana = !!(ch.ultimo_contacto?.fecha && ch.ultimo_contacto.fecha >= lunes);
    out.set(ch.id, {
      ch, semanas, s0, s1, s2, m0, m1, m2, seg, docs, cats, bloqueado, contactadoSemana,
      trend: { viajes: tend('viajes'), ingreso: tend('ingreso'), tsh: tend('tsh') }, caidaTsh,
      viajesProm: prom('viajes'),
    });
  }
  return out;
}

// ---------- plantillas
export function variables(d, yo, ajustes = {}) {
  const ch = d.ch;
  const v0 = d.m0 ? fmtNum(d.m0.viajes) : null; const v1 = d.m1 ? fmtNum(d.m1.viajes) : null;
  const comparativa = v0 == null ? 'Aún no tenemos tus viajes de la semana.'
    : v1 == null ? `La semana pasada hiciste ${v0} viajes.`
    : `La semana anterior hiciste ${v1} viajes y la última semana ${v0}.`;
  const docs = d.docs.length ? d.docs.map((x) => `• ${x.label} (${x.estado.toLowerCase()})`).join('\n') : '• Revisa tus documentos en la app';
  return {
    nombre: primerNombre(ch.nombre) || 'conductor',
    nombre_completo: titulo(ch.nombre || ''),
    mi_nombre: yo?.nombre || '',
    viajes: d.m0 ? fmtNum(d.m0.viajes) : '0',
    viajes_prev: d.m1 ? fmtNum(d.m1.viajes) : '—',
    horas: d.m0 ? fmtNum(d.m0.tsh, 1) : '0',
    ingreso: d.m0 ? fmtMoney(d.m0.ingreso) : '$0',
    docs_pendientes: docs,
    promocion: ch.promocion && ch.promocion !== 'null' ? ch.promocion.replace(/\{\{[^}]+\}\}/g, '').trim() : 'consulta las promociones activas en tu app',
    ciudad: ch.ciudad || '',
    estatus_didi: ch.estatus_didi || '',
    comparativa,
    liga_anexo_d: ajustes.anexo_d?.url || '(liga del Anexo D pendiente: súbelo en Administración)',
    liga_salida: ajustes.liga_salida || 'https://d.didiglobal.com/salir',
  };
}
export const VARIABLES_DISPONIBLES = ['nombre', 'nombre_completo', 'mi_nombre', 'viajes', 'viajes_prev', 'horas', 'ingreso', 'docs_pendientes', 'promocion', 'ciudad', 'estatus_didi', 'comparativa', 'liga_anexo_d', 'liga_salida'];
export const llenar = (texto, vars) => String(texto).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Plantilla sugerida según la situación del chofer. */
export function sugerida(d, plantillas) {
  const by = (cat) => plantillas.find((p) => p.categoria === cat);
  // La bienvenida + Anexo D se manda una sola vez por chofer
  if (!d.ch.bienvenida_enviada) return by('bienvenida') || plantillas[0];
  if (d.cats.has('recluta') && !d.cats.has('asignacion') && d.docs.length) return by('documentos') || plantillas[0];
  if (d.seg) return by(d.seg) || plantillas[0];
  if (d.cats.has('documentos')) return by('documentos') || plantillas[0];
  if (d.cats.has('recuperacion')) return by('recuperacion') || plantillas[0];
  return by('seguimiento') || plantillas[0];
}

/** Qué toca hoy según el plan semanal del slide 5.1. */
export function planDelDia(fecha = new Date()) {
  const dia = fecha.getDay(); // 0 dom … 6 sáb
  const P = {
    1: [{ seg: 'A', accion: 'Enviar mensaje de seguimiento por WhatsApp y preguntar el motivo', plantilla: 'A' }],
    2: [{ seg: 'A', accion: 'Llamar a los A sin respuesta del lunes (2º contacto)', plantilla: 'A' },
        { seg: 'B', accion: 'Recomendación de horarios y zonas', plantilla: 'B' }],
    3: [{ seg: 'C', accion: 'Impulsar a que completen su recompensa / nivel Élite', plantilla: 'C' }],
    4: [{ seg: 'A', accion: 'Seguimiento', plantilla: 'seguimiento' }, { seg: 'B', accion: '¿Sirvió la recomendación? Seguimiento', plantilla: 'seguimiento' }],
    5: [{ seg: null, accion: 'Cerrar pendientes y exportar el resumen semanal para DiDi', plantilla: null }],
  };
  return P[dia] || [{ seg: null, accion: 'Fin de semana: revisa documentación pendiente y recuperación', plantilla: null }];
}
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
