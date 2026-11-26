# DIDI_Choferes_Tamez · Portal de seguimiento de conductores

Portal web para **Autos Tamez (Aliado Autorizado de DiDi)**: importa los Excel semanales de DiDi, calcula los
segmentos de contacto **A / B / C**, reparte choferes entre el equipo de reclutamiento y genera mensajes de
WhatsApp listos para enviar. Todo el equipo ve en (casi) tiempo real lo que hace cada quien.

**Portal:** https://d30n1fqc5gkqe7.cloudfront.net

## Arquitectura (AWS, cuenta 164285338518, us-east-1)

```
Navegador ──https──► CloudFront (E830B0G98J1C1)
                       ├─ /*      → S3 didi-choferes-tamez-portal-164285338518 (privado, acceso solo por OAC)
                       └─ /api/*  → Lambda DIDI_Choferes_Tamez_API (Function URL, Node 22 ARM, sin dependencias)
                                      └─ DynamoDB (bajo demanda)
                                           DIDI_Choferes_Tamez_Usuarios     usuario
                                           DIDI_Choferes_Tamez_Choferes     id (ID DiDi o CURP-<curp> si aún no tiene ID)
                                           DIDI_Choferes_Tamez_Semanas      semana + id  (métricas; solo 3 semanas)
                                           DIDI_Choferes_Tamez_Seguimiento  id + ts, GSI Feed (actividad del equipo)
                                           DIDI_Choferes_Tamez_Plantillas   id
                                           DIDI_Choferes_Tamez_Config       clave (jwt_secret, umbrales, version, importaciones)
```

* **Sin servidores encendidos**: todo es pago por uso → con este volumen queda dentro de la capa gratuita (≈ $0–1 USD/mes).
* **Tiempo real**: cada navegador consulta `/api/version` cada 20 s (1 lectura); solo si cambió algo descarga los datos.
* **Seguridad**: contraseñas con scrypt, sesión JWT de 12 h, bucket privado, rol IAM con acceso solo a las tablas del proyecto,
  PITR (respaldo continuo 35 días) en Usuarios/Choferes/Seguimiento/Plantillas.
* Todos los recursos llevan la etiqueta `Proyecto=DIDI_Choferes_Tamez`.

## Reglas de negocio

| Segmento | Criterio (editable en Administración) | Plan |
|---|---|---|
| **A · Sin viajes** | viajes = 0 en su última semana | Lun mensaje · Mar llamada · Jue seguimiento |
| **B · Horas a la baja** | viajes > 0 y (viajes < 70 **o** TSH ≥ 15 % menor que la semana previa) | Mar recomendación · Jue seguimiento |
| **C · Alto potencial** | viajes > 70 (como en el Excel de DiDi) | Mié impulsar |

Un solo segmento por conductor (A > B > C). Solo aplica a choferes en operación (lista de asignados o productividad) y no bloqueados.
**Depuración:** al importar se conservan las 3 semanas más recientes; cualquier semana más antigua se borra de `Semanas`
(los choferes, sus asignaciones e historial de contactos se conservan).

## Secciones

* **Asignaciones**: SOLO la lista semanal de conductores asignados que manda DiDi (los 300). Selección por renglón del
  Excel ("del 1 al 150") para repartir, bienvenida + Anexo D marcada una sola vez, y exportación **Formato DiDi (semana)**
  con *Contactado o no?* y Lunes–Viernes llenos desde el historial.
* **Reclutamiento**: la base de reclutas del equipo en tres partes: *Esperando estatus*, *Conduciendo* (primer viaje / activo / comeback / marcado en su Excel) y *En DiDi sin reclutador*. Fuentes: Conversión, Productividad, Recuperación del Dashboard DiDi + Excel propio del equipo (hojas "esperando status"/"conduciendo", importable; empata por CURP/celular, idempotente) con quién los reclutó, documentos,
  y **activados por reclutador** (para pago). Activado = primer viaje; la semana es la de la fecha de primer viaje de DiDi.
  Las altas manuales usan id `CURP-…`/`TEL-…` y se **fusionan** solas cuando DiDi manda a esa persona con su ID
  (empate por CURP o celular; se heredan reclutador, notas, asignación e historial). Solo el admin cambia "reclutado por".
* **Permisos**: el reclutador solo ve en Asignaciones (y en Inicio/Actividad) los choferes que tiene asignados; el servidor ni siquiera le envía los demás y bloquea ver o registrar contactos de choferes ajenos. La base de Reclutamiento la ve todo el equipo. Solo el administrador asigna/reparte.
* **Anexo D**: se sube en Administración (S3 `docs/`, URL con versión) y entra en la bienvenida con `{liga_anexo_d}`.

## Excel soportados (se detectan solos)

* `【AutoTamez】La lista de conductores asignados.xlsx` → semana = `semana_evaluacion`; columnas Lunes–Viernes se guardan como nota.
* `Dashboard V2.0 _ [Autos Tamez] _ W[NN].xlsx` → hojas General (KPIs), Conversión (documentos), Productividad, Recuperación; semana = `W[NN]`.

## Operación

```bash
# Infraestructura (idempotente) + código de la Lambda
AWS_PROFILE=didi-tamez bash infra/setup.sh
# Publicar el portal (y la Lambda con "api")
AWS_PROFILE=didi-tamez bash infra/deploy.sh [api]
```

Las salidas (bucket, distribución, URL) quedan en `infra/outputs.env`. El primer administrador se crea con
`POST /api/setup` (solo funciona mientras no exista ningún usuario); los demás se dan de alta desde **Administración**.

## Estructura

```
backend/   index.mjs (API), defaults.mjs (plantillas y umbrales iniciales)
web/       index.html, css/, js/ (app, api, logic, importer, util, views/*)
infra/     setup.sh (crea todo en AWS), deploy.sh (publica)
```
