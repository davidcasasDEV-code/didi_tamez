# Alta de WhatsApp Business API (oficial de Meta) — paso a paso

Para: Autos Tamez · Portal de choferes
Objetivo: mandar desde el portal ~100 mensajes al día con plantillas aprobadas por Meta, sin riesgo de bloqueo, y recibir las respuestas en la bandeja del portal.

> Estos pasos los hace el dueño del negocio (Jorge) con sus datos y documentos. Los nombres de los botones en Meta pueden variar un poco; si algo no coincide, mándame captura.

---

## Antes de empezar, tener a la mano

- [ ] **Un número nuevo (chip)** solo para esto. **No debe estar registrado en WhatsApp ni en WhatsApp Business.** Si ya lo usaron en la app, hay que borrar la cuenta en la app primero (Ajustes → Cuenta → Eliminar cuenta). Debe poder recibir **SMS o llamada** para el código.
- [ ] **Cuenta personal de Facebook** de Jorge (es la que administra; no se publica nada en ella).
- [ ] **Documentos del negocio**: Constancia de Situación Fiscal (SAT) y un comprobante de domicilio o recibo a nombre del negocio o de la persona física con actividad empresarial. Que el nombre y la dirección coincidan exactamente con lo que se capture en Meta.
- [ ] **Página de Facebook** de Autos Tamez (si no tienen, se crea en 5 minutos) y, si tienen, sitio web.
- [ ] **Tarjeta de crédito o débito** para el cobro por mensaje.
- [ ] Un **correo del negocio** al que tengan acceso.

---

## Paso 1 · Crear el portafolio comercial (Meta Business)

1. Entrar a **business.facebook.com** con el Facebook de Jorge.
2. **Crear cuenta / portafolio comercial**: nombre del negocio **Autos Tamez**, nombre de Jorge y correo del negocio.
3. En **Configuración → Información del negocio** capturar: razón social (tal como aparece en el SAT), dirección, teléfono y sitio web o página de Facebook.

## Paso 2 · Verificar el negocio

1. En **Configuración → Centro de seguridad** (o "Verificación del negocio") → **Iniciar verificación**.
2. Subir la **Constancia de Situación Fiscal** y el comprobante de domicilio.
3. Confirmar con el código que Meta manda por correo, SMS o llamada.
4. Tarda de **unos días a 2 semanas**. Mientras tanto se puede avanzar con los pasos 3 a 5.

## Paso 3 · Crear la app y agregar WhatsApp

1. Entrar a **developers.facebook.com** → **Mis apps** → **Crear app**.
2. Caso de uso: **"Conectarse con clientes a través de WhatsApp"** (o "Otro" → tipo **Negocio**).
3. Nombre de la app: **Choferes Tamez**. Ligarla al portafolio **Autos Tamez**.
4. Agregar el producto **WhatsApp**. Meta crea la **cuenta de WhatsApp Business (WABA)** y un número de prueba.
5. En **Configuración de la app → Básica**:
   - **URL de la política de privacidad**: `https://d30n1fqc5gkqe7.cloudfront.net/privacidad.html` (la publico yo en el portal).
   - Ícono: el logo de Autos Tamez.
   - Copiar la **Clave secreta de la app** (App Secret): se captura en el portal en el paso 8.
6. Poner la app en modo **Publicado / Live** (necesario para recibir las respuestas de los choferes).

## Paso 4 · Registrar el número nuevo

1. En la app → **WhatsApp → Configuración de la API** → **Agregar número de teléfono**.
2. **Nombre para mostrar**: **Autos Tamez** (así lo ve el chofer). Categoría: *Automotriz* o *Servicios profesionales*. Descripción corta: "Aliado Autorizado de DiDi en Guadalupe, N.L. Soporte a conductores."
3. Verificar el número con el código por SMS o llamada.
4. Meta revisa el nombre para mostrar (horas a 1–2 días).
5. Anotar el **Identificador del número de teléfono** (Phone number ID) y el **Identificador de la cuenta de WhatsApp Business** (WABA ID). Se ven en esa misma pantalla.

## Paso 5 · Método de pago

1. **business.facebook.com → Configuración → Cuentas de WhatsApp** → seleccionar la cuenta → **Configuración de pagos / Facturación**.
2. Agregar la tarjeta, moneda (MXN o USD) y zona horaria **America/Monterrey**.
3. Meta cobra **por mensaje enviado con plantilla**. Las respuestas dentro de las 24 h después de que el chofer escribe no tienen costo. Revisar la tabla de precios de Meta para México.

## Paso 6 · Usuario del sistema y token permanente (para que el portal pueda enviar)

1. **business.facebook.com → Configuración → Usuarios → Usuarios del sistema → Agregar**.
   Nombre: `portal-choferes`, rol **Administrador**.
2. **Asignar activos**: la app **Choferes Tamez** (control total) y la **cuenta de WhatsApp** (control total).
3. **Generar token**: elegir la app, vigencia **Nunca**, permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. **Copiar el token. NO mandarlo por WhatsApp, correo ni chat.** Se pega directo en el portal (paso 8).

## Paso 7 · Plantillas de mensaje (las aprueba Meta)

En **WhatsApp Manager → Plantillas de mensajes → Crear plantilla**. Idioma **Español (MEX)**. Las variables se escriben `{{1}}`, `{{2}}`…

Sugeridas (categoría **Marketing**, salvo que se indique):

| Nombre (en minúsculas) | Texto |
|---|---|
| `bienvenida_corta` | Hola {{1}}, soy {{2}} de Autos Tamez, Aliado Autorizado de DiDi en Guadalupe, N.L. Te ofrecemos soporte gratuito con la app (activación, cambio de celular, ganancias). ¿Te interesa? Responde SI o NO. |
| `seguimiento_viajes` | Hola {{1}}, soy {{2}} de Autos Tamez. {{3}} ¿Todo bien? Responde a este mensaje y con gusto te apoyamos. |
| `documentos_pendientes` | Hola {{1}}, soy {{2}} de Autos Tamez. Para completar tu registro en DiDi solo falta: {{3}}. Puedes subirlo desde la app; si necesitas ayuda, responde este mensaje. |

- Agregar ejemplos para cada variable cuando Meta los pida (ej. {{1}} = Juan, {{2}} = Karime).
- El **texto largo de bienvenida con el Anexo D** ya no va como plantilla: se manda **cuando el chofer contesta SI** (dentro de las 24 h es mensaje libre y gratis).
- Se puede agregar un botón de respuesta rápida "SI" / "NO" en `bienvenida_corta`.

## Paso 8 · Conectar con el portal (lo hacemos juntos)

En el portal: **Administración → WhatsApp Business API**:
1. Pegar **Phone number ID**, **WABA ID**, **Token** (paso 6) y **App Secret** (paso 3). El token y el secreto se guardan cifrados en AWS y no se vuelven a mostrar.
2. El portal muestra la **URL del webhook** y el **token de verificación**. Ponerlos en la app de Meta: **WhatsApp → Configuración → Webhook → Editar**, y suscribir el campo **messages**.
3. Botón **Probar conexión**.
4. Ligar cada plantilla aprobada con los datos del chofer ({{1}} = nombre, {{2}} = quien envía, etc.).

---

## Reglas para no perder la cuenta

- Solo escribir a choferes que tengan relación con Autos Tamez / DiDi y **respetar a quien conteste NO** (el portal lo marca y deja de sugerirlo).
- Si muchos bloquean o reportan, Meta baja la **calidad** del número y reduce el límite diario. Mensajes cortos, útiles y personalizados.
- Límite inicial: alrededor de **250 conversaciones nuevas al día** por número; sube solo con buena calidad y el negocio verificado. Las ~100 diarias caben desde el inicio.

## Qué me tienen que confirmar cuando terminen

- [ ] Negocio verificado (o en revisión)
- [ ] Número registrado y nombre "Autos Tamez" aprobado
- [ ] Método de pago agregado
- [ ] Token del usuario del sistema generado (se pega en el portal, no se manda)
- [ ] Plantillas creadas y su estado (aprobada / en revisión)
