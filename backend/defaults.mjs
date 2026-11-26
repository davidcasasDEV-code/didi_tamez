// Valores iniciales. Las plantillas y umbrales se editan después desde el portal (Administración).

export const DEFAULT_UMBRALES = {
  b_viajes_max: 70,       // B: viajes > 0 y menos de este número…
  b_caida_tsh_pct: 15,    // …o horas conectado (TSH) ≥ este % menor que la semana previa
  c_viajes_min: 70,       // C: más de este número de viajes (DiDi usa >70; el slide 5.1 decía >100)
};

// Variables disponibles: {nombre} {nombre_completo} {mi_nombre} {viajes} {viajes_prev} {horas}
// {ingreso} {docs_pendientes} {promocion} {ciudad} {estatus_didi}
export const DEFAULT_PLANTILLAS = [
  {
    id: 'bienvenida', orden: 1, categoria: 'bienvenida', nombre: 'Bienvenida · Primer contacto (Anexo D)',
    texto: `Hola, {nombre}. ¡Mucho gusto! Soy {mi_nombre} y te contacto de parte de Autos Tamez, Aliado Autorizado de DiDi.

Somos un Aliado Autorizado de DiDi ubicado en Av Ruiz Cortines #5287, en Guadalupe Nuevo Leon. Desde 17 Julio del 2026 colaboramos con DiDi para brindar atención y soporte local a los conductores de la plataforma.

Hasta el momento, hemos apoyado a más de 80 conductores, principalmente en temas de activación, orientación sobre el uso de la aplicación y recomendaciones para mejorar su productividad y generar mayores ganancias en la plataforma.

A partir de ahora, seré uno de tus puntos de contacto locales. Si tienes alguna duda o no te funciona la app o cambiaste de celular y no puedes ingresar, puedes comunicarte conmigo no tiene costo. ¡Estamos para ayudarte!

*Si NO deseas que sea parte de tu soporte*
Si no estás interesado en recibir este acompañamiento, puedes solicitar dejar de participar a través de la siguiente liga de OPT OUT:
https://d.didiglobal.com/salir`,
  },
  {
    id: 'seg_a', orden: 2, categoria: 'A', nombre: 'A · Sin viajes (lunes)',
    texto: `Hola, {nombre}. Soy {mi_nombre} de Autos Tamez, Aliado Autorizado de DiDi.

Notamos que la semana pasada no realizaste viajes. ¿Todo bien? Nos gustaría saber el motivo para poder apoyarte:
1) Tengo otro trabajo
2) No me entran viajes
3) Las tarifas
4) Los beneficios
5) Otro

Respóndeme con el número y con gusto te ayudo. 🙌`,
  },
  {
    id: 'seg_b', orden: 3, categoria: 'B', nombre: 'B · Horas a la baja (martes)',
    texto: `Hola, {nombre}. Soy {mi_nombre} de Autos Tamez, Aliado Autorizado de DiDi.

La semana pasada hiciste {viajes} viajes con {horas} h conectado. Te comparto algunas recomendaciones para aprovechar mejor tu tiempo y ganar más:
• Conéctate en horas pico (mañana 6–9 am y tarde 6–9 pm).
• Revisa el Mapa de Demanda para ubicar las zonas con más solicitudes.
• Usa "Rumbo al destino" cuando vayas a casa para tomar viajes en tu camino.
• Configura tu Zona Preferida.

¿Te gustaría que te ayude a configurarlo? Quedo al pendiente.`,
  },
  {
    id: 'seg_c', orden: 4, categoria: 'C', nombre: 'C · Alto potencial (miércoles)',
    texto: `¡Hola, {nombre}! Soy {mi_nombre} de Autos Tamez, Aliado Autorizado de DiDi.

¡Excelente semana! Hiciste {viajes} viajes. 🚗💨 Estás muy cerca de subir de nivel en DiDi Élite, que te da beneficios en gasolina, seguro y telefonía.

Con unas horas más esta semana puedes lograrlo. ¿Te gustaría que revisemos juntos cuánto te falta? También te invitamos a nuestra oficina en Av Ruiz Cortines #5287, Guadalupe, para mostrarte "Pon tu precio", el Centro de viajes y el Mapa de Demanda.`,
  },
  {
    id: 'seguimiento', orden: 5, categoria: 'seguimiento', nombre: 'Seguimiento (jueves)',
    texto: `Hola, {nombre}. Soy {mi_nombre} de Autos Tamez.

Te escribo para dar seguimiento: ¿te sirvieron las recomendaciones que te compartimos esta semana? Si tienes cualquier duda con la app, aquí estoy para apoyarte.`,
  },
  {
    id: 'documentos', orden: 6, categoria: 'documentos', nombre: 'Documentos pendientes',
    texto: `Hola, {nombre}. Soy {mi_nombre} de Autos Tamez, Aliado Autorizado de DiDi.

Vimos que tu registro en DiDi está casi listo, solo falta:
{docs_pendientes}

Puedes subirlos directamente desde la app de DiDi Conductor. Si necesitas ayuda, con gusto te apoyo por aquí o visítanos en Av Ruiz Cortines #5287, Guadalupe N.L.`,
  },
  {
    id: 'recuperacion', orden: 7, categoria: 'recuperacion', nombre: 'Recuperación · Te extrañamos',
    texto: `Hola, {nombre}. Soy {mi_nombre} de Autos Tamez, Aliado Autorizado de DiDi.

¡Te extrañamos en DiDi! Actualmente tienes disponible la promoción: {promocion}.

Si quieres volver a conectarte y necesitas ayuda (app, documentos o cambio de celular), escríbeme y te apoyo sin costo.`,
  },
];
