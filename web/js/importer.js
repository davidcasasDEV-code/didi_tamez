// Lectura de los Excel de DiDi en el navegador y normalización a un formato común.
import { cargarXLSX, normalizaCel } from './util.js';
import { isoWeek, semanaKey } from './logic.js';

const vacio = (v) => v == null || v === '' || String(v).trim().toLowerCase() === 'null';
const txt = (v) => (vacio(v) ? undefined : String(v).trim());
const num = (v) => { if (vacio(v)) return 0; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
function fecha(v) {
  if (vacio(v)) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}
const cel = (v) => (vacio(v) ? undefined : normalizaCel(String(v).replace(/^'/, '')));
const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Busca la fila de encabezados (la que contiene "id conductor"/"id_conductor") y devuelve objetos por fila. */
function tabla(XLSX, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  const hi = rows.findIndex((r, i) => i < 10 && r.some((c) => /^id[ _]conductor$/.test(norm(c))));
  if (hi < 0) return null;
  const h = rows[hi].map(norm);
  const data = rows.slice(hi + 1).filter((r) => String(r[h.findIndex((x) => /^id[ _]conductor$/.test(x))] ?? '').trim());
  return { headers: h, rows: data.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))) };
}

const DETECTORES = [
  { tipo: 'asignados', test: (h) => h.includes('semana_evaluacion') || h.includes('viajes_totales_semana') },
  { tipo: 'conversion', test: (h) => h.includes('status ine') || h.includes('bgc') },
  { tipo: 'productividad', test: (h) => h.includes('promocion activa') },
  { tipo: 'recuperacion', test: (h) => h.includes('status del driver') || h.includes('last_trip_before_cb') },
];
export const TIPO_LABEL = {
  asignados: 'Lista de conductores asignados (segmentos)',
  conversion: 'Conversión · registro y documentos',
  productividad: 'Productividad · nuevos conductores',
  recuperacion: 'Recuperación de conductores',
  general: 'KPIs generales de DiDi',
};

const MAPEOS = {
  asignados: (r) => {
    const notas = ['contactado o no?', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes']
      .map((k) => [k, txt(r[k])]).filter(([, v]) => v).map(([k, v]) => `${k === 'contactado o no?' ? 'Contactado' : k[0].toUpperCase() + k.slice(1)}: ${v}`);
    return {
      id: txt(r.id_conductor), nombre: txt(r.nombre), curp: txt(r.curp), celular: cel(r.celular), ciudad: txt(r.primer_ciudad),
      fecha_primer_viaje: fecha(r.fecha_primer_viaje), fecha_ultimo_viaje: fecha(r.fecha_ultimo_viaje),
      semanas_desde_dft: vacio(r.semanas_desde_dft) ? undefined : num(r.semanas_desde_dft),
      segmento_didi: txt(r.segmento)?.trim()[0]?.toUpperCase(),
      metricas: {
        viajes: num(r.viajes_totales_semana), tsh: num(r.tiempo_conexion_horas_semana), ingreso: num(r.ingreso_por_viajes),
        iph: num(r.iph), ipoh: num(r.ipoh), subsidy: num(r.subsidy_b),
      },
      notas_excel: notas.length ? notas.join('\n') : undefined,
    };
  },
  conversion: (r) => ({
    id: txt(r['id conductor']), nombre: txt(r.nombre), curp: txt(r.curp), celular: cel(r.celular),
    rol_vehiculo: txt(r.rol), estatus_didi: txt(r.estatus), fecha_primer_viaje: fecha(r['fecha del primer viaje']),
    ciudad: txt(r['ciudad de registro']), ciudad_primer_viaje: txt(r['ciudad del primer viaje']),
    docs: {
      ine: txt(r['status ine']) || '', licencia: txt(r['status licencia']) || '', tarjeta: txt(r['status tarjeta de circ.']) || '',
      foto: txt(r['foto de perfil']) || '', bgc: txt(r.bgc) || '',
    },
    comentario_didi: txt(r.comentario),
  }),
  productividad: (r) => ({
    id: txt(r['id conductor']), nombre: txt(r.nombre), curp: txt(r.curp), celular: cel(r.celular),
    ciudad: txt(r['ciudad de registro']), ciudad_primer_viaje: txt(r['ciudad del primer viaje']),
    fecha_ultimo_viaje: fecha(r['fecha de ultimo viaje']), fecha_primer_viaje: fecha(r['fecha del primer viaje']),
    promocion: txt(r['promocion activa']), estatus_didi: txt(r['estatus conductor']),
    metricas: { viajes: num(r['viajes totales de la semana']), tsh: num(r['tiempo de conexion']), ingreso: num(r['ingreso por viajes']) },
  }),
  recuperacion: (r) => ({
    id: txt(r['id conductor']), nombre: txt(r.nombre), curp: txt(r.curp), celular: cel(r.celular),
    ciudad: txt(r['ciudad de registro']), fecha_ultimo_viaje: fecha(r['fecha de ultimo viaje']),
    fecha_primer_viaje: fecha(r['fecha del primer viaje']), promocion: txt(r['recompensa activa']),
    estatus_didi: txt(r['status del driver']), ultimo_viaje_antes_cb: typeof r.last_trip_before_cb === 'number' ? fecha(r.last_trip_before_cb) : txt(r.last_trip_before_cb),
    metricas: { viajes: num(r['viajes totales de la semana']), tsh: num(r['tiempo de conexion']), ingreso: num(r['ingreso por viajes']) },
  }),
};

function semanaDeFechas(fechas) {
  const ds = fechas.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '')).sort();
  if (!ds.length) return null;
  const d = new Date(ds[ds.length - 1] + 'T12:00:00'); return isoWeek(d);
}

/** Lee un archivo y devuelve los conjuntos detectados con su semana sugerida. */
export async function leerArchivo(file) {
  const XLSX = await cargarXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const conjuntos = [];
  const mFile = file.name.match(/W\s*\[?\s*(\d{1,2})\s*\]?/i);
  const hoy = isoWeek();
  for (const nombre of wb.SheetNames) {
    if (/^ejemplo/i.test(nombre.trim())) continue;
    const ws = wb.Sheets[nombre];
    if (/^general$/i.test(nombre.trim())) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).filter((r) => r.some((c) => c !== ''));
      const kpis = rows.filter((r) => typeof r[1] === 'number' || typeof r[4] === 'number').filter((r) => String(r[0]).trim())
        .map((r) => ({ indicador: String(r[0]).trim(), actual: r[1] === '' ? null : +r[1], target: r[2] === '' ? null : +r[2], cumplimiento: r[3] === '' ? null : +r[3], peso: r[4] === '' ? null : +r[4] }));
      if (kpis.length) conjuntos.push({ tipo: 'general', hoja: nombre, filas: kpis, total: kpis.length });
      continue;
    }
    const t = tabla(XLSX, ws); if (!t) continue;
    const det = DETECTORES.find((d) => d.test(t.headers)); if (!det) continue;
    // Prospectos sin ID de DiDi (aún en registro): se identifican por CURP.
    const filas = t.rows.map(MAPEOS[det.tipo])
      .map((r) => (r.id || !r.curp ? r : { ...r, id: `CURP-${r.curp.toUpperCase()}` }))
      .filter((r) => r.id);
    conjuntos.push({ tipo: det.tipo, hoja: nombre, filas, total: filas.length, headers: t.headers, raw: t.rows });
  }
  // Semana sugerida: semana_evaluacion (asignados) > "W[47]" en el nombre del archivo > fecha más reciente de último viaje.
  for (const c of conjuntos) {
    let week = null; let year = hoy.year;
    if (c.tipo === 'asignados') {
      const ws = c.raw.map((r) => +r.semana_evaluacion).filter(Boolean);
      if (ws.length) week = Math.max(...ws);
    }
    if (!week && mFile) week = +mFile[1];
    if (!week) { const w = semanaDeFechas(conjuntos.flatMap((x) => (x.filas || []).map((f) => f.fecha_ultimo_viaje))); if (w) ({ week, year } = w); }
    if (!week) week = hoy.week - 1;
    if (week > hoy.week + 1) year -= 1; // p. ej. semana 52 importada en enero
    c.semana = semanaKey(year, week);
    delete c.raw;
  }
  return conjuntos;
}
