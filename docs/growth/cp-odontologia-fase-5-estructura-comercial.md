# CP Odontología · Growth fase 5 — estructura comercial preparada (sin gasto)

Fecha: 2026-09-16. Estado: **preparada, no activada**. Sin cuenta Google Ads de CP, sin campañas
externas, sin presupuesto y sin KPIs simulados.

Especificaciones versionadas (las valida `apps/api/test/cp-estructura-comercial-fase-5.test.ts`):

- `docs/growth/cp-odontologia-borradores.json` — las 4 líneas en SOEC.
- `docs/growth/cp-odontologia-google-search.json` — la arquitectura Google Search.

## 1. SOEC — 4 líneas en BORRADOR

| Borrador SOEC | Canal | Presupuesto | Landing |
|---|---|---|---|
| CP \| Implantes \| Provincia de Curicó | `GOOGLE_SEARCH` | null | `/servicios/implantes-dentales/` |
| CP \| Rehabilitación y Prótesis \| Provincia de Curicó | `GOOGLE_SEARCH` | null | `/servicios/` + una por grupo |
| CP \| Carillas y Estética \| Provincia de Curicó | `ORGANIC_INSTAGRAM` | null | `/servicios/carillas-dentales/` |
| CP \| Odontología General \| Provincia de Curicó | `GOOGLE_SEARCH` | null | `/odontologia-general/` |

Las tres primeras (Growth 1.1) no se modifican. La cuarta se crea con el mismo flujo gobernado
(`POST /campanias/borradores`): decisión `NO_EVALUABLE`, activación bloqueada mientras el presupuesto sea null.

## 2. Alcance

- **Comercial (SOEC): Provincia de Curicó, 9/9 comunas** — Curicó, Teno, Romeral, Rauco, Molina,
  Sagrada Familia, Hualañé, Licantén, Vichuquén. Es lo que declaran los 4 borradores y lo que SOEC exige.
- **Ejecutable en Google Ads: 6/9** — Curicó, Molina, Teno, Sagrada Familia, Rauco, Licantén, con criterio
  de presencia. Romeral, Hualañé y Vichuquén **no se segmentan** en Google Ads: no tienen una unidad
  geográfica utilizable sin ampliar deliberadamente fuera de la provincia. Siguen dentro del alcance
  comercial. Nunca se usa una unidad mayor (provincia, región, país, radio) para cubrirlas.

La regla vive en `apps/api/src/plataforma/negocios/org-cp-odontologia-google-ads.ts`
(`validarSegmentacionGoogleAdsCp`, módulo puro sin uso en runtime todavía).

**Fase 5.1:** el requisito histórico «segmentación de Google Ads por las 9 comunas» de los tres borradores
de Growth 1.1 (y la redacción ambigua del cuarto) se reemplazó en producción por el texto canónico
`REQUISITO_GEO_GOOGLE_ADS_CP`, mediante `PATCH /campanias/:id/borrador` (evento de actualización, versión 2).
Nada más cambió en los borradores.

## 3. Google Ads — una sola campaña Search

**CP | Search | Provincia de Curicó** — presupuesto compartido (null hasta decisión del dueño), sólo red
de búsqueda de Google. No se crean cuatro campañas independientes: el volumen local no lo sostiene.

| Grupo | Borrador SOEC | URL(s) final(es) |
|---|---|---|
| AG1 · Odontología General | `cp-odontologia-general-provincia-curico` | `/odontologia-general/` |
| AG2 · Implantes | `cp-implantes-provincia-curico` | `/servicios/implantes-dentales/` |
| AG3 · Prótesis | `cp-rehabilitacion-protesis-provincia-curico` | `/servicios/protesis-removibles-totales/` · `/servicios/protesis-removibles-parciales/` · `/servicios/protesis-hibrida/` (según anuncio) |
| AG4 · Coronas / Puentes | `cp-rehabilitacion-protesis-provincia-curico` | `/servicios/coronas-dentales/` · `/servicios/puentes-dentales/` (según anuncio) |

Todas las URLs finales en `https://www.dentistaclaudiapacheco.cl` con barra final y `?utm_source=google`.

**Carillas: pauta pagada NO por ahora** (sin casos clínicos reales de carillas). Se mantiene orgánico.

### AG1 · Odontología General

Prestaciones confirmadas: evaluación general · limpieza / destartraje · obturaciones por caries ·
extracciones · endodoncia · urgencias dentales · tratamiento de encías · blanqueamiento · odontopediatría ·
radiografías. Modalidad: atención particular y seguro dental. **No Fonasa.**

- Keywords: dentista curico · clinica dental curico · centro dental curico · mejores dentistas en curico ·
  odontologia general curico.
- Retiradas del targeting positivo: dentista curico fonasa · dentista fonasa curico.
- «mejores dentistas en curico» se admite como búsqueda; ningún anuncio dice «mejor», «número 1» ni similar.

### Keywords de AG2–AG4

Las de `cp-odontologia-fase-1-campanas.md` §5, sin cambios, repartidas en los grupos de la tabla.

### Negativas

- **Campaña**: fonasa · bono fonasa · dentista fonasa · dental fonasa, más las genéricas de fase 1 §5
  (cursos, empleo, proveedores, ortodoncia/brackets/invisalign, mascotas…).
- **Corrección respecto de fase 1:** «blanqueamiento» ya **no** es negativa: ahora es prestación confirmada
  de odontología general.
- **Grupo**: los significados ajenos de «implante» (AG2) y de «prótesis/placa» (AG3), de fase 1 §5.
- **Separación entre grupos** dentro de la campaña compartida: AG1 excluye los términos temáticos de
  AG2–AG4 y «carillas»; AG4 excluye «implante(s)». AG3 no excluye «implante» porque incluye la prótesis
  híbrida, que es sobre implantes.

## 4. Medición y privacidad (sin cambios)

- Contactos: `whatsapp_intent` y `phone_intent`, con el mensaje genérico
  «Hola, quisiera agendar una evaluación. Ref: XXXXXXXX».
- Interés por servicio: `service_viewed:<slug>` sólo como agregado anónimo diario (8 slugs, incluido
  `odontologia-general`).
- Hacia SOEC sólo viaja el canal normalizado (`google` desde `utm_source=google`). **No** se incorporan
  `utm_campaign`, `utm_content`, `gclid`, keyword ni término de búsqueda.

## 5. Pendiente para activar (decisiones del dueño)

1. Cuenta Google Ads de CP y facturación.
2. Presupuesto compartido de la campaña (hoy null en SOEC y en la arquitectura).
3. Criterios de éxito y pausa con una línea base real.
