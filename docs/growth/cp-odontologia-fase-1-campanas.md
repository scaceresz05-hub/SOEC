# CP Odontología · Growth Fase 1 — campañas comerciales iniciales

Organización: `org-cp-odontologia` · Sitio: `https://www.dentistaclaudiapacheco.cl` · Fecha: 2026-09-16

Estado: **las 3 campañas están especificadas, NO persistidas.** Ningún gasto externo activado, ningún objeto
creado en Google Ads ni Meta. Ver §1.3 para el motivo exacto y la decisión que falta.

Reglas que este documento no relaja: no se inventan presupuestos, precios, volúmenes, CPC ni tasas de
conversión; la política de privacidad Growth V1 queda intacta (nunca tratamiento + lead, nunca path ni UTM
crudo ligado a un lead).

---

## 1. Modelo real de campañas en SOEC

SOEC tiene cuatro piezas con "campaña" en el nombre. Sólo una se persiste, y sólo una representa
"campaña planificada ≠ campaña publicada" — y no son la misma.

| Pieza | Qué es | ¿Persiste? | ¿Se crea por API? | Presupuesto |
|---|---|---|---|---|
| `@soec/campanias` · `Campania` | Campaña gobernada, event-sourced `campania:<org>:<id>` | Sí | Sólo vía programas (abajo) | **`monto > 0` obligatorio** |
| `@soec/programas` · `vincularCampania` | Programa de marketing del Director Autónomo | Sí | `POST /experience/director-autonomo/organizaciones/:org/programas/:id/campanias` | **`presupuestoSimulado > 0` obligatorio** |
| `@soec/adquisicion` · `CampanaAdquisicion` | Campaña provider-neutral con estado interno ≠ externo | **No (sólo tipos)** | No (`GET /acquisition/campaigns` devuelve una lista vacía fija) | `propuestoDiario/propuestoTotal: number \| null` |
| `apps/api/src/campana/campaign-plan.ts` | Plan de campaña Meta en dry-run | No (puro) | `POST /acquisition/campaign/plan` | Exige mandato de presupuesto y cuenta Meta |

### 1.1 `Campania` (`packages/campanias`)

- Estados: `BORRADOR → ACTIVA → PAUSADA | COMPLETADA | CANCELADA`.
- Campos: `objetivo, publico, propuesta, mensaje, canal (texto libre), contenidoRequerido, calendario,
  presupuesto {monto, moneda}, hipotesis[], metricas[], criterioExito, criterioPausa, nivelAutonomia,
  riesgos[]`. **No tiene URL de destino.**
- Nace SÓLO de una `DecisionMkt` de la misma organización en estado `APROBADA`
  (`POLITICA_CAMPANIA_CONSERVADORA.requiereAprobacion = true`).
- `crearDesdeDecision` rechaza `presupuesto.monto <= 0` ("el presupuesto debe ser positivo").

### 1.2 Programas (`packages/programas`) — el único camino HTTP

`vincularCampania` crea la decisión, **la transiciona sola a `APROBADA`**, y crea la `Campania` con
`metricas: ['leads_simulados/mes']` y `criterioPausa: 'CPL simulado > umbral'` fijos. El negocio corre en
`modoEjecucion: 'PILOT'` (resultados simulados).

### 1.3 Por qué no se crearon (bloqueo)

Los dos caminos persistentes exigen un presupuesto **positivo**; el brief exige presupuesto 0/null y prohíbe
inventar cifras. Además, el camino de programas aprueba su propia decisión y fija KPIs simulados que
contradicen la estructura de medición de §3.

El modelo que sí encaja (`CampanaAdquisicion`: `DRAFT`, presupuesto propuesto `null`, `destino`,
`requisitosMedicion`, `objetosExternosCreados = 0`, `sinEfectoExterno('DRAFT') === true`) existe sólo como
tipos: sin servicio, sin persistencia y sin ruta de creación. `objetivosAdmitidos` tampoco está declarado
para ninguna organización.

**Decisión que falta (del dueño), una de tres:**

1. **Completar la persistencia de `CampanaAdquisicion`** (servicio + stream + ruta de creación en `DRAFT`).
   Es el modelo diseñado para esto; no es un sistema paralelo, pero sí es desarrollo nuevo.
2. **Usar `Campania`/programas con un presupuesto que decida el dueño** (ahora mismo no hay cifra).
3. **Permitir `BORRADOR` con presupuesto 0 en `@soec/campanias`**, cambiando una invariante de gobierno
   aprobada.

Las especificaciones de §2 están escritas contra los campos reales de ambos modelos, así que cualquiera de
las tres opciones las carga sin rediseño.

---

## 2. Especificación de las 3 campañas

Campos comunes:

- `organizationId`: `org-cp-odontologia` · `businessKey`: `cp-odontologia`
- `objetivo` (`ObjetivoComercial`): `GENERATE_LEADS` — generar evaluaciones/contactos
- `estado`: `DRAFT` (`CampanaAdquisicion`) / `BORRADOR` (`Campania`)
- `presupuesto`: `{ moneda: 'CLP', propuestoDiario: null, propuestoTotal: null }` — se decide tras revisar
  canales y términos de búsqueda
- `objetosExternosCreados`: `0` · `mandatoRef`: `null` · `nivelAutonomia`: `0`
- Mensaje de contacto: el **único** mensaje de WhatsApp del sitio (`Hola, quisiera agendar una evaluación.`).
  Ninguna campaña puede tener un mensaje propio: eso codificaría el tratamiento en el contacto.

### A. `cp-implantes-curico` — "CP | Implantes | Curicó"

- `destino`: `https://www.dentistaclaudiapacheco.cl/servicios/implantes-dentales/`
- `canal` recomendado para la primera prueba: `GOOGLE_SEARCH`
- Conversión primaria `whatsapp_intent` · secundaria `phone_intent`
- Agregado de interés (anónimo, diario): `service_viewed:implantes-dentales`

### B. `cp-rehabilitacion-protesis-curico` — "CP | Rehabilitación y Prótesis | Curicó"

- Línea comercial que agrupa: coronas, puentes, prótesis removibles totales, parciales e híbrida.
- `destino` (campo único del modelo): `https://www.dentistaclaudiapacheco.cl/servicios/` — única página que
  representa la línea entera. Limitación: también enlaza implantes y carillas.
- Destinos por grupo (cuando el canal lo admita, p. ej. URL final por grupo de anuncios en Google Search):
  - `/servicios/coronas-dentales/`
  - `/servicios/puentes-dentales/`
  - `/servicios/protesis-removibles-totales/`
  - `/servicios/protesis-removibles-parciales/`
  - `/servicios/protesis-hibrida/`
- `canal` recomendado: `GOOGLE_SEARCH`
- Conversión primaria `whatsapp_intent` · secundaria `phone_intent`
- Agregados: `service_viewed:` `coronas-dentales`, `puentes-dentales`, `protesis-removibles-totales`,
  `protesis-removibles-parciales`, `protesis-hibrida`
- La clasificación "rehabilitación/prótesis" es de la CAMPAÑA. Nunca se escribe en el lead.

### C. `cp-carillas-estetica-curico` — "CP | Carillas y Estética | Curicó"

- `destino`: `https://www.dentistaclaudiapacheco.cl/servicios/carillas-dentales/`
- `canal` recomendado: `ORGANIC_INSTAGRAM` (ver §5 — pago bloqueado por hallazgo crítico)
- Conversión primaria `whatsapp_intent`
- Agregado: `service_viewed:carillas-dentales`

---

## 3. Estructura de medición (idéntica en las tres)

| Elemento | Valor |
|---|---|
| Objetivo | Generar evaluaciones/contactos (`GENERATE_LEADS`) |
| KPI primario | Contactos: `whatsapp_intent` (+ `phone_intent` como secundaria) |
| Señal de interés por línea | Suma de `service_viewed:<slug>` de la línea: agregado **anónimo diario**, sin `lead_id` |
| Atribución de canal | Categoría cerrada (`google`, `meta`, `organic`, `referral`, `direct`, `other`) |
| Nunca | tratamiento + lead · `path` · `utm_campaign` · `utm_source` crudo · `anon_id` |

**Límite estructural, por diseño y no un fallo:** SOEC **no puede** decir "este contacto vino de la campaña
Implantes". `utm_campaign` nunca sale del navegador y el mensaje de WhatsApp es idéntico en todo el sitio.
Lo que SOEC sí mide por línea es interés agregado; los contactos los mide por canal. Un conteo de contactos
por campaña sólo podrá venir, agregado, de la propia plataforma de anuncios (fuera de alcance en esta fase).

**Prerrequisito antes de cualquier gasto en Google Search:** los anuncios deben llevar `utm_source=google`
(sufijo de URL final). Sin él, un clic con sólo `gclid` llega con referrer `google.*` y `medicion.js`
(`clasificarCanal`) lo clasifica como **`organic`**: el tráfico pagado se mezclaría con el orgánico y la
prueba no sería evaluable. No requiere tocar la web.

---

## 4. Auditoría comercial de las landings

Verificado sobre producción (`www`) el 2026-09-16, en escritorio y a 375×812 (móvil), y contra el código
fuente (`app/servicios/[slug]/page.tsx`, `components/*`, `lib/services.ts`, `lib/cases.ts`).

Casos clínicos anonimizados por servicio: coronas 4 · prótesis totales 4 · puentes 2 · parciales 2 ·
implantes 1 · híbrida 1 · **carillas 0**.

### CRITICO_PARA_CONVERSION

1. **Carillas no tiene ningún caso clínico.** La landing no muestra la sección "Galería de casos".
   Carillas es un tratamiento estético y discrecional: sin prueba visual, el tráfico pagado no tiene con
   qué decidir. Bloquea la pauta pagada de la línea C. Se resuelve sólo con casos reales anonimizados de
   la consulta; no se pueden fabricar.

### MEJORA_POSTERIOR

2. **Móvil: el único CTA visible al entrar es el botón flotante de WhatsApp** (icono sin texto). El CTA de
   cabecera queda oculto en el menú, y el primer botón con texto está ~2.400–2.500 px más abajo
   (≈3 pantallas). Siempre se puede contactar en un toque, pero sin una llamada a la acción con texto.
3. **El teléfono sólo aparece en el pie** (~8.200 px en móvil). `phone_intent` es secundaria, pero para una
   clínica local la llamada es un gesto de alta intención.
4. **La profesional no aparece en el contenido de la landing**: 0 menciones de la Dra. Claudia Pacheco ni
   de su especialidad antes del pie. La credencial es la principal señal de confianza del sitio.
5. **Ubicación sólo en el pie**: sin dirección visible, mapa ni "cómo llegar" en la landing.
6. **Implantes tiene 1 caso**; los 2 casos de "coronas sobre implantes" están asignados a coronas.
7. **Línea B sin landing propia**: `/servicios/` mezcla implantes y carillas. Mitigable con URL final por
   grupo de anuncios.
8. **Carillas lleva la etiqueta "Rehabilitación oral"** (eyebrow fijo en todas las páginas de servicio),
   que no casa con una intención estética.
9. **"Agendar evaluación" abre WhatsApp**, no una agenda; hay dos botones contiguos con el mismo destino.
10. **"Fundas" es ambiguo**: el sitio llama así a las carillas ("Carillas dentales (Fundas)"), pero en
    búsqueda "funda dental" suele significar corona. Afecta a la asignación de palabras clave entre A/B y C.
11. **SEO local**: el schema `Dentist` no declara horario ni coordenadas, y `sameAs` sólo enlaza Instagram
    (sin perfil de Google Business). Sin FAQ (qué incluye la evaluación, duración, pasos).

### Lo que ya está bien

H1 y `<title>` con servicio + "Curicó"; canonical a `www`; schema `Service` con `areaServed: Curicó`;
contacto en un toque con mensaje prellenado y sin formulario; botón flotante siempre visible;
`meta viewport` correcto. Las landings A y C tienen el mensaje alineado con una búsqueda local del servicio,
así que **se pueden usar directamente como URL final de Google Search**; B, por grupo de anuncios.

---

## 5. Siguiente decisión comercial (sin presupuesto ni publicación)

| Línea | Primer canal | Por qué |
|---|---|---|
| A · Implantes | `GOOGLE_SEARCH` | Demanda activa, local y de alta consideración ("implantes dentales curicó"); landing con coincidencia exacta. Meta tendría que crear una demanda que en búsqueda ya existe. |
| B · Rehabilitación/Prótesis | `GOOGLE_SEARCH` | Búsquedas por necesidad ("placa dental", "prótesis dental", "puente dental") y la mejor prueba del sitio (13 casos entre sus subtipos). |
| C · Carillas/Estética | `ORGANIC_INSTAGRAM` | Intención visual y discrecional, pero sin un solo caso publicable (§4.1): pagar en Search o Meta ahora sería comprar tráfico que no tiene con qué convencerse. Primero, prueba orgánica en la cuenta existente; Meta después, cuando haya casos reales. |

### Google Search — grupos temáticos iniciales

Sin volúmenes, CPC ni conversiones: no hay datos reales todavía.

**A · Implantes**
- *Implantes dentales Curicó*: implantes dentales curicó · implante dental curicó
- *Reemplazo fijo de piezas perdidas*: reemplazar diente perdido · diente perdido solución fija
- *Evaluación*: evaluación implantes dentales curicó · consulta implantes dentales
- Consultas de precio ("precio implantes"): decidir aparte. El sitio no publica precios y no se inventan.

**B · Rehabilitación y Prótesis** (URL final por grupo)
- *Placas / prótesis totales*: placa dental curicó · prótesis dental curicó · dentadura postiza curicó
- *Prótesis parciales*: prótesis removible parcial · prótesis flexible · valplast curicó
- *Coronas*: corona dental curicó (ver ambigüedad de "funda", §4.10)
- *Puentes*: puente dental curicó · puente fijo dental
- *Prótesis híbrida*: prótesis híbrida curicó · dientes fijos sin placa

**C · Carillas** (para cuando haya casos)
- *Carillas Curicó*: carillas dentales curicó · carillas de cerámica curicó · diseño de sonrisa curicó

### Términos negativos obvios

- **Todas las campañas**: gratis · gratuito · curso · cursos · diplomado · capacitación · universidad ·
  estudiar · trabajo · empleo · sueldo · laboratorio dental · técnico dental · proveedor · venta ·
  mayorista · ortodoncia · brackets · invisalign · blanqueamiento (tratamientos que el sitio no ofrece) ·
  veterinario · perro · gato · mascota
- **A · Implantes** — "implante" tiene otros significados: implante mamario · implante capilar ·
  implante coclear · implante anticonceptivo · implante subdérmico
- **B · Prótesis** — "prótesis" tiene otros significados, y hay productos de consumo: prótesis de cadera ·
  de rodilla · de pierna · mamaria · ortopédica · ortopedia · adhesivo para placas · pegamento placa ·
  corega · pastillas limpiadoras
- **C · Carillas** — en Chile "carilla" también es una página de papel: carilla de texto · hoja · word ·
  cuántas palabras · formato apa; y productos de consumo: carillas removibles · carillas temporales ·
  carillas en casa · kit carillas · snap on
- **Separación A/B** (para que no compitan entre sí): "implante" / "implantes" negativo en B, **excepto**
  en el grupo de prótesis híbrida, que es sobre implantes.

Segmentación: geográfica (Curicó y alrededores) en la configuración de la campaña; nombres de otras
ciudades sólo como negativos si aparecen en los términos de búsqueda reales.
