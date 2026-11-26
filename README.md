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
| **C · Alto potencial** | viajes > 100 | Mié impulsar |

Un solo segmento por conductor (A > B > C). Solo aplica a choferes en operación (lista de asignados o productividad) y no bloqueados.
**Depuración:** al importar se conservan las 3 semanas más recientes; cualquier semana más antigua se borra de `Semanas`
(los choferes, sus asignaciones e historial de contactos se conservan).

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
