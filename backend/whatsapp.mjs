// WhatsApp Business Platform (Cloud API de Meta): envío de plantillas, respuestas dentro de la ventana de 24 h,
// webhook de mensajes entrantes y estados (enviado / entregado / leído / fallido).
// Los secretos (token y App Secret) viven cifrados en SSM Parameter Store; nunca se devuelven al navegador.
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import crypto from 'node:crypto';

const ssm = new SSMClient({});
const RUTA_SSM = '/DIDI_Choferes_Tamez/whatsapp';
const VERSION_GRAPH = 'v23.0';
const VENTANA_MS = 24 * 3600 * 1000;

export function crearWhatsApp(ctx) {
  const { db, T, cmd, HttpError, nowIso, getConfig, putConfig, bumpVersion, registrarEvento, scanAll, queryAll, soloAdmin, choferVisible, soloDigitos } = ctx;
  const { GetCommand, PutCommand, UpdateCommand } = cmd;

  // ---------------------------------------------------------------- secretos y configuración
  const cacheSec = {};
  async function secreto(nombre) {
    const c = cacheSec[nombre];
    if (c && Date.now() - c.t < 5 * 60 * 1000) return c.v;
    try {
      const r = await ssm.send(new GetParameterCommand({ Name: `${RUTA_SSM}/${nombre}`, WithDecryption: true }));
      cacheSec[nombre] = { v: r.Parameter.Value, t: Date.now() }; return r.Parameter.Value;
    } catch (e) { if (e.name === 'ParameterNotFound') return null; throw e; }
  }
  async function guardarSecreto(nombre, valor) {
    await ssm.send(new PutParameterCommand({ Name: `${RUTA_SSM}/${nombre}`, Value: valor, Type: 'SecureString', Overwrite: true }));
    delete cacheSec[nombre];
  }
  const cfg = async () => ({ version: VERSION_GRAPH, limite_diario: 100, plantillas: [], ...((await getConfig('whatsapp')) || {}) });

  async function estado(user, portalUrl) {
    const c = await cfg();
    const [tok, sec] = await Promise.all([secreto('token'), secreto('app_secret')]);
    const base = {
      configurado: !!(c.phone_number_id && tok), plantillas: (c.plantillas || []).filter((p) => p.estado === 'APPROVED' || user.rol === 'admin'),
      limite_diario: c.limite_diario,
    };
    if (user.rol !== 'admin') return base;
    return {
      ...base, phone_number_id: c.phone_number_id || '', waba_id: c.waba_id || '', version: c.version,
      tiene_token: !!tok, tiene_app_secret: !!sec, verify_token: c.verify_token || '', webhook_url: `${portalUrl}/api/whatsapp/webhook`,
      numero: c.numero || null, plantillas: c.plantillas || [],
    };
  }

  async function guardarConfig(user, b) {
    soloAdmin(user);
    const c = await cfg();
    if (b.phone_number_id !== undefined) c.phone_number_id = String(b.phone_number_id).replace(/\D/g, '');
    if (b.waba_id !== undefined) c.waba_id = String(b.waba_id).replace(/\D/g, '');
    if (b.limite_diario !== undefined) c.limite_diario = Math.max(1, Math.min(1000, Number(b.limite_diario) || 100));
    if (b.version && /^v\d+\.\d+$/.test(b.version)) c.version = b.version;
    c.verify_token ||= crypto.randomBytes(18).toString('base64url');
    if (b.token) await guardarSecreto('token', String(b.token).trim());
    if (b.app_secret) await guardarSecreto('app_secret', String(b.app_secret).trim());
    await putConfig('whatsapp', c);
    await bumpVersion();
    return { ok: true };
  }

  async function graph(ruta, { method = 'GET', body } = {}) {
    const c = await cfg(); const tok = await secreto('token');
    if (!tok) throw new HttpError(400, 'Falta capturar el token de WhatsApp en Administración');
    const r = await fetch(`https://graph.facebook.com/${c.version}/${ruta}`, {
      method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = j.error || {};
      const msg = e.error_data?.details || e.message || `Error ${r.status} de Meta`;
      throw new HttpError(r.status >= 500 ? 502 : 400, `WhatsApp: ${msg}${e.code ? ` (código ${e.code})` : ''}`);
    }
    return j;
  }

  async function probar(user) {
    soloAdmin(user);
    const c = await cfg();
    if (!c.phone_number_id) throw new HttpError(400, 'Falta el Phone number ID');
    const n = await graph(`${c.phone_number_id}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier`);
    c.numero = { telefono: n.display_phone_number, nombre: n.verified_name, calidad: n.quality_rating, limite: n.messaging_limit_tier || null, nombre_estado: n.name_status || null, revisado: nowIso() };
    await putConfig('whatsapp', c);
    return c.numero;
  }

  // ---------------------------------------------------------------- plantillas
  const contarVariables = (texto) => Math.max(0, ...[...String(texto || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => +m[1]));
  async function sincronizarPlantillas(user) {
    soloAdmin(user);
    const c = await cfg();
    if (!c.waba_id) throw new HttpError(400, 'Falta el WABA ID');
    const j = await graph(`${c.waba_id}/message_templates?fields=name,language,status,category,components&limit=200`);
    const previas = new Map((c.plantillas || []).map((p) => [`${p.nombre}|${p.idioma}`, p]));
    c.plantillas = (j.data || []).map((t) => {
      const cuerpo = (t.components || []).find((x) => x.type === 'BODY')?.text || '';
      const prev = previas.get(`${t.name}|${t.language}`) || {};
      const n = contarVariables(cuerpo);
      return {
        nombre: t.name, idioma: t.language, estado: t.status, categoria: t.category, cuerpo, n_variables: n,
        params: Array.from({ length: n }, (_, i) => prev.params?.[i] || ['nombre', 'mi_nombre', 'comparativa'][i] || 'nombre'),
        uso: prev.uso || (/bienven/i.test(t.name) ? 'bienvenida' : /document/i.test(t.name) ? 'documentos' : 'seguimiento'),
        botones: (t.components || []).filter((x) => x.type === 'BUTTONS').flatMap((x) => (x.buttons || []).map((b) => b.text)),
      };
    });
    await putConfig('whatsapp', c); await bumpVersion();
    return c.plantillas;
  }
  async function mapearPlantilla(user, b) {
    soloAdmin(user);
    const c = await cfg();
    const p = (c.plantillas || []).find((x) => x.nombre === b.nombre && x.idioma === b.idioma);
    if (!p) throw new HttpError(404, 'Plantilla no encontrada; sincroniza primero');
    if (Array.isArray(b.params)) p.params = b.params.slice(0, p.n_variables).map(String);
    if (b.uso) p.uso = String(b.uso);
    await putConfig('whatsapp', c); await bumpVersion();
    return p;
  }

  // ---------------------------------------------------------------- envío
  const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Monterrey' });
  async function contarEnvio(user, n = 1) {
    const c = await cfg();
    const clave = `wa_envios#${hoy()}`;
    const r = await db.send(new UpdateCommand({
      TableName: T.config, Key: { clave }, UpdateExpression: 'ADD #u :n', ExpressionAttributeNames: { '#u': user.usuario },
      ExpressionAttributeValues: { ':n': n }, ReturnValues: 'UPDATED_NEW',
    }));
    const total = r.Attributes[user.usuario];
    if (total > c.limite_diario) {
      await db.send(new UpdateCommand({ TableName: T.config, Key: { clave }, UpdateExpression: 'ADD #u :n', ExpressionAttributeNames: { '#u': user.usuario }, ExpressionAttributeValues: { ':n': -n } }));
      throw new HttpError(429, `Llegaste al límite de ${c.limite_diario} mensajes nuevos por día. Mañana se reinicia (el administrador lo puede ajustar).`);
    }
    return total;
  }
  async function enviadosHoy(user) {
    const r = await db.send(new GetCommand({ TableName: T.config, Key: { clave: `wa_envios#${hoy()}` } }));
    return r.Item?.[user.usuario] || 0;
  }
  const destino = (ch) => { const d = soloDigitos(ch.celular || ch.celular_alt); if (d.length !== 10) throw new HttpError(400, 'Este chofer no tiene un celular válido'); return '52' + d; };

  async function guardarMensaje(ch, m) {
    const ts = `${nowIso()}#${crypto.randomBytes(3).toString('hex')}`;
    const item = { id: ch.id, ts, fecha: ts.slice(0, 24), ...m };
    await db.send(new PutCommand({ TableName: T.mensajes, Item: item }));
    if (m.wamid) await db.send(new PutCommand({ TableName: T.mensajes, Item: { id: `WAMID#${m.wamid}`, ts: '0', chofer: ch.id, msg_ts: ts } }));
    return item;
  }

  async function enviarPlantilla(user, b) {
    const ch = await choferVisible(user, String(b.id || ''));
    const c = await cfg();
    if (!c.phone_number_id) throw new HttpError(400, 'WhatsApp API aún no está configurado');
    const p = (c.plantillas || []).find((x) => x.nombre === b.nombre && x.idioma === b.idioma);
    if (!p || p.estado !== 'APPROVED') throw new HttpError(400, 'La plantilla no está aprobada por Meta');
    const valores = (Array.isArray(b.valores) ? b.valores : []).slice(0, p.n_variables).map((v) => String(v ?? '').replace(/\s*\n\s*/g, ' · ').slice(0, 900) || '-');
    if (valores.length !== p.n_variables) throw new HttpError(400, `La plantilla necesita ${p.n_variables} dato(s)`);
    if (ch.estatus_contacto === 'opt_out' || ch.estatus_contacto === 'no_interesado') {
      if (!b.forzar) throw new HttpError(409, 'Este chofer pidió no recibir mensajes. Si de verdad quieres escribirle, confírmalo.');
    }
    await contarEnvio(user);
    let r;
    try {
      r = await graph(`${c.phone_number_id}/messages`, {
        method: 'POST',
        body: {
          messaging_product: 'whatsapp', to: destino(ch), type: 'template',
          template: { name: p.nombre, language: { code: p.idioma }, components: p.n_variables ? [{ type: 'body', parameters: valores.map((t) => ({ type: 'text', text: t })) }] : [] },
        },
      });
    } catch (e) { await contarEnvio(user, -1).catch(() => {}); throw e; }
    const texto = p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, i) => valores[+i - 1] ?? '');
    const wamid = r.messages?.[0]?.id;
    const msg = await guardarMensaje(ch, { dir: 'out', tipo: 'plantilla', plantilla: p.nombre, texto, wamid, estado: 'enviado', por: user.usuario, por_nombre: user.nombre });
    await registrarSalida(user, ch, msg, p.uso === 'bienvenida', `Plantilla ${p.nombre}`);
    return { ok: true, mensaje: msg };
  }

  async function enviarTexto(user, b) {
    const ch = await choferVisible(user, String(b.id || ''));
    const c = await cfg();
    const texto = String(b.texto || '').trim().slice(0, 4000);
    if (!texto) throw new HttpError(400, 'Escribe un mensaje');
    if (!(ch.wa_ventana_hasta && ch.wa_ventana_hasta > nowIso())) {
      throw new HttpError(400, 'Pasaron más de 24 h desde su último mensaje: solo se le puede escribir con una plantilla aprobada');
    }
    const r = await graph(`${c.phone_number_id}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to: destino(ch), type: 'text', text: { body: texto, preview_url: true } } });
    const msg = await guardarMensaje(ch, { dir: 'out', tipo: 'texto', texto, wamid: r.messages?.[0]?.id, estado: 'enviado', por: user.usuario, por_nombre: user.nombre });
    await registrarSalida(user, ch, msg, !!b.bienvenida, 'Mensaje');
    return { ok: true, mensaje: msg };
  }

  async function registrarSalida(user, ch, msg, bienvenida, etiqueta) {
    const sets = ['wa_ultimo = :u', 'ultimo_contacto = :uc', 'actualizado_en = :ts', 'contactos = if_not_exists(contactos, :z) + :uno', 'wa_no_leidos = :cero'];
    const vals = { ':u': { fecha: msg.fecha, dir: 'out', texto: msg.texto.slice(0, 160), por: user.usuario }, ':uc': { fecha: msg.fecha, por: user.usuario, tipo: 'whatsapp', resultado: 'Mensaje enviado (WhatsApp API)' }, ':ts': msg.fecha, ':z': 0, ':uno': 1, ':cero': 0 };
    if (bienvenida) { sets.push('bienvenida_enviada = if_not_exists(bienvenida_enviada, :ts)'); }
    if ((ch.estatus_contacto || 'pendiente') === 'pendiente') { sets.push('estatus_contacto = :ec'); vals[':ec'] = 'contactado'; }
    await db.send(new UpdateCommand({ TableName: T.choferes, Key: { id: ch.id }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeValues: vals }));
    await registrarEvento({ id: ch.id, usuario: user, tipo: 'whatsapp', resultado: `${etiqueta} enviado por WhatsApp API`, nota: msg.texto.slice(0, 300), plantilla: msg.plantilla || '', extra: { nombre: ch.nombre } });
    await bumpVersion();
  }

  async function conversacion(user, id) {
    await choferVisible(user, id);
    const items = await queryAll({ TableName: T.mensajes, KeyConditionExpression: 'id = :i', ExpressionAttributeValues: { ':i': id } });
    return items.sort((a, b) => a.ts.localeCompare(b.ts));
  }
  async function marcarLeido(user, id) {
    await choferVisible(user, id);
    await db.send(new UpdateCommand({ TableName: T.choferes, Key: { id }, UpdateExpression: 'SET wa_no_leidos = :z', ExpressionAttributeValues: { ':z': 0 } }));
    return { ok: true };
  }

  // ---------------------------------------------------------------- webhook
  function verificarWebhook(q, c) {
    if (q['hub.mode'] === 'subscribe' && c.verify_token && q['hub.verify_token'] === c.verify_token) return String(q['hub.challenge'] || '');
    return null;
  }
  async function firmaValida(raw, firma) {
    const sec = await secreto('app_secret');
    if (!sec || !firma) return false;
    const esperado = 'sha256=' + crypto.createHmac('sha256', sec).update(raw).digest('hex');
    return esperado.length === firma.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(firma));
  }

  function textoEntrante(m) {
    switch (m.type) {
      case 'text': return m.text?.body || '';
      case 'button': return m.button?.text || '';
      case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
      case 'image': case 'video': case 'audio': case 'document': case 'sticker':
        return `[${({ image: 'Imagen', video: 'Video', audio: 'Audio', document: 'Documento', sticker: 'Sticker' })[m.type]}${m[m.type]?.caption ? `: ${m[m.type].caption}` : ''} — ábrelo en WhatsApp Manager]`;
      case 'location': return `[Ubicación: ${m.location?.latitude}, ${m.location?.longitude}]`;
      default: return `[Mensaje tipo ${m.type}]`;
    }
  }

  async function procesarWebhook(body) {
    let nuevos = 0;
    let choferes = null; // se carga solo si llega un mensaje
    for (const entry of body.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      // estados de mensajes enviados
      for (const s of v.statuses || []) {
        const ptr = (await db.send(new GetCommand({ TableName: T.mensajes, Key: { id: `WAMID#${s.id}`, ts: '0' } }))).Item;
        if (!ptr) continue;
        const orden = { enviado: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
        await db.send(new UpdateCommand({
          TableName: T.mensajes, Key: { id: ptr.chofer, ts: ptr.msg_ts },
          UpdateExpression: 'SET estado = :e, estado_en = :t' + (s.errors?.length ? ', error = :err' : ''),
          ConditionExpression: 'attribute_not_exists(estado) OR estado <> :leido OR :e = :fallo',
          ExpressionAttributeValues: { ':e': s.status, ':t': nowIso(), ':leido': 'read', ':fallo': 'failed', ...(s.errors?.length ? { ':err': `${s.errors[0].code}: ${s.errors[0].title || s.errors[0].message || ''}` } : {}) },
        })).catch((e) => { if (e.name !== 'ConditionalCheckFailedException') throw e; });
        void orden;
      }
      // mensajes entrantes
      for (const m of v.messages || []) {
        choferes ||= await scanAll(T.choferes, { ProjectionExpression: 'id, nombre, celular, celular_alt, estatus_contacto' });
        const from = soloDigitos(m.from);
        let chofer = choferes.find((c) => [c.celular, c.celular_alt].some((x) => soloDigitos(x) === from));
        const perfil = (v.contacts || []).find((c) => c.wa_id === m.from)?.profile?.name || '';
        if (!chofer) {
          chofer = { id: `WA-52${from}`, nombre: perfil || `WhatsApp ${from}` };
          await db.send(new PutCommand({
            TableName: T.choferes, ConditionExpression: 'attribute_not_exists(id)',
            Item: { id: chofer.id, nombre: chofer.nombre, celular: '52' + from, estatus_didi: 'Escribió por WhatsApp', fuentes: new Set(['whatsapp']), estatus_contacto: 'respondio', contactos: 0, creado_en: nowIso(), actualizado_en: nowIso() },
          })).catch((e) => { if (e.name !== 'ConditionalCheckFailedException') throw e; });
          choferes.push(chofer);
        }
        const texto = textoEntrante(m);
        const dup = (await db.send(new GetCommand({ TableName: T.mensajes, Key: { id: `WAMID#${m.id}`, ts: '0' } }))).Item;
        if (dup) continue; // Meta puede reenviar el mismo webhook
        const msg = await guardarMensaje(chofer, { dir: 'in', tipo: m.type, texto, wamid: m.id, perfil });
        const ahora = nowIso(); const ventana = new Date(Date.now() + VENTANA_MS).toISOString();
        const sets = ['wa_ultimo = :u', 'wa_ventana_hasta = :v', 'actualizado_en = :t', 'wa_no_leidos = if_not_exists(wa_no_leidos, :z) + :uno'];
        const vals = { ':u': { fecha: msg.fecha, dir: 'in', texto: texto.slice(0, 160) }, ':v': ventana, ':t': ahora, ':z': 0, ':uno': 1 };
        // Respuesta SI / NO a la bienvenida
        const limpio = texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.!¡¿?\s]+$/g, '');
        let resultado = 'Respondió por WhatsApp';
        if (/^(si|sii+|claro|ok|va|me interesa)$/.test(limpio)) { sets.push('estatus_contacto = :ec'); vals[':ec'] = 'se_queda'; resultado = 'Respondió SÍ (quiere el soporte)'; }
        else if (/^(no|nop|no gracias|no me interesa)$/.test(limpio)) { sets.push('estatus_contacto = :ec'); vals[':ec'] = 'no_interesado'; resultado = 'Respondió NO (no quiere el soporte)'; }
        else if ((chofer.estatus_contacto || 'pendiente') === 'pendiente' || chofer.estatus_contacto === 'contactado' || chofer.estatus_contacto === 'sin_respuesta') { sets.push('estatus_contacto = :ec'); vals[':ec'] = 'respondio'; }
        await db.send(new UpdateCommand({ TableName: T.choferes, Key: { id: chofer.id }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeValues: vals }));
        await registrarEvento({ id: chofer.id, usuario: { usuario: '_whatsapp', nombre: chofer.nombre || 'Chofer' }, tipo: 'whatsapp', resultado, nota: texto.slice(0, 500), extra: { nombre: chofer.nombre } });
        nuevos++;
      }
    }
    if (nuevos) await bumpVersion();
    return nuevos;
  }

  /** Maneja /api/whatsapp/* . Devuelve { raw } para respuestas que no son JSON (verificación del webhook). */
  async function ruta(event, method, path, q, user, rawBody, portalUrl) {
    if (path === '/whatsapp/webhook') {
      if (method === 'GET') {
        const ch = verificarWebhook(q, await cfg());
        if (ch === null) throw new HttpError(403, 'Token de verificación inválido');
        return { raw: ch };
      }
      if (method === 'POST') {
        const h = event.headers || {};
        if (!(await firmaValida(rawBody, h['x-hub-signature-256'] || h['X-Hub-Signature-256']))) throw new HttpError(401, 'Firma inválida');
        let body; try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, 'JSON inválido'); }
        return { recibidos: await procesarWebhook(body) };
      }
    }
    if (!user) return undefined; // las demás rutas requieren sesión (el router las vuelve a llamar con usuario)
    let b = {};
    if (rawBody) { try { b = JSON.parse(rawBody); } catch { throw new HttpError(400, 'JSON inválido'); } }
    let m;
    if (method === 'GET' && path === '/whatsapp/estado') return { ...(await estado(user, portalUrl)), enviados_hoy: await enviadosHoy(user) };
    if (method === 'PUT' && path === '/whatsapp/config') return guardarConfig(user, b);
    if (method === 'POST' && path === '/whatsapp/probar') return probar(user);
    if (method === 'POST' && path === '/whatsapp/plantillas/sincronizar') return sincronizarPlantillas(user);
    if (method === 'PUT' && path === '/whatsapp/plantillas') return mapearPlantilla(user, b);
    if (method === 'POST' && path === '/whatsapp/enviar-plantilla') return enviarPlantilla(user, b);
    if (method === 'POST' && path === '/whatsapp/enviar-texto') return enviarTexto(user, b);
    if ((m = path.match(/^\/whatsapp\/conversacion\/([^/]+)$/)) && method === 'GET') return conversacion(user, decodeURIComponent(m[1]));
    if ((m = path.match(/^\/whatsapp\/leido\/([^/]+)$/)) && method === 'POST') return marcarLeido(user, decodeURIComponent(m[1]));
    return undefined;
  }

  return { ruta, procesarWebhook, firmaValida, verificarWebhook };
}
