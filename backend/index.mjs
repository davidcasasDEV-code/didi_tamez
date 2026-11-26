// DIDI_Choferes_Tamez_API — Lambda única (Node.js 22, sin dependencias externas).
// Se expone por Function URL y CloudFront la publica bajo /api/*.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
  ScanCommand, QueryCommand, BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import { DEFAULT_PLANTILLAS, DEFAULT_UMBRALES } from './defaults.mjs';

const BUCKET = process.env.BUCKET;           // bucket del portal (documentos como el Anexo D van en docs/)
const PORTAL_URL = process.env.PORTAL_URL;   // https://xxxx.cloudfront.net
const s3 = new S3Client({});

const P = 'DIDI_Choferes_Tamez_';
const T = {
  usuarios: P + 'Usuarios',
  choferes: P + 'Choferes',
  semanas: P + 'Semanas',
  seguimiento: P + 'Seguimiento',
  plantillas: P + 'Plantillas',
  config: P + 'Config',
};
const SEMANAS_A_CONSERVAR = 3;
const TOKEN_HORAS = 12;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

// ---------------------------------------------------------------- utilidades
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const nowIso = () => new Date().toISOString();
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Set ? [...v] : v)));

async function scanAll(TableName, extra = {}) {
  const out = []; let ExclusiveStartKey;
  do {
    const r = await db.send(new ScanCommand({ TableName, ExclusiveStartKey, ...extra }));
    out.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}
async function queryAll(params) {
  const out = []; let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    out.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}
async function batchWrite(TableName, requests) {
  for (let i = 0; i < requests.length; i += 25) {
    let items = requests.slice(i, i + 25); let intentos = 0;
    while (items.length && intentos < 8) {
      const r = await db.send(new BatchWriteCommand({ RequestItems: { [TableName]: items } }));
      items = r.UnprocessedItems?.[TableName] || [];
      if (items.length) await new Promise((res) => setTimeout(res, 50 * 2 ** intentos++));
    }
  }
}
async function enParalelo(lista, n, fn) {
  const res = new Array(lista.length); let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (idx < lista.length) { const i = idx++; res[i] = await fn(lista[i], i); }
  }));
  return res;
}
async function getConfig(clave) {
  const r = await db.send(new GetCommand({ TableName: T.config, Key: { clave } }));
  return r.Item?.valor;
}
const putConfig = (clave, valor) => db.send(new PutCommand({ TableName: T.config, Item: { clave, valor } }));
async function bumpVersion() {
  await db.send(new UpdateCommand({
    TableName: T.config, Key: { clave: 'version' },
    UpdateExpression: 'SET valor = if_not_exists(valor, :z) + :uno',
    ExpressionAttributeValues: { ':z': 0, ':uno': 1 },
  }));
}

// ---------------------------------------------------------------- seguridad
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, h] = String(stored || '').split(':'); if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'); const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
let secretCache;
async function jwtSecret() {
  if (secretCache) return secretCache;
  let s = await getConfig('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(48).toString('hex');
    try {
      await db.send(new PutCommand({
        TableName: T.config, Item: { clave: 'jwt_secret', valor: s },
        ConditionExpression: 'attribute_not_exists(clave)',
      }));
    } catch { s = await getConfig('jwt_secret'); }
  }
  return (secretCache = s);
}
const b64u = (b) => Buffer.from(b).toString('base64url');
async function signToken(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_HORAS * 3600 }));
  const s = crypto.createHmac('sha256', await jwtSecret()).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
async function verifyToken(tok) {
  const [h, p, s] = String(tok || '').split('.'); if (!s) return null;
  const exp = crypto.createHmac('sha256', await jwtSecret()).update(`${h}.${p}`).digest('base64url');
  if (exp.length !== s.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(s))) return null;
  const data = JSON.parse(Buffer.from(p, 'base64url').toString());
  return data.exp > Date.now() / 1000 ? data : null;
}
const publicUser = (u) => ({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, telefono: u.telefono || '', activo: u.activo !== false });

async function auth(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const data = await verifyToken(raw.replace(/^Bearer\s+/i, ''));
  if (!data) throw new HttpError(401, 'Sesión expirada, vuelve a iniciar sesión');
  const r = await db.send(new GetCommand({ TableName: T.usuarios, Key: { usuario: data.sub } }));
  if (!r.Item || r.Item.activo === false) throw new HttpError(401, 'Usuario inactivo');
  return r.Item;
}
const soloAdmin = (u) => { if (u.rol !== 'admin') throw new HttpError(403, 'Solo un administrador puede hacer esto'); };

// ---------------------------------------------------------------- semillas
async function asegurarPlantillas() {
  const r = await db.send(new ScanCommand({ TableName: T.plantillas, Limit: 1 }));
  if (r.Count) return;
  await batchWrite(T.plantillas, DEFAULT_PLANTILLAS.map((p) => ({ PutRequest: { Item: { ...p, actualizado_en: nowIso() } } })));
}

// ---------------------------------------------------------------- feed de actividad
async function registrarEvento({ id = '_SISTEMA', usuario, tipo, resultado = '', nota = '', plantilla = '', extra }) {
  const ts = nowIso();
  const item = {
    id, ts: `${ts}#${crypto.randomBytes(3).toString('hex')}`, fecha: ts, gpk: 'F',
    usuario: usuario.usuario, usuario_nombre: usuario.nombre, tipo, resultado, nota, plantilla, extra,
  };
  await db.send(new PutCommand({ TableName: T.seguimiento, Item: item }));
  return item;
}

// ---------------------------------------------------------------- import
const MERGE_CAMPOS = [
  'nombre', 'curp', 'celular', 'ciudad', 'estatus_didi', 'rol_vehiculo', 'docs', 'comentario_didi',
  'fecha_primer_viaje', 'fecha_ultimo_viaje', 'semanas_desde_dft', 'promocion', 'segmento_didi',
  'ciudad_primer_viaje', 'ultimo_viaje_antes_cb', 'orden_lista',
];
const esPlaceholder = (id) => /^(CURP|TEL)-/.test(id);
/** "2026-11-18" → "2026-W47" (semana ISO). */
function semanaIso(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fecha || '')) return null;
  const t = new Date(`${String(fecha).slice(0, 10)}T12:00:00Z`); const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
const soloDigitos = (v) => String(v || '').replace(/\D/g, '').slice(-10);

/**
 * Reclutas dados de alta a mano (o prospectos sin ID de DiDi) viven con id CURP-xxx / TEL-xxx.
 * Cuando DiDi los manda ya con su ID, se fusionan: el registro nuevo hereda quién lo reclutó, notas,
 * asignación e historial, y se borra el provisional.
 */
async function fusionarProvisionales(rows) {
  const prov = await scanAll(T.choferes, {
    FilterExpression: 'begins_with(id, :c) OR begins_with(id, :t)',
    ExpressionAttributeValues: { ':c': 'CURP-', ':t': 'TEL-' },
  });
  if (!prov.length) return 0;
  const porCurp = new Map(); const porCel = new Map();
  for (const p of prov) {
    if (p.curp) porCurp.set(String(p.curp).toUpperCase(), p);
    for (const c of [p.celular, p.celular_alt]) if (soloDigitos(c).length === 10) porCel.set(soloDigitos(c), p);
  }
  let fusionados = 0;
  for (const r of rows) {
    const id = String(r.id || ''); if (!id || esPlaceholder(id)) continue;
    const p = (r.curp && porCurp.get(String(r.curp).toUpperCase())) || (soloDigitos(r.celular).length === 10 && porCel.get(soloDigitos(r.celular)));
    if (!p || p.id === id) continue;
    const heredar = {};
    for (const k of ['reclutado_por', 'reclutado_en', 'notas', 'celular_alt', 'asignado_a', 'asignado_por', 'asignado_en',
      'estatus_contacto', 'ultimo_contacto', 'contactos', 'bienvenida_enviada', 'creado_en']) if (p[k] !== undefined && p[k] !== null) heredar[k] = p[k];
    const sets = Object.keys(heredar).map((k) => `${k} = if_not_exists(${k}, :${k})`);
    if (sets.length) {
      await db.send(new UpdateCommand({
        TableName: T.choferes, Key: { id }, UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeValues: Object.fromEntries(Object.entries(heredar).map(([k, v]) => [`:${k}`, v])),
      }));
    }
    // mover historial
    const evs = await queryAll({ TableName: T.seguimiento, KeyConditionExpression: 'id = :i', ExpressionAttributeValues: { ':i': p.id } });
    await batchWrite(T.seguimiento, evs.map((e) => ({ PutRequest: { Item: { ...e, id } } })));
    await batchWrite(T.seguimiento, evs.map((e) => ({ DeleteRequest: { Key: { id: p.id, ts: e.ts } } })));
    await db.send(new DeleteCommand({ TableName: T.choferes, Key: { id: p.id } }));
    porCurp.delete(String(p.curp || '').toUpperCase()); porCel.delete(soloDigitos(p.celular)); porCel.delete(soloDigitos(p.celular_alt));
    fusionados++;
  }
  return fusionados;
}
async function importarLote(user, body) {
  // Cualquier usuario del equipo puede importar los Excel de DiDi (solo actualizan datos, no reparten).
  const { tipo, semana, rows } = body;
  if (!['asignados', 'conversion', 'productividad', 'recuperacion', 'general'].includes(tipo)) throw new HttpError(400, 'Tipo de archivo no reconocido');
  if (!/^\d{4}-W\d{2}$/.test(semana || '')) throw new HttpError(400, 'Semana inválida (formato 2026-W46)');
  if (!Array.isArray(rows) || rows.length > 500) throw new HttpError(400, 'Lote inválido (máx. 500 filas)');
  const ts = nowIso();

  if (tipo === 'general') {
    await db.send(new PutCommand({ TableName: T.semanas, Item: { semana, id: '_GENERAL', kpis: rows, importado_en: ts } }));
    return { nuevos: 0, actualizados: 0, metricas: 0 };
  }

  let nuevos = 0, actualizados = 0;
  const metricas = [];
  const fusionados = await fusionarProvisionales(rows);
  await enParalelo(rows, 20, async (r) => {
    const id = String(r.id || '').trim(); if (!id) return;
    const sets = ['creado_en = if_not_exists(creado_en, :ts)', 'actualizado_en = :ts',
      'estatus_contacto = if_not_exists(estatus_contacto, :pend)', 'contactos = if_not_exists(contactos, :cero)'];
    const vals = { ':ts': ts, ':pend': 'pendiente', ':cero': 0, ':f': new Set([tipo]) };
    for (const c of MERGE_CAMPOS) {
      if (r[c] !== undefined && r[c] !== null && r[c] !== '') { sets.push(`${c} = :${c}`); vals[`:${c}`] = r[c]; }
    }
    if (r.metricas) { sets.push('ultima_semana = :sem'); vals[':sem'] = semana; }
    // Activación (primer viaje): se guarda la primera semana en que se detecta y no se borra con la depuración.
    const activo = /primer viaje/i.test(r.estatus_didi || '') || (tipo === 'productividad' && +r.metricas?.viajes > 0);
    // La semana de activación es la del primer viaje que reporta DiDi (si viene); si no, la semana del archivo.
    if (activo) {
      sets.push('activado_semana = if_not_exists(activado_semana, :sem2)', 'activado_en = if_not_exists(activado_en, :ts)');
      vals[':sem2'] = semanaIso(r.fecha_primer_viaje) || semana;
    }
    const notas = r.notas_excel ? String(r.notas_excel).slice(0, 2000) : null;
    if (notas) { sets.push('notas_excel = :ne'); vals[':ne'] = notas; }
    if (notas && /anexo d|bienvenida/i.test(notas)) { sets.push('bienvenida_enviada = if_not_exists(bienvenida_enviada, :ts)'); }
    const res = await db.send(new UpdateCommand({
      TableName: T.choferes, Key: { id },
      UpdateExpression: `SET ${sets.join(', ')} ADD fuentes :f`,
      ExpressionAttributeValues: vals, ReturnValues: 'UPDATED_OLD',
    }));
    if (res.Attributes?.creado_en) actualizados++; else nuevos++;
    if (r.metricas) metricas.push({ PutRequest: { Item: { semana, id, fuente: tipo, ...r.metricas, importado_en: ts } } });
    // Las columnas de seguimiento del Excel se registran en el historial solo si son nuevas (reimportar no duplica).
    if (notas && res.Attributes?.notas_excel !== notas) {
      await registrarEvento({ id, usuario: user, tipo: 'nota', resultado: 'Importado de Excel', nota: notas, extra: { nombre: r.nombre } });
    }
  });
  // Si un chofer viene en dos archivos de la misma semana, gana el último en importarse.
  await batchWrite(T.semanas, metricas);
  return { nuevos, actualizados, metricas: metricas.length, fusionados };
}

async function finalizarImport(user, body) {
  const { semana, archivo = '', tipo = '', resumen = {} } = body;
  if (!/^\d{4}-W\d{2}$/.test(semana || '')) throw new HttpError(400, 'Semana inválida');
  // Semanas presentes = particiones en la tabla Semanas (scan proyectado, barato a este volumen).
  const items = await scanAll(T.semanas, { ProjectionExpression: 'semana, id' });
  const semanas = [...new Set(items.map((i) => i.semana))].sort().reverse();
  const conservar = semanas.slice(0, SEMANAS_A_CONSERVAR);
  const borrar = items.filter((i) => !conservar.includes(i.semana));
  await batchWrite(T.semanas, borrar.map((i) => ({ DeleteRequest: { Key: { semana: i.semana, id: i.id } } })));
  const semanasBorradas = [...new Set(borrar.map((i) => i.semana))];

  const hist = (await getConfig('importaciones')) || [];
  hist.unshift({ fecha: nowIso(), usuario: user.nombre, semana, archivo, tipo, resumen, depuradas: semanasBorradas });
  await putConfig('importaciones', hist.slice(0, 30));
  await registrarEvento({
    usuario: user, tipo: 'import',
    resultado: `Importó ${archivo || tipo} (${semana})`,
    nota: `${resumen.nuevos || 0} nuevos · ${resumen.actualizados || 0} actualizados` +
      (semanasBorradas.length ? ` · depuradas: ${semanasBorradas.join(', ')}` : ''),
  });
  await bumpVersion();
  return { semanas: conservar, depuradas: semanasBorradas, registrosBorrados: borrar.length };
}

// ---------------------------------------------------------------- visibilidad
// Un reclutador solo ve, de los choferes que ya conducen, los que tiene asignados.
// La base de Reclutamiento (registro, altas del equipo, nuevos conductores) sí la ve todo el equipo.
const fuentesDe = (c) => new Set(c.fuentes instanceof Set ? c.fuentes : c.fuentes || []);
// Lista de 300 de DiDi (fuente 'asignados') = Asignaciones. Todo lo demás es la base de Reclutamiento, visible para el equipo.
const esRecluta = (c) => !fuentesDe(c).has('asignados') || !!c.reclutado_por;
const puedeVer = (user, c) => user.rol === 'admin' || c.asignado_a === user.usuario || esRecluta(c);
async function choferVisible(user, id) {
  const c = (await db.send(new GetCommand({ TableName: T.choferes, Key: { id } }))).Item;
  if (!c) throw new HttpError(404, 'Chofer no encontrado');
  if (!puedeVer(user, c)) throw new HttpError(403, 'Este chofer está asignado a otra persona');
  return c;
}
async function idsVisibles(user) {
  const todos = await scanAll(T.choferes, { ProjectionExpression: 'id, asignado_a, fuentes, reclutado_por' });
  return new Set(todos.filter((c) => puedeVer(user, c)).map((c) => c.id));
}

// ---------------------------------------------------------------- handlers
async function bootstrap(user) {
  const [usuarios, choferes, semanasItems, plantillas, umbrales, version, importaciones, anexo] = await Promise.all([
    scanAll(T.usuarios), scanAll(T.choferes), scanAll(T.semanas), scanAll(T.plantillas),
    getConfig('umbrales'), getConfig('version'), getConfig('importaciones'), getConfig('anexo_d'),
  ]);
  const visibles = choferes.filter((c) => puedeVer(user, c));
  const ids = new Set(visibles.map((c) => c.id));
  const metricas = {}; const general = {}; const semanas = new Set();
  for (const s of semanasItems) {
    semanas.add(s.semana);
    if (s.id === '_GENERAL') { general[s.semana] = s.kpis; continue; }
    if (!ids.has(s.id)) continue;
    const { semana, id, importado_en, ...m } = s;
    (metricas[id] ||= {})[semana] = m;
  }
  return clean({
    yo: publicUser(user),
    usuarios: usuarios.map(publicUser),
    choferes: visibles,
    semanas: [...semanas].sort().reverse(),
    metricas, general,
    plantillas: plantillas.sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99)),
    umbrales: { ...DEFAULT_UMBRALES, ...(umbrales || {}) },
    importaciones: importaciones || [],
    ajustes: { anexo_d: anexo || null, liga_salida: 'https://d.didiglobal.com/salir' },
    version: version || 0,
  });
}

async function asignar(user, { ids, usuario }) {
  soloAdmin(user); // el reparto lo hace el administrador; un reclutador solo ve lo que tiene asignado
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Selecciona al menos un chofer');
  if (ids.length > 2000) throw new HttpError(400, 'Demasiados choferes en una sola asignación');
  let destino = null;
  if (usuario) {
    const r = await db.send(new GetCommand({ TableName: T.usuarios, Key: { usuario } }));
    if (!r.Item || r.Item.activo === false) throw new HttpError(400, 'Usuario destino no válido');
    destino = r.Item;
  }
  const esAdmin = user.rol === 'admin';
  // Un reclutador solo puede tomar para sí choferes sin asignar, o liberar los suyos.
  if (!esAdmin && usuario && usuario !== user.usuario) throw new HttpError(403, 'Solo puedes asignarte choferes a ti mismo');
  const ts = nowIso(); let ok = 0, omitidos = 0;
  await enParalelo(ids, 25, async (id) => {
    const cond = esAdmin ? 'attribute_exists(id)'
      : (usuario ? 'attribute_exists(id) AND (attribute_not_exists(asignado_a) OR asignado_a = :nulo)'
        : 'attribute_exists(id) AND asignado_a = :yo');
    const vals = { ':a': usuario || null, ':por': user.usuario, ':ts': ts };
    if (!esAdmin) { if (usuario) vals[':nulo'] = null; else vals[':yo'] = user.usuario; }
    try {
      await db.send(new UpdateCommand({
        TableName: T.choferes, Key: { id: String(id) },
        UpdateExpression: 'SET asignado_a = :a, asignado_por = :por, asignado_en = :ts, actualizado_en = :ts',
        ConditionExpression: cond, ExpressionAttributeValues: vals,
      }));
      ok++;
    } catch (e) { if (e.name === 'ConditionalCheckFailedException') omitidos++; else throw e; }
  });
  await registrarEvento({
    usuario: user, tipo: 'asignacion',
    resultado: destino ? `Asignó ${ok} chofer(es) a ${destino.nombre}` : `Liberó ${ok} chofer(es)`,
  });
  await bumpVersion();
  return { asignados: ok, omitidos };
}

const ESTATUS_CONTACTO = ['pendiente', 'contactado', 'respondio', 'se_queda', 'sin_respuesta', 'no_interesado', 'opt_out', 'visita_agendada'];

/** Alta manual de un recluta. Si ya existe (por CURP o celular) y nadie lo ha reclamado, se le asigna quién lo reclutó. */
async function crearRecluta(user, b) {
  const nombre = String(b.nombre || '').trim();
  const curp = String(b.curp || '').trim().toUpperCase();
  const cel = soloDigitos(b.celular);
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
  if (cel.length !== 10 && !curp) throw new HttpError(400, 'Captura el celular (10 dígitos) o la CURP');
  if (curp && !/^[A-Z]{4}\d{6}[A-Z0-9]{8}$/.test(curp)) throw new HttpError(400, 'La CURP no tiene un formato válido (18 caracteres)');
  let reclutador = user.usuario;
  if (b.reclutado_por && b.reclutado_por !== user.usuario) { soloAdmin(user); reclutador = b.reclutado_por; }
  const todos = await scanAll(T.choferes, { ProjectionExpression: 'id, curp, celular, celular_alt, reclutado_por, nombre' });
  const existe = todos.find((c) => (curp && String(c.curp || '').toUpperCase() === curp) ||
    (cel.length === 10 && [c.celular, c.celular_alt].some((x) => soloDigitos(x) === cel)));
  const ts = nowIso();
  if (existe) {
    if (existe.reclutado_por) {
      const u = (await db.send(new GetCommand({ TableName: T.usuarios, Key: { usuario: existe.reclutado_por } }))).Item;
      throw new HttpError(409, `${existe.nombre || 'Esta persona'} ya está registrada; la reclutó ${u?.nombre || existe.reclutado_por}`);
    }
    await db.send(new UpdateCommand({
      TableName: T.choferes, Key: { id: existe.id },
      UpdateExpression: 'SET reclutado_por = :r, reclutado_en = :ts, actualizado_en = :ts' + (cel.length === 10 && !existe.celular ? ', celular_alt = :c' : ''),
      ExpressionAttributeValues: { ':r': reclutador, ':ts': ts, ...(cel.length === 10 && !existe.celular ? { ':c': '52' + cel } : {}) },
    }));
    await registrarEvento({ id: existe.id, usuario: user, tipo: 'nota', resultado: 'Registrado como recluta', extra: { nombre: existe.nombre } });
    await bumpVersion();
    return { id: existe.id, yaExistia: true };
  }
  const id = curp ? `CURP-${curp}` : `TEL-52${cel}`;
  await db.send(new PutCommand({
    TableName: T.choferes, ConditionExpression: 'attribute_not_exists(id)',
    Item: {
      id, nombre, curp: curp || undefined, celular: cel.length === 10 ? '52' + cel : undefined,
      estatus_didi: 'Registrado por el equipo', fuentes: new Set(['reclutamiento']), reclutado_por: reclutador, reclutado_en: ts,
      notas: b.notas ? String(b.notas).slice(0, 2000) : undefined, estatus_contacto: 'pendiente', contactos: 0, creado_en: ts, actualizado_en: ts,
    },
  }));
  await registrarEvento({ id, usuario: user, tipo: 'nota', resultado: 'Nuevo recluta registrado', extra: { nombre } });
  await bumpVersion();
  return { id, yaExistia: false };
}

/**
 * Importa el Excel propio de reclutas del equipo (hojas "esperando status" / "conduciendo").
 * Empata por CURP o celular con lo que ya mandó DiDi; si no existe, crea el recluta provisional.
 */
// Pertenencia a las listas del equipo: atributo "lista_<usuario>" = pestañas del Excel de ese usuario donde viene la persona.
// Una persona puede estar en la lista de varios (p. ej. en el Excel de Jorge y en el de Nilzhe); el pago usa "reclutado_por".
const attrLista = (usuario) => `lista_${usuario}`;

/** Antes de importar el Excel de un reclutador se vacía su lista anterior, para que quede igual al archivo nuevo. */
async function iniciarImportReclutas(user, b) {
  const reclutador = user.rol === 'admin' ? String(b.reclutado_por || user.usuario) : user.usuario;
  const items = await scanAll(T.choferes, { FilterExpression: 'attribute_exists(#l)', ExpressionAttributeNames: { '#l': attrLista(reclutador) }, ProjectionExpression: 'id' });
  await enParalelo(items, 20, (c) => db.send(new UpdateCommand({
    TableName: T.choferes, Key: { id: c.id }, UpdateExpression: 'REMOVE #l', ExpressionAttributeNames: { '#l': attrLista(reclutador) },
  })));
  return { limpiados: items.length };
}

/**
 * Importa el Excel propio de reclutas de un miembro del equipo. Cada fila = una persona con sus pestañas (hojas).
 * Empata por CURP o celular con lo que ya mandó DiDi; si no existe, crea el recluta provisional.
 */
async function importarReclutas(user, b) {
  // Un reclutador solo puede importar a su propio nombre y sin quitarle reclutas a nadie.
  if (user.rol !== 'admin') b = { ...b, reclutado_por: user.usuario, reemplazar: false };
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length || rows.length > 500) throw new HttpError(400, 'Lote inválido (máx. 500 filas)');
  const reclutador = String(b.reclutado_por || user.usuario);
  const u = (await db.send(new GetCommand({ TableName: T.usuarios, Key: { usuario: reclutador } }))).Item;
  if (!u) throw new HttpError(400, 'Reclutador no válido');
  const todos = await scanAll(T.choferes, { ProjectionExpression: 'id, curp, celular, celular_alt, reclutado_por, notas, nombre' });
  const porCurp = new Map(); const porCel = new Map();
  for (const c of todos) {
    if (c.curp) porCurp.set(String(c.curp).toUpperCase().trim(), c);
    for (const x of [c.celular, c.celular_alt]) if (soloDigitos(x).length === 10) porCel.set(soloDigitos(x), c);
  }
  const ts = nowIso(); const res = { empatados: 0, nuevos: 0, yaTenianOtro: 0, sinDatos: 0 };
  const names = { '#l': attrLista(reclutador) };
  await enParalelo(rows, 15, async (r) => {
    const curp = String(r.curp || '').toUpperCase().replace(/\s/g, '');
    const cel = soloDigitos(r.celular);
    const nombre = String(r.nombre || '').trim();
    const hojas = [...new Set((r.hojas || (r.hoja ? [r.hoja] : [])).map((h) => String(h).trim().slice(0, 60)).filter(Boolean))];
    const ex = (curp && porCurp.get(curp)) || (cel.length === 10 && porCel.get(cel));
    const auto = r.tiene_auto ? String(r.tiene_auto).slice(0, 80) : null;
    if (ex) {
      res.empatados++;
      const otro = ex.reclutado_por && ex.reclutado_por !== reclutador;
      if (otro) res.yaTenianOtro++;
      // La pertenencia a la lista de este reclutador se guarda siempre (aunque el recluta sea de otra persona).
      const sets = ['#l = :hojas', 'actualizado_en = :ts'];
      const vals = { ':hojas': hojas, ':ts': ts, ':f': new Set(['reclutamiento']) };
      if (!otro || b.reemplazar) {
        sets.push('reclutado_en = if_not_exists(reclutado_en, :ts)');
        if (!ex.reclutado_por || b.reemplazar) { sets.push('reclutado_por = :rp'); vals[':rp'] = reclutador; }
        if (auto) { sets.push('tiene_auto = :ta'); vals[':ta'] = auto; }
        if (r.recuperado) { sets.push('recuperado = :rec'); vals[':rec'] = true; }
        if (r.notas && !ex.notas) { sets.push('notas = :n'); vals[':n'] = String(r.notas).slice(0, 2000); }
        if (cel.length === 10 && !ex.celular) { sets.push('celular_alt = if_not_exists(celular_alt, :ca)'); vals[':ca'] = '52' + cel; }
      }
      if (nombre && (!ex.nombre || /^null$/i.test(ex.nombre))) { sets.push('nombre = :nom'); vals[':nom'] = nombre; } // DiDi a veces no manda el nombre
      await db.send(new UpdateCommand({ TableName: T.choferes, Key: { id: ex.id }, UpdateExpression: `SET ${sets.join(', ')} ADD fuentes :f`, ExpressionAttributeNames: names, ExpressionAttributeValues: vals }));
      return;
    }
    const validCurp = /^[A-Z]{4}\d{6}[A-Z0-9]{8}$/.test(curp);
    if (!validCurp && cel.length !== 10) { res.sinDatos++; return; }
    const id = validCurp ? `CURP-${curp}` : `TEL-52${cel}`;
    await db.send(new PutCommand({
      TableName: T.choferes, ConditionExpression: 'attribute_not_exists(id)',
      Item: {
        id, nombre, curp: curp || undefined, celular: cel.length === 10 ? '52' + cel : undefined, estatus_didi: 'Registrado por el equipo',
        fuentes: new Set(['reclutamiento']), reclutado_por: reclutador, reclutado_en: ts, [attrLista(reclutador)]: hojas,
        recuperado: r.recuperado ? true : undefined, tiene_auto: auto || undefined, notas: r.notas ? String(r.notas).slice(0, 2000) : undefined,
        estatus_contacto: 'pendiente', contactos: 0, creado_en: ts, actualizado_en: ts,
      },
    })).then(() => { res.nuevos++; porCurp.set(curp, { id }); if (cel.length === 10) porCel.set(cel, { id }); })
      .catch((e) => { if (e.name === 'ConditionalCheckFailedException') res.empatados++; else throw e; });
  });
  return res;
}

async function subirAnexo(user, b) {
  soloAdmin(user);
  if (!BUCKET) throw new HttpError(500, 'Falta configurar el bucket');
  const ext = String(b.nombre || '').toLowerCase().match(/\.(pdf|docx?|jpe?g|png)$/)?.[1];
  if (!ext) throw new HttpError(400, 'Sube un PDF, Word o imagen');
  const buf = Buffer.from(String(b.base64 || ''), 'base64');
  if (!buf.length || buf.length > 4 * 1024 * 1024) throw new HttpError(400, 'El archivo debe pesar menos de 4 MB');
  const tipos = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
  // Nombre con fecha: cada versión tiene su propia URL, así CloudFront nunca sirve una copia vieja.
  const key = `docs/Anexo-D-Aviso-de-Privacidad-${Date.now().toString(36)}.${ext}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf, ContentType: tipos[ext], CacheControl: 'public, max-age=31536000, immutable', ContentDisposition: `inline; filename="Anexo-D-Aviso-de-Privacidad.${ext}"` }));
  const anexo = { url: `${PORTAL_URL}/${key}`, nombre: b.nombre, fecha: nowIso(), por: user.nombre };
  await putConfig('anexo_d', anexo);
  await bumpVersion();
  return anexo;
}

async function actualizarChofer(user, id, body) {
  const actual = await choferVisible(user, id);
  const sets = ['actualizado_en = :ts']; const vals = { ':ts': nowIso() };
  if (body.estatus_contacto !== undefined) {
    if (!ESTATUS_CONTACTO.includes(body.estatus_contacto)) throw new HttpError(400, 'Estatus no válido');
    sets.push('estatus_contacto = :ec'); vals[':ec'] = body.estatus_contacto;
  }
  if (body.notas !== undefined) { sets.push('notas = :n'); vals[':n'] = String(body.notas).slice(0, 2000); }
  if (body.celular_alt !== undefined) { sets.push('celular_alt = :c'); vals[':c'] = String(body.celular_alt).slice(0, 20); }
  const names = {};
  if (body.conduciendo_manual !== undefined) {
    sets.push('conduciendo_manual = :cmm'); vals[':cmm'] = !!body.conduciendo_manual;
    // Si viene en el Excel de algún reclutador, se mueve también en esa lista (hasta que se vuelva a importar ese Excel).
    Object.keys(actual).filter((k) => k.startsWith('lista_') && Array.isArray(actual[k]) && actual[k].length).forEach((k, i) => {
      const hojas = actual[k];
      const nuevas = body.conduciendo_manual ? ['conduciendo'] : (hojas.filter((h) => !/conduc/i.test(h)).length ? hojas.filter((h) => !/conduc/i.test(h)) : ['esperando status']);
      names[`#l${i}`] = k; vals[`:l${i}`] = nuevas; sets.push(`#l${i} = :l${i}`);
    });
  }
  // Edición de datos básicos (cualquiera que pueda ver al chofer)
  if (body.nombre !== undefined) {
    const n = String(body.nombre).trim(); if (!n) throw new HttpError(400, 'El nombre no puede quedar vacío');
    sets.push('nombre = :nom'); vals[':nom'] = n.slice(0, 120);
  }
  if (body.celular !== undefined) {
    const c = soloDigitos(body.celular);
    if (c && c.length !== 10) throw new HttpError(400, 'El celular debe tener 10 dígitos');
    sets.push('celular = :cel'); vals[':cel'] = c ? '52' + c : null;
  }
  if (body.curp !== undefined) {
    const c = String(body.curp).trim().toUpperCase();
    if (c && !/^[A-Z]{4}\d{6}[A-Z0-9]{8}$/.test(c)) throw new HttpError(400, 'La CURP no tiene un formato válido (18 caracteres)');
    sets.push('curp = :curp'); vals[':curp'] = c || null;
  }
  if (body.ciudad !== undefined) { sets.push('ciudad = :ciu'); vals[':ciu'] = String(body.ciudad).trim().slice(0, 80); }
  if (body.tiene_auto !== undefined) { sets.push('tiene_auto = :tau'); vals[':tau'] = String(body.tiene_auto).trim().slice(0, 80); }
  if (body.reclutado_por !== undefined) {
    soloAdmin(user); // de esto depende el pago, solo el administrador lo corrige
    sets.push('reclutado_por = :rp', 'reclutado_en = if_not_exists(reclutado_en, :ts)'); vals[':rp'] = body.reclutado_por || null;
  }
  const r = await db.send(new UpdateCommand({
    TableName: T.choferes, Key: { id }, UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(id)', ExpressionAttributeValues: vals, ReturnValues: 'ALL_NEW',
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
  })).catch((e) => { if (e.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Chofer no encontrado'); throw e; });
  if (body.estatus_contacto !== undefined) {
    await registrarEvento({ id, usuario: user, tipo: 'estatus', resultado: `Estatus → ${body.estatus_contacto}`, extra: { nombre: r.Attributes.nombre } });
  }
  const editados = ['nombre', 'celular', 'curp', 'ciudad', 'tiene_auto'].filter((k) => body[k] !== undefined);
  if (editados.length) {
    await registrarEvento({ id, usuario: user, tipo: 'nota', resultado: `Editó datos: ${editados.join(', ')}`, extra: { nombre: r.Attributes.nombre } });
  }
  if (body.conduciendo_manual !== undefined) {
    await registrarEvento({ id, usuario: user, tipo: 'estatus', resultado: body.conduciendo_manual ? 'Movido a Conduciendo' : 'Regresado a Esperando estatus', extra: { nombre: r.Attributes.nombre } });
  }
  if (body.reclutado_por !== undefined) {
    await registrarEvento({ id, usuario: user, tipo: 'nota', resultado: body.reclutado_por ? `Reclutado por → ${body.reclutado_por}` : 'Se quitó quién lo reclutó', extra: { nombre: r.Attributes.nombre } });
  }
  await bumpVersion();
  return clean(r.Attributes);
}

/**
 * Elimina a una persona con su historial y métricas. Admin: cualquiera.
 * Reclutador: solo sus propios reclutas (no los de la lista de asignados de DiDi).
 * Si DiDi la vuelve a mandar en un Excel, se crea de nuevo.
 */
async function eliminarChofer(user, id) {
  const c = await choferVisible(user, id);
  if (user.rol !== 'admin' && !(c.reclutado_por === user.usuario && !fuentesDe(c).has('asignados'))) {
    throw new HttpError(403, 'Solo puedes eliminar a tus propios reclutas; pide al administrador eliminar este registro');
  }
  const evs = await queryAll({ TableName: T.seguimiento, KeyConditionExpression: 'id = :i', ExpressionAttributeValues: { ':i': id }, ProjectionExpression: 'id, ts' });
  await batchWrite(T.seguimiento, evs.map((e) => ({ DeleteRequest: { Key: { id: e.id, ts: e.ts } } })));
  const mets = await scanAll(T.semanas, { FilterExpression: 'id = :i', ExpressionAttributeValues: { ':i': id }, ProjectionExpression: 'semana, id' });
  await batchWrite(T.semanas, mets.map((m) => ({ DeleteRequest: { Key: { semana: m.semana, id: m.id } } })));
  await db.send(new DeleteCommand({ TableName: T.choferes, Key: { id } }));
  await registrarEvento({ usuario: user, tipo: 'nota', resultado: `Eliminó a ${c.nombre || id}`, nota: c.reclutado_por ? 'Recluta' : fuentesDe(c).has('asignados') ? 'Lista de asignados' : '' });
  await bumpVersion();
  return { ok: true };
}

async function nuevoSeguimiento(user, id, body) {
  const tipos = ['whatsapp', 'llamada', 'nota', 'visita', 'copiado'];
  if (!tipos.includes(body.tipo)) throw new HttpError(400, 'Tipo de seguimiento no válido');
  const ch = await choferVisible(user, id);
  const ev = await registrarEvento({
    id, usuario: user, tipo: body.tipo, resultado: String(body.resultado || '').slice(0, 200),
    nota: String(body.nota || '').slice(0, 2000), plantilla: String(body.plantilla || '').slice(0, 80),
    extra: { nombre: ch.nombre },
  });
  const sets = ['ultimo_contacto = :u', 'actualizado_en = :ts', 'contactos = if_not_exists(contactos, :z) + :uno'];
  const vals = { ':u': { fecha: ev.fecha, por: user.usuario, tipo: body.tipo, resultado: ev.resultado }, ':ts': ev.fecha, ':z': 0, ':uno': 1 };
  if (body.bienvenida) sets.push('bienvenida_enviada = if_not_exists(bienvenida_enviada, :ts)');
  let estatus = body.estatus_contacto;
  if (!estatus && ['whatsapp', 'llamada', 'visita'].includes(body.tipo) && (ch.estatus_contacto || 'pendiente') === 'pendiente') estatus = 'contactado';
  if (estatus) {
    if (!ESTATUS_CONTACTO.includes(estatus)) throw new HttpError(400, 'Estatus no válido');
    sets.push('estatus_contacto = :ec'); vals[':ec'] = estatus;
  }
  const r = await db.send(new UpdateCommand({
    TableName: T.choferes, Key: { id }, UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: vals, ReturnValues: 'ALL_NEW',
  }));
  await bumpVersion();
  return { evento: clean(ev), chofer: clean(r.Attributes) };
}

async function historial(user, id) {
  await choferVisible(user, id);
  const items = await queryAll({
    TableName: T.seguimiento, KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: { ':id': id }, ScanIndexForward: false,
  });
  return clean(items);
}
async function actividad(user, limit = 60, desde) {
  const max = Math.min(Number(limit) || 60, 200);
  // Para un reclutador: solo eventos de choferes que puede ver (y sus propias acciones generales).
  let filtro = (e) => true;
  if (user.rol !== 'admin') {
    const ids = await idsVisibles(user);
    filtro = (e) => (e.id && !e.id.startsWith('_') ? ids.has(e.id) : e.usuario === user.usuario || e.tipo === 'import');
  }
  if (desde) { // todo lo ocurrido desde una fecha (para el formato semanal de DiDi)
    return clean((await queryAll({
      TableName: T.seguimiento, IndexName: 'Feed', KeyConditionExpression: 'gpk = :f AND ts >= :d',
      ExpressionAttributeValues: { ':f': 'F', ':d': String(desde) }, ScanIndexForward: true,
    })).filter(filtro));
  }
  const out = []; let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({
      TableName: T.seguimiento, IndexName: 'Feed', KeyConditionExpression: 'gpk = :f',
      ExpressionAttributeValues: { ':f': 'F' }, ScanIndexForward: false, Limit: 200, ExclusiveStartKey,
    }));
    out.push(...(r.Items || []).filter(filtro)); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (out.length < max && ExclusiveStartKey);
  return clean(out.slice(0, max));
}

// usuarios
async function crearUsuario(user, b) {
  soloAdmin(user);
  const usuario = String(b.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new HttpError(400, 'Usuario inválido (3-30 caracteres: letras, números, . _ -)');
  if (!b.nombre || String(b.password || '').length < 8) throw new HttpError(400, 'Nombre y contraseña (mín. 8 caracteres) son obligatorios');
  const item = {
    usuario, nombre: String(b.nombre).trim(), rol: b.rol === 'admin' ? 'admin' : 'reclutador',
    telefono: String(b.telefono || ''), activo: true, password: hashPassword(b.password), creado_en: nowIso(),
  };
  await db.send(new PutCommand({ TableName: T.usuarios, Item: item, ConditionExpression: 'attribute_not_exists(usuario)' }))
    .catch((e) => { if (e.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'Ese usuario ya existe'); throw e; });
  await bumpVersion();
  return publicUser(item);
}
async function editarUsuario(user, usuario, b) {
  soloAdmin(user);
  const sets = []; const vals = {};
  if (b.nombre) { sets.push('nombre = :n'); vals[':n'] = String(b.nombre).trim(); }
  if (b.rol) { sets.push('rol = :r'); vals[':r'] = b.rol === 'admin' ? 'admin' : 'reclutador'; }
  if (b.telefono !== undefined) { sets.push('telefono = :t'); vals[':t'] = String(b.telefono); }
  if (b.activo !== undefined) {
    if (usuario === user.usuario && !b.activo) throw new HttpError(400, 'No puedes desactivarte a ti mismo');
    sets.push('activo = :a'); vals[':a'] = !!b.activo;
  }
  if (b.password) {
    if (String(b.password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    sets.push('password = :p'); vals[':p'] = hashPassword(b.password);
  }
  if (!sets.length) throw new HttpError(400, 'Nada que actualizar');
  const r = await db.send(new UpdateCommand({
    TableName: T.usuarios, Key: { usuario }, UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(usuario)', ExpressionAttributeValues: vals, ReturnValues: 'ALL_NEW',
  })).catch((e) => { if (e.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Usuario no encontrado'); throw e; });
  await bumpVersion();
  return publicUser(r.Attributes);
}

async function guardarPlantilla(user, id, b) {
  soloAdmin(user);
  const pid = id || `p_${crypto.randomBytes(4).toString('hex')}`;
  if (!b.nombre || !b.texto) throw new HttpError(400, 'Nombre y texto son obligatorios');
  const item = {
    id: pid, nombre: String(b.nombre).slice(0, 80), categoria: String(b.categoria || 'general'),
    texto: String(b.texto).slice(0, 4000), orden: Number(b.orden ?? 50), actualizado_en: nowIso(), actualizado_por: user.nombre,
  };
  await db.send(new PutCommand({ TableName: T.plantillas, Item: item }));
  await bumpVersion();
  return item;
}

// ---------------------------------------------------------------- router
async function route(event) {
  const method = event.requestContext?.http?.method || 'GET';
  const path = (event.rawPath || '/').replace(/^\/api/, '') || '/';
  const q = event.queryStringParameters || {};
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); }
    catch { throw new HttpError(400, 'JSON inválido'); }
  }
  const m = (re) => path.match(re);

  // ---- públicas
  if (method === 'POST' && path === '/login') {
    const usuario = String(body.usuario || '').trim().toLowerCase();
    const r = await db.send(new GetCommand({ TableName: T.usuarios, Key: { usuario } }));
    if (!r.Item || r.Item.activo === false || !verifyPassword(String(body.password || ''), r.Item.password)) {
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    await db.send(new UpdateCommand({ TableName: T.usuarios, Key: { usuario }, UpdateExpression: 'SET ultimo_acceso = :t', ExpressionAttributeValues: { ':t': nowIso() } }));
    return { token: await signToken({ sub: usuario, rol: r.Item.rol }), usuario: publicUser(r.Item) };
  }
  if (method === 'POST' && path === '/setup') {
    // Solo funciona si aún no existe ningún usuario: crea al primer administrador.
    const r = await db.send(new ScanCommand({ TableName: T.usuarios, Limit: 1 }));
    if (r.Count) throw new HttpError(403, 'El sistema ya está inicializado');
    await asegurarPlantillas();
    return crearUsuario({ rol: 'admin' }, { ...body, rol: 'admin' });
  }
  if (method === 'GET' && path === '/salud') return { ok: true, ts: nowIso() };

  // ---- privadas
  const user = await auth(event);
  if (method === 'GET' && path === '/version') return { version: (await getConfig('version')) || 0 };
  if (method === 'GET' && path === '/bootstrap') { await asegurarPlantillas(); return bootstrap(user); }
  if (method === 'GET' && path === '/actividad') return actividad(user, q.limit, q.desde);
  if (method === 'POST' && path === '/reclutas') return crearRecluta(user, body);
  if (method === 'POST' && path === '/import/reclutas') return importarReclutas(user, body);
  if (method === 'POST' && path === '/import/reclutas-inicio') return iniciarImportReclutas(user, body);
  if (method === 'POST' && path === '/import/finalizar-reclutas') {
    if (user.rol !== 'admin') body.reclutado_por = user.usuario;
    const r = body.resumen || {};
    const quien = (await db.send(new GetCommand({ TableName: T.usuarios, Key: { usuario: String(body.reclutado_por || '') } }))).Item?.nombre || body.reclutado_por;
    const hist = (await getConfig('importaciones')) || [];
    hist.unshift({ fecha: nowIso(), usuario: user.nombre, semana: '', archivo: String(body.archivo || ''), tipo: 'reclutas', resumen: { nuevos: r.nuevos || 0, actualizados: r.empatados || 0 }, depuradas: [] });
    await putConfig('importaciones', hist.slice(0, 30));
    await registrarEvento({ usuario: user, tipo: 'import', resultado: `Importó reclutas de ${quien} (${body.archivo || 'Excel'})`, nota: `${r.empatados || 0} empatados con DiDi · ${r.nuevos || 0} nuevos en espera` });
    await bumpVersion();
    return { ok: true };
  }
  if (method === 'POST' && path === '/anexo') return subirAnexo(user, body);
  if (method === 'POST' && path === '/password') {
    if (!verifyPassword(String(body.actual || ''), user.password)) throw new HttpError(400, 'La contraseña actual no coincide');
    return editarUsuario({ rol: 'admin', usuario: '' }, user.usuario, { password: body.nueva });
  }
  if (method === 'POST' && path === '/choferes/asignar') return asignar(user, body);
  let mm;
  if ((mm = m(/^\/choferes\/([^/]+)\/seguimiento$/))) {
    const id = decodeURIComponent(mm[1]);
    if (method === 'GET') return historial(user, id);
    if (method === 'POST') return nuevoSeguimiento(user, id, body);
  }
  if ((mm = m(/^\/choferes\/([^/]+)$/)) && method === 'PATCH') return actualizarChofer(user, decodeURIComponent(mm[1]), body);
  if ((mm = m(/^\/choferes\/([^/]+)$/)) && method === 'DELETE') return eliminarChofer(user, decodeURIComponent(mm[1]));
  if (method === 'POST' && path === '/import/lote') return importarLote(user, body);
  if (method === 'POST' && path === '/import/finalizar') return finalizarImport(user, body);

  if (path === '/usuarios' && method === 'POST') return crearUsuario(user, body);
  if ((mm = m(/^\/usuarios\/([^/]+)$/)) && method === 'PATCH') return editarUsuario(user, decodeURIComponent(mm[1]), body);

  if (path === '/plantillas' && method === 'POST') return guardarPlantilla(user, null, body);
  if ((mm = m(/^\/plantillas\/([^/]+)$/))) {
    const id = decodeURIComponent(mm[1]);
    if (method === 'PUT') return guardarPlantilla(user, id, body);
    if (method === 'DELETE') {
      soloAdmin(user);
      await db.send(new DeleteCommand({ TableName: T.plantillas, Key: { id } }));
      await bumpVersion(); return { ok: true };
    }
  }
  if (path === '/umbrales' && method === 'PUT') {
    soloAdmin(user);
    const u = {};
    for (const k of Object.keys(DEFAULT_UMBRALES)) if (body[k] !== undefined) u[k] = Number(body[k]);
    await putConfig('umbrales', { ...DEFAULT_UMBRALES, ...((await getConfig('umbrales')) || {}), ...u });
    await bumpVersion(); return { ok: true };
  }
  throw new HttpError(404, `Ruta no encontrada: ${method} ${path}`);
}

export const handler = async (event) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  try {
    const data = await route(event);
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    return { statusCode: status, headers, body: JSON.stringify({ error: status === 500 ? 'Error interno del servidor' : e.message }) };
  }
};
