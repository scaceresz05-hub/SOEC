# Director de Marketing Autónomo V1 — Revisión de Merge

**Rama:** `feat/director-marketing-autonomo-v1` → `main`
**Base:** `main` = `origin/main` = `938dd54` (intacto)
**Fecha de la revisión:** 2026-07-30

## Alcance de la V1

Director de Marketing Autónomo **V1 integrado, con ejecución simulada y sin acciones externas
reales**. Introduce el núcleo del ciclo de marketing autónomo gobernado (Bloques A–J) **y lo
cablea al runtime existente** (API + Web + PostgreSQL vía el `EventStore` inyectado). No es una
plataforma de producción con canales reales: es una V1 controlada y auditable.

## Qué integra

- **Núcleo (paquetes, Bloques A–J):** `@soec/negocio`, `@soec/decisiones-mkt`, `@soec/campanias`,
  `@soec/contenido-gobernado`, `@soec/ejecucion-simulada`, extensión de `@soec/medicion`
  (`resultado-campania`), `@soec/aprendizaje`, `@soec/autonomia`, `@soec/director-workspace`,
  `@soec/piloto-director-v1`. Todos event-sourced, deterministas, acotados por organización.
- **Runtime:** experiencia `apps/api/src/director-autonomo-experience.ts` + rutas; página
  `apps/web/app/director-autonomo/page.tsx` + proxy + navegación. Persistencia sobre el
  `EventStore` real de la app.

## Qué permanece simulado (no real)

- La **ejecución de canal** es simulada (`@soec/ejecucion-simulada`): no hay publicación real,
  ni SDK, ni credenciales, ni gasto.
- Las **métricas y el ROI** de una campaña ejecutada de forma simulada se clasifican `SIMULADO`,
  **nunca `REAL`**. La UI lo rotula «ilustrativo, NO real».
- El botón **«Ejecutar ciclo»** corre un **escenario de demostración con datos sintéticos** e
  identificadores deterministas por organización; está etiquetado como tal en la interfaz.

## Rutas nuevas

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/experience/director-autonomo/estado?org=` | Vista del ciclo reconstruida read-only |
| POST | `/experience/director-autonomo/ejecutar-ciclo` | Corre y persiste el ciclo (idempotente) |
| POST | `/experience/director-autonomo/pausar` | Modo seguro (PAUSA) |
| POST | `/experience/director-autonomo/reanudar` | Reanuda (exige actor humano) |

Proxy web: `apps/web/app/api/director-autonomo/[accion]/route.ts`.

## Pantalla nueva

`/director-autonomo`: organización activa, nivel de autonomía, modo seguro, objetivo,
justificación, evaluabilidad, decisión, pendientes, ejecuciones simuladas, bloqueos, resultado
(ROI con su naturaleza), aprendizajes y próxima recomendación. Cada dato lleva un badge
`REAL / SIMULADO / ESTIMADO / DESCONOCIDO`.

## Persistencia

- **Sin migraciones nuevas:** el núcleo usa la tabla `events` compartida vía `EventStore`. Una
  base existente arranca sin cambios de esquema.
- Verificada empíricamente contra PostgreSQL: el ciclo persiste y **se reconstruye tras reiniciar
  API y Web** (objetivo/decisión REAL, ROI SIMULADO, ejecución, PAUSA persistida).
- **Aislamiento por organización** en escritura y lectura (streams `…:<org>:…`); una organización
  no ve el ciclo de otra.
- Los reducers ignoran eventos desconocidos (no derriban el runtime).

## Seguridad

- Toda acción con efecto requiere **autorización** (`@soec/autonomia`); la **PAUSA prevalece**
  sobre aprobaciones previas; **SOEC no eleva su propia autonomía**; **reanudar exige actor
  humano** y deja traza (evento `autonomia.reanudado`).
- Validación de entrada: sin organización → 400; reanudar sin actor → 400; método/acción
  incorrectos → 404.
- Errores de dominio mapeados a 4xx (separación → 403; entrada/estado/transición inválidos →
  422); **ejecutar el ciclo en PAUSA → 422** (respuesta gobernada, no 500).
- Los errores no filtran información sensible (`{error, message}` con descripciones de dominio;
  no clasificados → `InternalError` sin stack).
- **La rama no introduce secretos** (los tokens `emu-*-dev` son fixtures pre-existentes en `main`).
- **Ninguna acción externa real.**

## Pruebas ejecutadas

| Gate | Comando | Resultado |
|---|---|---|
| Suite completa | `pnpm verify` | **exit 0** — 120 archivos / 632 tests (con PostgreSQL) |
| Build web | `pnpm -C apps/web build` | **exit 0** |
| Piloto reproducible | `pnpm -C packages/piloto-director-v1 piloto` | **exit 0** — ROI SIMULADO |
| Pre-flight | `pnpm piloto:check` | **APTO**, exit 0 |
| Idempotencia | ejecutar ciclo ×2 | 201 + 201, mismos ids, una sola ejecución |
| Reinicio | matar y relanzar API/Web | estado reconstruido desde PG; PAUSA persiste; sin re-ejecución |
| Dos organizaciones | navegador | estado aislado por organización; sin errores de consola |
| PAUSA | ejecutar en org pausada | 422 gobernado |

## Limitaciones

1. **Datos de demostración sintéticos:** el ciclo usa una fixture (nombres tipo
   `obj-smileflow-…`) igual para cualquier organización; está etiquetado como demo, no como dato
   real de la organización.
2. **Identificadores deterministas por organización** (`d1`, `camp1`, `cont1`, …): una
   organización sostiene **un** ciclo demo. No es el modelo definitivo de múltiples campañas.
3. **Sin proyección/índice de enumeración:** no se pueden listar múltiples campañas/decisiones
   por organización; la lectura reconstruye por ids fijos.
4. Canales, credenciales e integraciones **siguen simulados**.

## Riesgos conocidos

- Los identificadores deterministas **no deben convertirse silenciosamente** en el modelo
  multi-campaña; requerirán proyección + ids generados antes de escalar.
- La demo comparte fixture entre organizaciones; si se conectara a datos reales sin cambiar esto,
  se mezclaría contenido demostrativo con el de la organización.

## Rollback

Puramente aditivo: 19 commits sobre `938dd54`, sin migraciones ni cambios de esquema. Revertir =
`git reset`/descartar la rama; `main` no fue tocado y la base existente no requiere reparación.

## Próximos bloques excluidos (fuera de esta V1)

- Proyección/índice para múltiples campañas y decisiones por organización.
- Datos reales por organización (reemplazo de la fixture de demostración).
- Integración de canales reales, credenciales y atribución productiva (decisión humana previa).
