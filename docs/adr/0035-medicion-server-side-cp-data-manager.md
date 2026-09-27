# ADR 0035 — Medición server-side de `whatsapp_intent` para CP: factibilidad con Data Manager API

**Fecha:** 27-09-2026 · **Estado:** PROPUESTA BLOQUEADA (no implementable hoy) · **Ámbito:** `org-cp-odontologia`

Documento de FACTIBILIDAD, no de implementación. Nada de lo descrito aquí está construido, y nada se
escribió en Google Ads ni en el sitio de CP para producirlo.

---

## 1. El camino legado ya no está disponible para nosotros

La documentación oficial de Google Ads API dice, sobre `ConversionUploadService.UploadClickConversions`:

> «Starting June 15, 2026, UploadClickConversion requests will fail if the developer token hasn't
> previously sent requests to upload offline conversions or enhanced conversions for leads.»
> — *Manage offline conversions*, Google Ads API. Y dirige a las integraciones nuevas: «Use the Data
> Manager API instead».

El allowlist es **por developer token** y se gana por uso previo (entre diciembre de 2025 y mayo de
2026). En SOEC no existe, ni ha existido nunca, código que llame a ese método: `git log -S` sobre
`uploadClickConversions`, `conversionUploads` y `ConversionUploadService` devuelve **cero commits** en
toda la historia del repositorio. Nuestro developer token no puede estar en ese allowlist por uso de
SOEC. Por tanto, para esta integración el camino legado se considera **NO disponible**.

## 2. Qué exige el camino nuevo (Data Manager API), verificado contra la documentación

| Requisito | Fuente | Estado en SOEC |
|---|---|---|
| Endpoint `POST https://datamanager.googleapis.com/v1/events:ingest` | *Method: events.ingest* | — |
| Scope `https://www.googleapis.com/auth/datamanager` | *Set up API access* | **NO se solicita**: el único scope de SOEC es `https://www.googleapis.com/auth/adwords` |
| API habilitada en el proyecto de Cloud | *Set up API access* | **NO habilitada** en `soec-marketing-intelligence` (23 APIs activas; Data Manager no está) |
| Verificación OAuth de la app | «Any Google Cloud app used to obtain user credentials for the Data Manager API scope must undergo Google OAuth verification» | **NO verificada**: la consola declara «Google debe verificar tu app» |
| Developer token | La documentación indica que **no** se requiere para Data Manager | n/a |

Los tres primeros son trabajo nuestro. El cuarto no depende de nosotros: lo decide Google, tras una
revisión que exige, entre otras cosas, información de contacto al día, propietarios del proyecto
correctos y —según el aviso de la propia consola— una cuenta de facturación asociada, que hoy no hay.

## 3. La forma del `Destination` para CP

Con la cuenta de CP (`8303175180`) la petición tendría esta forma. El `productDestinationId` es el
**id de la acción de conversión**, que todavía no existe: por eso este documento no lo fija.

```json
{
  "destinations": [{
    "operatingAccount": { "product": "GOOGLE_ADS", "accountId": "8303175180" },
    "productDestinationId": "<ID DE LA ACCIÓN DE CONVERSIÓN — aún no creada>"
  }],
  "events": [{
    "destinationReferences": [],
    "adIdentifiers": { "gclid": "<gclid del clic del anuncio>" },
    "eventTimestamp": "<ISO-8601 del clic de WhatsApp>",
    "transactionId": "<ref de CP: idempotencia>",
    "eventSource": "WEB",
    "consent": { "adUserData": "<sin determinar>", "adPersonalization": "<sin determinar>" }
  }],
  "validateOnly": true
}
```

`loginAccount` sólo se rellena si la credencial pertenece a un manager que tenga la cuenta como
subcuenta. La conexión de CP se autorizó con la cuenta directamente (`loginCustomerId` = el mismo
`8303175180`), así que **no haría falta**; se confirmará el día que exista la acción.

## 4. La acción de conversión que habría que crear (NO creada)

| Campo | Valor | Comprobado |
|---|---|---|
| `name` | `SOEC · CP Odontología · whatsapp_intent` | nombre estable de SOEC (idempotencia por nombre) |
| `type` | `UPLOAD_CLICKS` | enum v25: «Conversions that are tracked by the advertiser and uploaded with attributed clicks» |
| `category` | `CONTACT` | enum v25: «A call, SMS, email, chat or other type of contact to an advertiser» |
| `counting_type` | `ONE_PER_CLICK` | una intención por clic de anuncio; dos mensajes de la misma persona no son dos pacientes |
| `primary_for_goal` | `true` | es la única señal de resultado declarada por la clínica |
| `status` | `ENABLED` | |

**Corrección respecto de lo propuesto en I.9:** allí se anotó `WEBPAGE` (el valor que usa SOEC para
conversiones con etiqueta en el sitio). Para carga server-side el tipo correcto es `UPLOAD_CLICKS`, y
son incompatibles: una acción `WEBPAGE` no acepta eventos cargados. La tabla `CONFIGURACION_GOOGLE`
de `ejecucion/conversiones.ts` sólo contempla el caso con etiqueta; habría que extenderla el día que
se implemente este camino.

## 5. Flujo del evento, sin PII

```
clic en anuncio (auto-tagging ON ⇒ llega ?gclid=…)
  → medicion.js guarda el gclid en sessionStorage (first-party, misma pestaña)
  → la persona pulsa «Agendar evaluación» (a href → wa.me)
  → se emite whatsapp_intent { event_name, channel, ref, gclid, ts }
  → POST /api/growth/contact (mismo origen)  →  D1 de CP
  → puente M2M  →  SOEC  →  events.ingest (Data Manager)  →  Google Ads
```

Lo que viaja: `gclid`, marca de tiempo, `ref` y el nombre del evento. **Nada más.** No se envía
teléfono, nombre, correo, contenido de la conversación de WhatsApp, IP ni user-agent — ni hacen falta:
con `gclid` la atribución es determinista y `userData` es opcional.

**Dónde vive el `gclid` entre el aterrizaje y el clic.** `sessionStorage`, no `localStorage` ni
cookie: dura lo que dura la pestaña, no se envía en cada petición, no cruza subdominios y desaparece
al cerrar. Es el almacenamiento más corto que permite sobrevivir a una navegación interna, que es lo
único que hay que cubrir (el aterrizaje y el clic pueden ocurrir en páginas distintas del sitio). No
añade ningún script de terceros: lo hace el `medicion.js` propio de CP, que ya existe.

## 6. Idempotencia

El riesgo es doble: que el mismo clic se cargue dos veces (reintento, redespliegue, reingesta) y que
dos caminos distintos alimenten la misma conversión.

| Pieza | Decisión |
|---|---|
| Identificador del evento | el `ref` que CP ya genera en el clic (8 caracteres base-31, ~8,5·10¹¹ combinaciones). Se envía como `transactionId`, que es el campo de deduplicación de Data Manager |
| Clave única en SOEC | `(organization_id, proveedor, transaction_id)` en la tabla de cargas: la base impide la segunda inserción, no el código |
| Estado de carga | `PENDIENTE → ENVIADO → CONFIRMADO / RECHAZADO`, con el `requestId` que devuelve la respuesta guardado junto a la fila |
| Reintento seguro | sólo desde `PENDIENTE` o `RECHAZADO` recuperable; un `ENVIADO` sin confirmar se reconcilia leyendo, nunca reenviando a ciegas |
| SSOT publicitario | un único camino alimenta la conversión (`OFFLINE_IMPORT`). La medición propia de CP mide para SOEC y **no** para Google. Regla ya codificada en `riesgoDeDuplicacion` |

## 7. Consentimiento

`Consent` de Data Manager tiene `adUserData` y `adPersonalization`, ambos **opcionales**, con valores
`CONSENT_GRANTED` / `CONSENT_DENIED` / `CONSENT_STATUS_UNSPECIFIED`. Es el consentimiento de la DMA,
que aplica a personas del EEE, Reino Unido y Suiza.

El sitio de CP **no tiene hoy ningún mecanismo de consentimiento** —no hay banner, no hay cookies, no
se pregunta nada—. SOEC no puede, por tanto, determinar legítimamente si una persona concreta dio su
consentimiento: no existe el dato. Declarar `CONSENT_GRANTED` sería inventarlo.

**CONSENT_DECISION_REQUIRED.** Antes de cualquier carga, la clínica tiene que decidir qué hace con
esto —al menos para visitantes del EEE/RU/CH— y esa decisión es suya, no de SOEC ni mía.

## 8. Política de privacidad: borrador PREPARADO, NO PUBLICADO

La política vigente (15-09-2026) dice: «Este sitio no instala cookies de marketing, píxeles de
seguimiento ni herramientas de analítica de terceros» y «Si en el futuro se incorporan otras
herramientas de medición o formularios de contacto, esta política será actualizada previamente».

Data Manager **no** introduce un píxel ni un script de terceros en el navegador —eso sigue siendo
cierto— pero sí implica enviar a Google, desde el servidor, una señal publicitaria asociada al
identificador del clic. Eso hay que decirlo. Borrador mínimo para sustituir el apartado de medición:

> **Medición de campañas publicitarias.** Cuando llegas a este sitio desde un anuncio de Google, la
> dirección incluye un identificador del clic que asigna Google (`gclid`). Ese identificador se guarda
> únicamente en tu navegador y sólo mientras dura la visita, y se borra al cerrar la pestaña. Si
> durante esa visita pulsas un botón de contacto, enviamos a Google Ads, desde nuestro servidor, el
> identificador del clic, la fecha y hora, y el código aleatorio descrito más arriba, con la única
> finalidad de saber qué anuncios generan contactos. No enviamos tu nombre, tu teléfono, tu correo,
> tu dirección IP ni el contenido de tus conversaciones de WhatsApp, y no enviamos ningún dato
> clínico. Este sitio sigue sin instalar cookies de marketing, píxeles de seguimiento ni herramientas
> de analítica de terceros. Puedes ejercer tus derechos de acceso, rectificación, eliminación y
> oposición en el contacto indicado al final de esta política.

Sobre la retención y sobre el consentimiento, el borrador deja huecos a propósito: son decisiones de
la clínica, y ninguna afirmación jurídica debe escribirse aquí sin que la revise quien responde por
ella. Este texto es material para esa revisión, no un texto legal validado.

## 9. Comparación

| | A · Etiqueta de Google (gtag) | D1 · UploadClickConversions legado | D2 · Data Manager API |
|---|---|---|---|
| Disponible hoy | Sí | **No** (bloqueado desde 15-06-2026 para tokens sin historial) | Sí, pero con verificación OAuth pendiente |
| Script de terceros en el navegador | **Sí** | No | No |
| Contradice la política publicada de CP | Sí, hasta actualizarla | No en lo del píxel | No en lo del píxel; sí exige transparencia nueva |
| Atribución | Automática por cookie de Google | Determinista por `gclid` | Determinista por `gclid` |
| Consentimiento | Consent Mode en el navegador | En la carga | En la carga (`Event.consent`) |
| Idempotencia | Del lado de Google (`ONE_PER_CLICK`) | `orderId` | `transactionId` + clave única propia |
| Mantenimiento | Bajo | — | Medio: un camino de carga y su reconciliación |
| Complejidad para llegar | Baja | — | **Alta**: habilitar API, nuevo scope, nuevo consentimiento OAuth de la clínica y verificación de Google |

## 10. Conclusión

El camino técnicamente correcto y más respetuoso con lo que CP prometió públicamente es **D2 (Data
Manager API)**, y **hoy no se puede recorrer**: falta habilitar la API, pedir un scope nuevo, obtener
otra vez el consentimiento OAuth de la clínica y, sobre todo, pasar la verificación de Google, que no
depende de nosotros y no tiene plazo garantizado.

La alternativa disponible de inmediato es **A (etiqueta de Google)**, al precio de meter un script de
terceros en un sitio de salud cuya política dice hoy lo contrario, y de actualizar esa política antes.

Cuál de las dos —o esperar— es una decisión de la clínica.
