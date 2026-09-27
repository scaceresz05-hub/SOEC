# ADR 0036 — Captura first-party del identificador de clic en el sitio de CP

**Fecha:** 27-09-2026 · **Estado:** PREPARADO, NO DESPLEGADO · **Ámbito:** sitio de CP + SOEC

Este documento contiene el cambio EXACTO que habría que hacer en `medicion.js` y el borrador de la
modificación de la política de privacidad. **Nada de esto se ha desplegado**, y no debe desplegarse
antes de que la clínica lea el apartado 3 y decida.

---

## 1. Qué cambia y qué no

Hoy `medicion.js` emite `whatsapp_intent` con `{ event_name, channel, ref }`. Lo único que se añade es
el identificador del clic de anuncio (`gclid`) cuando la visita viene de un anuncio de Google.

**No se añade**: `gtag`, Google Tag Manager, GA4, píxel de Google, cookies de marketing, teléfono,
correo, dirección IP ni el contenido de la conversación. El archivo sigue sin dependencias y sin
cookies. El `gclid` NO se envía a Google desde el navegador: viaja al backend propio de CP, como el
resto del evento.

## 2. El parche

```js
  // ── Identificador del clic de anuncio ─────────────────────────────────────────────────────────
  /**
   * Cuando alguien llega desde un anuncio de Google, la dirección trae `gclid`. Guardarlo permite
   * saber después qué anuncio trajo a quien escribió por WhatsApp.
   *
   * `sessionStorage`, no cookie ni `localStorage`: dura lo que dura la pestaña, no viaja en cada
   * petición, no cruza subdominios y desaparece al cerrar. Es el almacenamiento más corto que
   * sobrevive a una navegación interna, que es lo único que hay que cubrir — la persona aterriza en
   * una página y pulsa el botón en otra.
   */
  var CLAVE_GCLID = 'cp_gclid';
  var GCLID_MAX = 200;

  /** Forma admisible: lo que puede viajar sin riesgo. Un valor raro viene de la barra de direcciones. */
  function gclidValido(v) {
    return typeof v === 'string' && v.length >= 10 && v.length <= GCLID_MAX && /^[A-Za-z0-9._-]+$/.test(v);
  }

  function guardarGclidSiLlega() {
    try {
      var v = new URLSearchParams(location.search).get('gclid');
      if (gclidValido(v)) sessionStorage.setItem(CLAVE_GCLID, v);
    } catch (e) {
      /* sin sessionStorage (modo privado, ajustes del navegador) simplemente no se mide el origen */
    }
  }

  function gclidGuardado() {
    try {
      var v = sessionStorage.getItem(CLAVE_GCLID);
      return gclidValido(v) ? v : null;
    } catch (e) {
      return null;
    }
  }
```

En `alPulsar`, dentro de la rama de `whatsapp_intent`, se añaden dos campos:

```js
    if (evento === 'whatsapp_intent') {
      var ref = nuevoRef();
      a.setAttribute('href', 'https://wa.me/' + TEL + '?text=' + encodeURIComponent(PLANTILLA + ref));
      cuerpo.ref = ref;
      var g = gclidGuardado();
      if (g) cuerpo.gclid = g;            // sólo si existe: sin anuncio, no hay campo
      cuerpo.ts = new Date().toISOString(); // el instante del clic, que es lo que hay que atribuir
    }
```

Y en `iniciar()`, antes de cablear el listener:

```js
      guardarGclidSiLlega();
```

**Idempotencia intacta:** sigue habiendo un único listener delegado y la guarda
`window.__cpMedicionCargado`. Un clic = un evento = un `ref`. El `gclid` no cambia eso: es un dato
más del mismo evento.

## 3. Borrador de la política de privacidad (NO PUBLICADO)

La política vigente promete que el sitio «no instala cookies de marketing, píxeles de seguimiento ni
herramientas de analítica de terceros». **Eso sigue siendo cierto con este cambio** y el borrador lo
mantiene. Lo que hay que añadir es la captura del identificador y su finalidad:

> **Medición de campañas publicitarias.** Si llegas a este sitio desde un anuncio de Google, la
> dirección incluye un identificador del clic que asigna Google (`gclid`). Ese identificador se guarda
> únicamente en tu navegador, sólo mientras dura la visita, y desaparece al cerrar la pestaña. Si
> durante esa visita pulsas un botón de contacto, ese identificador se registra junto al código
> aleatorio y la fecha y hora del contacto, con una única finalidad: saber qué anuncios generan
> contactos. **Ese dato no se envía a Google**: se usa en la herramienta de análisis comercial descrita
> más arriba, operada por SC Innovation SpA. No se registra tu nombre, tu teléfono, tu correo, tu
> dirección IP ni el contenido de tus conversaciones de WhatsApp, y no se registra ningún dato clínico.
> Este sitio sigue sin instalar cookies de marketing, píxeles de seguimiento ni herramientas de
> analítica de terceros.

**Huecos deliberados, que decide la clínica y no SOEC:**

- **Retención.** Cuánto tiempo se conserva la relación entre un contacto y su anuncio. Sugerencia
  técnica: lo que dure el piloto más el período de análisis; no hay razón para guardarla
  indefinidamente.
- **Consentimiento.** El sitio no tiene hoy ningún mecanismo de consentimiento. Para visitantes del
  EEE, Reino Unido o Suiza esto puede requerir uno; para Chile, la clínica debe decidir con su propio
  criterio. **No escribo aquí ninguna afirmación jurídica**: este texto es material para que lo revise
  quien responde por él.
- **Receptores.** Hoy el único receptor del dato es SOEC (SC Innovation SpA). Si algún día se envía la
  conversión a Google —ver ADR 0035— habrá que decirlo ANTES, y este párrafo dejará de ser exacto.

## 4. Lo que SOEC hace con eso

Cuando la intención llega con su `gclid`, SOEC pregunta a Google —por `click_view`, una consulta de
lectura— de qué campaña, grupo y palabra vino ese clic, y lo guarda en su propia base. Nada se envía
a Google como conversión.

Eso permite decir: «de los clics que trajo esta campaña, N terminaron en alguien escribiendo por
WhatsApp». **No** permite decir que Google está optimizando por contactos, porque no lo está: Google
optimiza por clics, que es lo único que recibe.
