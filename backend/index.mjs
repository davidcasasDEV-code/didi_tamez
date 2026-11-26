// DIDI_Choferes_Tamez_API — Lambda única (Node.js 22, sin dependencias externas).
// Se expone por Function URL y CloudFront la publica bajo /api/*.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
  ScanCommand, QueryCommand, BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';
import { DEFAULT_PLANTILLAS, DEFAULT_UMBRALES } from './defaults.mjs';

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
  'ciudad_primer_viaje', 'ultimo_viaje_antes_cb',
];
async function importarLote(user, body) {
  soloAdmin(user);
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
  await enParalelo(rows, 20, async (r) => {
    const id = String(r.id || '').trim(); if (!id) return;
    const sets = ['creado_en = if_not_exists(creado_en, :ts)', 'actualizado_en = :ts',
      'estatus_contacto = if_not_exists(estatus_contacto, :pend)', 'contactos = if_not_exists(contactos, :cero)'];
    const vals = { ':ts': ts, ':pend': 'pendiente', ':cero': 0, ':f': new Set([tipo]) };
    for (const c of MERGE_CAMPOS) {
      if (r[c] !== undefined && r[c] !== null && r[c] !== '') { sets.push(`${c} = :${c}`); vals[`:${c}`] = r[c]; }
    }
    if (r.metricas) { sets.push('ultima_semana = :sem'); vals[':sem'] = semana; }
    const notas = r.notas_excel ? String(r.notas_excel).slice(0, 2000) : null;
    if (notas) { sets.push('notas_excel = :ne'); vals[':ne'] = notas; }
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
  return { nuevos, actualizados, metricas: metricas.length };
}

async function finalizarImport(user, body) {
  soloAdmin(user);
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

// ---------------------------------------------------------------- handlers
async function bootstrap(user) {
  const [usuarios, choferes, semanasItems, plantillas, umbrales, version, importaciones] = await Promise.all([
    scanAll(T.usuarios), scanAll(T.choferes), scanAll(T.semanas), scanAll(T.plantillas),
    getConfig('umbrales'), getConfig('version'), getConfig('importaciones'),
  ]);
  const metricas = {}; const general = {}; const semanas = new Set();
  for (const s of semanasItems) {
    semanas.add(s.semana);
    if (s.id === '_GENERAL') { general[s.semana] = s.kpis; continue; }
    const { semana, id, importado_en, ...m } = s;
    (metricas[id] ||= {})[semana] = m;
  }
  return clean({
    yo: publicUser(user),
    usuarios: usuarios.map(publicUser),
    choferes,
    semanas: [...semanas].sort().reverse(),
    metricas, general,
    plantillas: plantillas.sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99)),
    umbrales: { ...DEFAULT_UMBRALES, ...(umbrales || {}) },
    importaciones: importaciones || [],
    version: version || 0,
  });
}

async function asignar(user, { ids, usuario }) {
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

const ESTATUS_CONTACTO = ['pendiente', 'contactado', 'respondio', 'sin_respuesta', 'no_interesado', 'opt_out', 'visita_agendada'];

async function actualizarChofer(user, id, body) {
  const sets = ['actualizado_en = :ts']; const vals = { ':ts': nowIso() };
  if (body.estatus_contacto !== undefined) {
    if (!ESTATUS_CONTACTO.includes(body.estatus_contacto)) throw new HttpError(400, 'Estatus no válido');
    sets.push('estatus_contacto = :ec'); vals[':ec'] = body.estatus_contacto;
  }
  if (body.notas !== undefined) { sets.push('notas = :n'); vals[':n'] = String(body.notas).slice(0, 2000); }
  if (body.celular_alt !== undefined) { sets.push('celular_alt = :c'); vals[':c'] = String(body.celular_alt).slice(0, 20); }
  const r = await db.send(new UpdateCommand({
    TableName: T.choferes, Key: { id }, UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(id)', ExpressionAttributeValues: vals, ReturnValues: 'ALL_NEW',
  })).catch((e) => { if (e.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Chofer no encontrado'); throw e; });
  if (body.estatus_contacto !== undefined) {
    await registrarEvento({ id, usuario: user, tipo: 'estatus', resultado: `Estatus → ${body.estatus_contacto}`, extra: { nombre: r.Attributes.nombre } });
  }
  await bumpVersion();
  return clean(r.Attributes);
}

async function nuevoSeguimiento(user, id, body) {
  const tipos = ['whatsapp', 'llamada', 'nota', 'visita', 'copiado'];
  if (!tipos.includes(body.tipo)) throw new HttpError(400, 'Tipo de seguimiento no válido');
  const ch = (await db.send(new GetCommand({ TableName: T.choferes, Key: { id } }))).Item;
  if (!ch) throw new HttpError(404, 'Chofer no encontrado');
  const ev = await registrarEvento({
    id, usuario: user, tipo: body.tipo, resultado: String(body.resultado || '').slice(0, 200),
    nota: String(body.nota || '').slice(0, 2000), plantilla: String(body.plantilla || '').slice(0, 80),
    extra: { nombre: ch.nombre },
  });
  const sets = ['ultimo_contacto = :u', 'actualizado_en = :ts', 'contactos = if_not_exists(contactos, :z) + :uno'];
  const vals = { ':u': { fecha: ev.fecha, por: user.usuario, tipo: body.tipo, resultado: ev.resultado }, ':ts': ev.fecha, ':z': 0, ':uno': 1 };
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

async function historial(id) {
  const items = await queryAll({
    TableName: T.seguimiento, KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: { ':id': id }, ScanIndexForward: false,
  });
  return clean(items);
}
async function actividad(limit = 60) {
  const r = await db.send(new QueryCommand({
    TableName: T.seguimiento, IndexName: 'Feed', KeyConditionExpression: 'gpk = :f',
    ExpressionAttributeValues: { ':f': 'F' }, ScanIndexForward: false, Limit: Math.min(Number(limit) || 60, 200),
  }));
  return clean(r.Items || []);
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
  if (method === 'GET' && path === '/actividad') return actividad(q.limit);
  if (method === 'POST' && path === '/password') {
    if (!verifyPassword(String(body.actual || ''), user.password)) throw new HttpError(400, 'La contraseña actual no coincide');
    return editarUsuario({ rol: 'admin', usuario: '' }, user.usuario, { password: body.nueva });
  }
  if (method === 'POST' && path === '/choferes/asignar') return asignar(user, body);
  let mm;
  if ((mm = m(/^\/choferes\/([^/]+)\/seguimiento$/))) {
    const id = decodeURIComponent(mm[1]);
    if (method === 'GET') return historial(id);
    if (method === 'POST') return nuevoSeguimiento(user, id, body);
  }
  if ((mm = m(/^\/choferes\/([^/]+)$/)) && method === 'PATCH') return actualizarChofer(user, decodeURIComponent(mm[1]), body);
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
