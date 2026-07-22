# MASTER STATUS — SOEC

> Estado vivo del proyecto. Es el primer archivo a leer al retomar el trabajo. Se actualiza al cerrar cada bloque.

**Fase actual:** 🔨 **FASE 1 — DESARROLLO (iniciada por Directiva Operacional, 2026-07-19).** Fase 0 cerrada; Biblioteca Maestra 19/19 es la autoridad. Rol de Claude: **Arquitecto de Implementación** — bloques grandes, autónomo, se detiene solo en los 6 casos de la Directiva. **Git activo** (rama `main`; basal `cdfa754`).

**Modo de trabajo Fase 1:** avanzar en el mayor bloque seguro; no pedir validación cuando haya evidencia objetiva (compilar, probar, verificar conformidad #15); la implementación no modifica la arquitectura; toda decisión técnica deriva de la Biblioteca, declara su nivel A/B/C y mantiene trazabilidad. Detenerse solo por: (1) modificar la Biblioteca · (2) contradicción estructural · (3) decisión estratégica de negocio · (4) alternativas equivalentes de alto impacto · (5) riesgo a datos/producción · (6) acción externa no automatizable (credenciales, pagos, licencias…).

## ✅ BLOQUE F2-MET-01 (Medición, Atribución y Optimización Autónoma) — CERRADO Y VERIFICADO (2026-07-21)

Quinta vertical del Departamento de Marketing Autónomo: **cierra el lazo** observar → decidir → ajustar. SOEC ingiere métricas de una fuente proveedor-independiente, las normaliza y evalúa, atribuye con cautela, detecta anomalías, evalúa el objetivo y **propone optimizaciones** que —tras autorización— cambian el plan de forma **versionada**. Paquete `@soec/medicion` + extensión de métricas del proveedor emulado; ADR-0013. Sin gasto ni datos reales.

**Integración, no motor paralelo (§3):** Canales → Observaciones → Medición → Evaluación → Planificador → Autorización → Ejecución. El módulo observa, normaliza, calcula, atribuye con cautela y **propone**; no publica, no gasta, no ejecuta adaptadores, no modifica el plan en silencio, no inventa causalidad, no aumenta su autonomía (pruebas arquitectónicas).

**Ingesta proveedor-independiente (§8, §9):** puerto `MetricsSource` reemplazable; implementación **emulada por HTTP** (frontera de red real hacia la API de métricas del proveedor emulado, extendido con `GET /v1/posts/:id/metrics`, `GET /v1/metrics`, `POST /v1/metrics/scenario`, `POST /v1/conversions`) y **simulada** (sin red); reanudación por cursor. El proveedor emulado sigue **aislado**.

**Distinciones críticas:** **observación ╪ atribución ╪ inferencia** (una conversión con identificador de campaña se atribuye; sin identificador es inferencia, nunca conversión confirmada; la coincidencia temporal no es causalidad). **La ausencia de datos no es fracaso** (se distingue «sin datos»/«evidencia insuficiente» de «bajo umbral»; umbrales deterministas declarados, sin significancia estadística inventada). **Normalización sin pérdida** (vocabulario canónico, dato original + versión del mapper + tasa de cambio explícita; sin conversiones silenciosas) y **deduplicación que conserva la corrección** (mayor secuencia del proveedor) descartando el duplicado exacto; datos tardíos reevalúan sin duplicar. **Indicadores deterministas** versionados (sin LLM; división por cero → no calculable). **Anomalías** (gasto superior al autorizado, tasa imposible, conversiones cero con gasto, datos que retroceden) que **bloquean el escalamiento**.

**Optimización autorizada y versionada (§16–§25):** motor determinista → decisión explicable (mantener/esperar/pausar/escalar/replanificar) con evidencia mínima, riesgo y reversibilidad. La decisión **propone**; su efecto pasa por el **motor de autorización operacional** (única puerta al efecto) y se aplica como **cambio versionado del plan** por el contrato público `PlanningService.aplicarOptimizacion`. **El escalamiento requiere aprobación** (no automático); una anomalía de gasto lo bloquea. Experimentos A/B con reglas deterministas (no declara ganador sin el mínimo de observaciones).

**Resultados exactos (2026-07-21):** `pnpm -r typecheck` OK (18 workspaces, incl. `@soec/medicion`) · `pnpm lint` limpio · backend `pnpm test` **393 passed (74 files)** — nuevos: medición dominio 8 · integración 8 (piloto A–H) · arquitectura 6 · ingesta 3 (contra el emulador por **HTTP real**) · pg 4 (Postgres real) · api 2 = **31** · web `pnpm -C apps/web test` **6 passed** · `next build` ✓. Migración desde **base recién creada** `0001…0010` (nuevo `0010_medicion_projection`); contenedores `ssr_*` intactos.

**Validación visual real (app viva, cadena real en PostgreSQL):** «Medición y optimización» en lenguaje de **trabajo**. Escenario **bajo desempeño**: «SOEC evaluó 3 decisión(es): **3 aplicada(s)**, 0 denegada(s)» — blog/linkedin/correo → `bajo_umbral`, evidencia `alta`, conv `0.0%`, atribución `observacion`, anomalía `conversiones_cero_con_gasto` → **pausar_actividad aplicada** (Caso C). Escenario **alto desempeño**: «**0 aplicada(s), 3 denegada(s)**» — → `sobre_objetivo`, conv `8.0%` → **denegada: escalamiento requiere aprobación humana explícita** (Caso D). Casos A/B/E/F/G/H probados en la suite de integración. (Capturas raster siguen excediendo el timeout del entorno; validación por texto de la app viva, no PNG.)

**Siguiente nodo habilitado:** F2-CTRL-01 (centro de control del departamento) → F2-PILOT-01 (piloto real acotado). El **primer efecto externo real** sigue siendo causal de parada hasta definir empresa/plataforma/cuenta/contenido/presupuesto/nivel/pausa/ventana/criterios.

**Deuda técnica / límites:** datos y proveedores **sintéticos/emulados** (sin métricas reales, sin gasto real); atribución inicial conservadora (directa/last-touch/first-touch/no-atribuida; multi-touch como contrato futuro, no algoritmo completo); umbrales y significancia por **reglas deterministas declaradas**, no estadística formal; experimentos A/B con regla de margen mínimo, no test estadístico; la reasignación de presupuesto y el scheduler temporal quedan modelados como tipos de decisión pero se refinan con el centro de control.

## ✅ BLOQUE F2-CHAN-01 (Primer Adaptador de Publicación Controlada) — CERRADO Y VERIFICADO (2026-07-21)

Cuarta vertical del Departamento de Marketing Autónomo: SOEC toma un **paquete publicable** (de la fábrica de contenido), lo autoriza por el plano operacional, lo mapea al payload de un canal y ejecuta un **ciclo de publicación CONTROLADA** (preparar → enviar → verificar → reconciliar → auditar) contra un adaptador **reemplazable**, cruzando una **frontera de red real** hacia un proveedor **EMULADO**. Paquete `@soec/canales` + proveedor emulado aislado `@soec/canal-emulado`; ADR-0012. Ningún efecto público real.

**Modos visibles y persistidos (§2):** `simulado` (sin red), `sandbox` (proveedor emulado por HTTP) y `real_desactivado` (**bloqueado por configuración, política y guardarraíl**). No existe modo `real` activable: un efecto público real es **causal de parada**.

**Frontera y aislamiento:** la publicación **no salta la autorización** (`evaluarAutorizacion` del plano operacional antes de todo envío). El efecto lo realiza un `AdaptadorCanal` proveedor-independiente (puertos publisher/verifier/reconciler/remover + capacidades), con dos implementaciones (simulado sin red; emulado por HTTP). El dominio no importa SDK; el **proveedor emulado está AISLADO** (`@soec/canal-emulado`, sin dependencias `@soec/*`) y ningún archivo de dominio lo importa (prueba arquitectónica).

**Garantías críticas:** **idempotencia externa** (clave org+paquete+canal+cuenta+huella; no reenvía si hay referencia; ante timeout/red **reconcilia** en vez de reenviar — nunca publica dos veces por una respuesta perdida); **verificación** del estado remoto (no basta un 2xx); **reconciliación** que produce hallazgos con evidencia y no sobrescribe contradicciones en silencio; **webhooks** validados por firma HMAC, deduplicados, sin replay ni regresión de estado; **credenciales por referencia** (nunca el token en eventos/logs; fixture de desarrollo; revocación); **rate limiting** con `Retry-After` y backoff con **jitter determinista**; **bloqueo por activo real faltante** cuando el canal exige imagen y solo hay especificación.

**Resultados exactos (2026-07-21):** `pnpm -r typecheck` OK (16 workspaces, incl. `@soec/canales` y `@soec/canal-emulado`) · `pnpm lint` limpio · backend `pnpm test` **362 passed (68 files)** — nuevos: canales dominio 6 · adaptador 6 (contra el emulador por **HTTP real**) · integración 8 (piloto A–G) · arquitectura 6 · pg 6 (Postgres real) · api 2 = **34** · web `pnpm -C apps/web test` **6 passed** · `next build` ✓. Migración desde **base recién creada** (`db:down -v` → `db:up` → migrate): `0001…0009` (nuevo `0009_canales_projection`); contenedores `ssr_*` intactos.

**Validación visual real (app viva en modo SANDBOX contra el emulador por HTTP):** «Publicación controlada» en lenguaje de **trabajo**, modo sandbox visible («real desactivado por guardarraíl»). «SOEC publicó 5 pieza(s): 3 verificada(s), 2 bloqueada(s) por falta de un activo real» — blog/correo/linkedin **verificada** con referencia externa del emulador (`ext-cuenta-demo-N`, `remoto published`); instagram/meta_ads **bloqueada: activo_real_faltante**; facebook sin paquete (canal no autorizado). Retiro en vivo: blog → **retirada** (el emulador eliminó el objeto). Piloto A–G (incluidos timeout+reconciliación sin duplicar, rate limit, webhook duplicado/fuera de orden, credencial revocada) probado sobre HTTP real en la suite de integración. (Capturas raster siguen excediendo el timeout del entorno; validación por texto/árbol de la app viva, no PNG.)

**Siguiente nodo habilitado:** F2-MET-01 (medición, atribución y optimización) → F2-CTRL-01 (centro de control) → F2-PILOT-01 (piloto real acotado). El **primer efecto externo real** sigue siendo causal de parada hasta definir empresa/plataforma/cuenta/contenido/presupuesto/nivel/pausa/ventana/criterios.

**Deuda técnica / límites:** publicación exclusivamente contra proveedor **emulado/simulado** (modo real desactivado por guardarraíl); credenciales **fixture** de desarrollo (sin OAuth ni rotación real); los canales que exigen imagen real quedan bloqueados porque los activos de F2-CONT-01 son **especificaciones**, no archivos (la subida de archivos reales es trabajo futuro); programación de publicaciones modelada por capacidad pero el scheduler temporal se refina con la medición; un solo proveedor emulado (los conectores reales por plataforma llegan tras la decisión estratégica de piloto).

## ✅ BLOQUE F2-CONT-01 (Fábrica Autónoma de Contenido Multicanal) — CERRADO Y VERIFICADO (2026-07-21)

Tercera vertical del Departamento de Marketing Autónomo: SOEC toma una actividad de marketing bloqueada por **contenido_faltante** y la convierte autónomamente en un **paquete publicable** versionado (brief → pieza fuente → adaptaciones por canal → activos → validación → revisión), lo entrega a la actividad (la transiciona a **autorizable**) y deja que el plano operacional lo ejecute (SIMULADO). `contenido_faltante` deja de ser deuda manual. Paquete `@soec/contenido`; ADR-0011.

**Frontera (la fábrica produce; no publica):** `@soec/contenido` depende por **contrato público** de `@soec/marketing` (leer plan/objetivo; `PlanningService.prepararActividad`) y de `@soec/operacional` (tipos de política); **nunca al revés**. La única puerta a un efecto (simulado) sigue siendo el plano operacional. La fábrica no importa adaptadores de canal, no publica, no se autoriza, no accede a SDK, no gasta presupuesto real (prueba arquitectónica).

**Modelo editorial event-sourced y versionado:** agregados **marca** (`marca:<id>`), **prompt** (`prompt:<id>`), **brief** (`brief:<id>`) y **paquete** (`paquete:<id>`, agrupa pieza+adaptaciones+activos+validaciones+revisiones+procedencia+huellas), cada uno con máquina de estados propia y transiciones validadas. Una revisión **nunca sobrescribe** una versión anterior.

**Veracidad (§6):** toda afirmación se clasifica por origen (hecho/declarada/inferencia/propuesta_creativa/no_sustentada/prohibida/dato_faltante) con fuente y confianza. Una afirmación prohibida **bloquea** la pieza; la adaptación **no eleva la certeza**; un **brief incompleto no se inventa** (queda `incompleto` con faltantes visibles y sin producción).

**Frontera generativa independiente (§9):** puerto `ProveedorGenerativo` reemplazable; proveedor por defecto **determinista** (fixture reproducible, sin credenciales ni red — **no es "IA real"**). La salida del proveedor se trata como **no confiable**: la validación del sistema es el guardarraíl. **Ningún secreto es obligatorio.** **Prompts como activos versionados** con huella determinista; se conserva qué versión produjo cada pieza.

**Validación y revisión (§14–§15):** validadores independientes producen **hallazgos** estructurados (código/severidad/ubicación/evidencia/bloqueante), no `true/false`. La **revisión automática** corrige lo corregible (añade la subcadena prohibida a `evitar`, regenera y revalida) hasta un límite; si persiste, la adaptación queda bloqueada. **Una pieza inválida nunca alcanza ejecución ni desbloquea la actividad.**

**Resultados exactos (2026-07-21):** `pnpm -r typecheck` OK (14 workspaces, incl. `@soec/contenido`) · `pnpm lint` limpio · backend `pnpm test` **328 passed (62 files)** — nuevos de contenido: dominio 5 · producción 6 · integración 8 · arquitectura 4 · pg 6 (Postgres real) · api 2 = **31** · web `pnpm -C apps/web test` **6 passed** · `next build` ✓. Migración desde **base recién creada** (`db:down -v` → `db:up` → migrate): `0001…0008` (nuevo `0008_contenido_projection`); contenedores `ssr_*` intactos; suite PG verde desde cero.

**Validación visual real (app viva, cadena real en PostgreSQL):** «Fábrica de contenido» en lenguaje de **trabajo** («SOEC produce el material… No son sugerencias: es trabajo realizado»). Piloto sintético PyME: **Caso A** blog → paquete listo → actividad **autorizable** (con adaptación, 2 activos, procedencia de afirmaciones); **Caso B** meta_ads → «Revisiones automáticas: #1 corregida» (afirmación prohibida detectada y corregida) → listo, sin versión inválida ejecutada; **Caso C** facebook (canal no autorizado) → **bloqueada**, sin entrega; **Caso E** multicanal (blog/correo/instagram/linkedin) → paquetes listos conservando semántica. «SOEC preparó contenido para 5 actividad(es) y dejó 5 lista(s)»; luego **«SOEC ejecutó act-blog-0: ejecutada (efecto simulado)»** → blog **verificada**, paquete **verificado**. (Capturas raster siguen excediendo el timeout del entorno; validación por árbol de accesibilidad de la app viva, no PNG.)

**Siguiente nodo habilitado:** F2-CHAN-01 (primer adaptador de publicación **controlada**) — el paquete publicable es el contrato que consumirá; luego F2-MET-01 (medición) → F2-CTRL-01 (centro de control) → F2-PILOT-01 (piloto real acotado). El **primer efecto externo real** sigue siendo causal de parada hasta definir empresa/plataforma/cuenta/contenido/presupuesto/nivel/pausa/ventana/criterios.

**Deuda técnica / límites:** efectos exclusivamente **simulados** y generación **determinista** (no IA real), por decisión y guardarraíl; los activos visuales son **especificaciones** estructuradas, no imágenes/videos finales; la localización usa un glosario mínimo es→en de demostración; **presupuesto de producción** modelado como categoría separada del gasto publicitario (costo por pieza con denegación al exceder el límite), sin categoría de distribución todavía; la revisión automática corrige afirmaciones/expresiones prohibidas (otros hallazgos bloqueantes requieren intervención).

## ✅ BLOQUE F2-MKT-01 (Modelo Operativo y Planificador Autónomo de Marketing) — CERRADO Y VERIFICADO (2026-07-21)

Segunda vertical del Departamento de Marketing Autónomo: SOEC recibe un **objetivo comercial** + contexto sintético de empresa/marca y produce un **plan operativo versionado, persistido y ejecutable** (iniciativas → campañas → actividades → calendario), del que **ejecuta** las acciones a través del plano operativo de F2-AUT-01. El resultado es **trabajo planificado**, no un documento de estrategia. Paquete `@soec/marketing`; ADR-0010.

**Frontera clave (quién propone, quién autoriza):** `@soec/marketing` **propone** (traduce objetivo+política en plan, selecciona la siguiente acción) y **nunca** publica, se autoriza a sí mismo ni produce un efecto. La única puerta a un efecto (simulado) sigue siendo `OperationalService.ejecutar` del plano operativo. Dependencia por contrato público, no invertible.

**Planificador determinista y auditable (sin LLM ni azar):** función pura de objetivo+política+opciones; mismas entradas → mismo plan; fechas derivadas de `fechaInicio`+frecuencia. Cada actividad lleva su **explicación** (por qué existe, a qué objetivo atiende, bajo qué política). **Evaluabilidad:** `validarObjetivo` bloquea planes sobre objetivos no evaluables (horizonte/frecuencia no positivos, objetivo que no supera la línea base, presupuesto negativo, faltantes) — la ausencia de información no es conclusión.

**Modelo event-sourced y versionado:** Objetivo (`obj:<id>`) y Plan (`plan:<id>`) append-only; **replanificar emite nueva versión** sin reescribir la historia, registrando diferencias. Máquinas de estado explícitas para plan y actividad, con transiciones validadas. **Dos evaluaciones en dos momentos:** el planificador pre-clasifica (`bloqueada` por canal_no_autorizado / contenido_faltante / accion_prohibida; si no, `autorizable`); el **motor de autorización** decide afirmaciones/presupuesto/nivel al **ejecutar** — por eso una actividad `autorizable` puede aún ser **denegada** (p. ej. `afirmacion_prohibida`) sin contradicción. Ejecución **idempotente** (`executionId = <planId>:<actividadId>`); plan pausado rechaza ejecutar.

**Resultados exactos (2026-07-21):** `pnpm -r typecheck` OK (13 workspaces, incl. `@soec/marketing`) · `pnpm lint` limpio · backend `pnpm test` **297 passed (56 files)** — nuevos de marketing: dominio 5 · integración 8 · arquitectura 4 · pg 6 (Postgres real) · api 2 = **25** · web `pnpm -C apps/web test` **6 passed**. Migración desde cero: `0001…0007` (nuevo `0007_marketing_projection`), contenedores `ssr_*` de otros proyectos intactos. `next build` ✓.

**Validación visual real (app viva, cadena real en PostgreSQL):** «Centro de control de marketing» con lenguaje de **trabajo** (no consejo). Sobre la estrategia sintética PyME: `blog` **autorizable → ejecutada → verificada** («efecto simulado»); `meta_ads` **autorizable → denegada: afirmacion_prohibida → omitida**; `blog_tecnico` **bloqueada: contenido_faltante**; `youtube` **bloqueada: canal_no_autorizado**. La próxima acción avanza sola a la siguiente fecha del calendario. Coincide con lo que devuelve la API real (`/marketing/ejecutar-siguiente`). Sin endpoint para publicar en real ni para saltar la autorización.

**Guardarraíles verificados:** ningún efecto externo real (`Efecto.simulado === true` por construcción del plano operativo); el planificador no importa SDK ni adaptadores de efecto real (prueba arquitectónica); ninguna acción sin política vigente que la autorice; datos exclusivamente sintéticos; sin credenciales.

**Siguiente nodo habilitado:** fábrica de contenido → adaptador de publicación **controlada** → medición → centro de control ampliado → piloto (bloques restantes de la Directiva). Publicar/gastar/enviar en real sigue siendo **causal de parada** hasta autorización explícita.

**Deuda técnica / límites:** efectos exclusivamente **simulados** (por decisión y guardarraíl); el contenido de las actividades es sintético/mínimo (la fábrica de contenido llega en el bloque siguiente); presupuesto acotado por total, aún no por ventana temporal diaria (se refina con la medición); política de selección = «más temprana autorizable» (ampliable a prioridad/ROI cuando exista medición). **Capturas raster** siguen excediendo el timeout del entorno (30s); la validación visual se hizo conduciendo la app viva (árbol de accesibilidad), no PNG.

## ✅ BLOQUE F2-AUT-01 (Departamento de Marketing Autónomo · Realineamiento + primera vertical) — CERRADO Y VERIFICADO (2026-07-21)

**Reorientación estratégica** (Directiva Maestra): SOEC pasa de comprender/orientar a **ejecutar** trabajo operativo de marketing bajo **políticas humanas vigentes**. La medida de éxito es cuánto trabajo real de marketing asume de forma segura, trazable y autónoma. Registro: `docs/decisions/reorientacion-departamento-marketing-autonomo.md`.

**Realineamiento constitucional — HECHO y registrado:** enmienda **Constitución v1.7** (Art. 2.1 y 2.4) por el circuito #8→#6→#7→#5, con la Directiva como aprobación del Propietario (Art. 8.3.c). Distingue **decisión estratégica reservada** (humana) de **acción operativa autorizada por política** (delegable). **Soberanía transformada**, **propósito raíz 2.2 intacto** (Prueba de Propósito, Art. 8.2). Invariantes acotados: #9 inv. 9, #13 inv. 7, #14 §6 (dos clases de capacidad). Deliberación + ADR-0009.

**Guardarraíles inseparables:** ninguna acción operativa sin política válida; ningún efecto externo **real** sin autorización explícita (causal de parada); en este bloque **solo adaptadores simulados/sandbox**.

**Primera vertical técnica — HECHA y verificada:** paquete `@soec/operacional` (event-sourced sobre la Base Técnica). **Política vigente → Autorización (permitir/denegar con motivo) → Ejecución por adaptador SIMULADO → Verificación → Registro/auditoría.** Ninguna acción sin política válida; ningún efecto externo real (`Efecto.simulado === true`). Políticas versionadas (registrar/publicar/suspender/reanudar/revocar); niveles de autonomía 0–5 y clases de riesgo; presupuesto acumulado; idempotencia por identidad de ejecución; reversibilidad simulada; aislamiento organizacional; proyecciones reconstruibles; worker de drenaje único extendido; API técnica mínima (`/operativo/*`) sin endpoint para «ejecutar en real» ni para saltar la autorización.

**Resultados exactos (2026-07-21):** `pnpm -r typecheck` OK (12 workspaces) · `pnpm lint` limpio · backend `pnpm test` **272 passed (51 files)** — nuevos operacional: autorización 10 · vertical 8 · arquitectura 4 · pg 7 (Postgres real) · api 4. Migración desde cero: `0001…0006`. Suite verde también desde base nueva.

**Guardarraíles verificados:** sin política → denegada sin efecto; canal/tipo/afirmación/aprobación/nivel/presupuesto → denegada con motivo; suspensión de política → detención (interruptor de pausa); reversión; idempotencia; efecto siempre simulado. Prueba arquitectónica: el dominio no importa paquetes intelectuales ni SDK; sin adaptadores de efecto real.

**Siguiente nodo habilitado:** bloques B–I de la Directiva (núcleo de autonomía → modelo operativo → planificador → fábrica de contenido → adaptador de publicación controlada → medición → centro de control → piloto), cada uno vertical. Efectos externos **reales** siguen siendo causal de parada hasta autorización explícita.

**Deuda técnica / límites:** efectos exclusivamente **simulados** (por decisión y guardarraíl); «plan operativo» explícito y modelo operativo rico (marca/campaña/contenido/lead…) se desarrollan en los bloques C–D; presupuesto diario declarado pero aún no acotado por ventana temporal (se refina con la medición, bloque G).

## ✅ BLOQUE F1-UI-01 (Primera Interfaz · «Comprender el estado de mi empresa») — CERRADO Y VERIFICADO (2026-07-21)

Primera experiencia de usuario completa consumiendo una capacidad real. Realiza la prioridad estratégica registrada (`docs/decisions/prioridad-primera-interfaz.md`). Interfaz = realización #16 (Nivel C); no introduce arquitectura de dominio.

| Criterio de cierre (orden F1-UI-01) | Estado |
|---|---|
| `apps/web` con Next.js; capacidad iniciable desde la interfaz; resultado consultable | ✅ Next 15 App Router; `next build` ✓ |
| detectar y esclarecer diferenciados; evidencia/procedencia/incertidumbre/limitaciones/faltante visibles | ✅ verificado en la app viva |
| contradicciones abiertas no ocultas; abstención con experiencia propia; decisión reservada inequívoca | ✅ |
| historial; refrescar no pierde la ejecución; sin efectos externos; sin acceso directo a ECE/MED/MDM | ✅ prueba arquitectónica de contrato |
| validación visual real (no solo tests de función) | ✅ app conducida en vivo sobre la cadena real en PostgreSQL |
| next build · typecheck · lint · pruebas de componentes e integración verdes; Git limpio; docs sincronizados | ✅ |

**Organización por preguntas humanas** (no por arquitectura): 1) ¿Qué ocurre? 2) ¿Qué señales? 3) ¿En qué se basa? 4) ¿Qué no se sabe / es contradictorio? 5) ¿Qué revisar/decidir? La arquitectura aparece por **trazabilidad progresiva** bajo expansión. **Sin botones de acción**: SOEC presenta; la persona decide.

**Arquitectura:** la web consume **solo la API pública de capacidades** (route handlers proxy server-side, misma-origin); no importa paquetes de dominio, no accede a PostgreSQL, no reconstruye productos ni aplica reglas. Capa de experiencia en `apps/api` (`/experiencia/comprender-estado/*`) ejecuta la **cadena real** (Capacidad → Operaciones → ECE → MED+MDM sintéticos persistidos), contexto sintético server-side.

**Resultados exactos (2026-07-21):** `pnpm -r typecheck` OK (incl. web) · `pnpm lint` limpio · backend `pnpm test` **239 passed (46 files)** (incl. 4 de integración de experiencia con la cadena real) · web `pnpm -C apps/web test` **6 passed** · `next build` ✓. Validación visual: estados sin-análisis / completado-con-limitaciones / contradicción abierta / faltante / detalle evidencia+procedencia+mecanismo+corte / historial / detalle persistido / **error recuperable + reintento idempotente** — todos conducidos en vivo.

**Límites de verificación declarados (honestidad de estado):** las **capturas raster** excedieron el timeout del entorno (30s); la validación visual se hizo **conduciendo la app viva** (clicks + árbol de accesibilidad) — artefactos verificables, no PNG. La **abstención total** no se dispara en el dominio sintético (el paso obligatorio `detectar` no se abstiene); su experiencia se valida por prueba de componente.

**Siguiente nodo — PRIORIZADO por la Autoridad Estratégica (2026-07-21):** **profundizar y consolidar la experiencia del usuario sobre las capacidades ya existentes** (cómo las personas interactúan con SOEC) **antes** de ampliar el número de capacidades, introducir conectores, autenticación, automatizaciones o efectos externos. Registro: `docs/decisions/prioridad-profundizar-experiencia.md`. Oportunidades de producto registradas (dirección, no órdenes): **A** experiencia conversacional (Resumen conversacional → Evidencia → Detalle técnico, enriqueciendo la vista actual); **B** sesión multi-capacidad conservando la trazabilidad individual de cada una. Efectos externos/conectores/auth quedan **detrás** de esa consolidación y requieren autorización explícita, preservando la frontera Producto → Decisión humana → Acción. **Cambio de etapa:** la calidad del proyecto ya no depende principalmente de la arquitectura interna, sino de cómo se traduce en una experiencia útil, comprensible y confiable para quien decide.

## ✅ BLOQUE F1-RM-01 (Resolución del Roadmap · Primer Dominio Real) — CERRADO Y VERIFICADO (2026-07-21)

Resolución del grafo del Documento #17: cerradas las fases 1–5 a nivel de marco, el siguiente nodo (Fase 2 «para un primer dominio» / Fase 6 Extensión) estaba **reservado a la Autoridad Estratégica** (#17 §5). Elevada la bifurcación; la Autoridad decidió y el nodo se ejecutó.

**Decisión estratégica registrada** (`docs/decisions/instanciacion-estrategica-primer-dominio.md`): dominio inicial = **pyme de servicios** · primera capacidad = **«Comprender el estado»** (esclarecer + detectar) · datos = **solo sintéticos**.

| Exigencia (orden §8, §14 A) | Estado |
|---|---|
| Primer dominio real instanciado sobre el sistema existente (sin arquitectura ni migraciones nuevas) | ✅ `@soec/instancia-pyme`; migración desde cero = solo `0001`…`0005` |
| Capacidad real registrada (definición versionada, no fixture) que compone operaciones existentes | ✅ «Comprender el estado» (detectar + esclarecer) registrada y publicada |
| Producto compuesto no vinculante · soberanía · sin efectos · trazabilidad | ✅ `bindingDecision:false`; MED/MDM/ECE intactos tras ejecutar |
| Distingue definición / ejecución / producto · respeta la capa cerrada | ✅ vía registro + orquestador existentes |
| PostgreSQL real · aislamiento · worker · sin datos reales/credenciales | ✅ 4 pruebas PG; prueba arquitectónica |

**Resultado del Roadmap:** *Resultado A (transición inequívoca)* tras resolver la bifurcación estratégica reservada. **Resultados exactos (2026-07-21):** `pnpm -r typecheck` 11/11 OK · `pnpm lint` limpio · `pnpm test` **235 passed (45 files)** — nuevos: instanciación 5 · pg 4 (Postgres real) · arquitectura 3. Verde también desde base recién creada.

**Vertical de dominio real end-to-end:** MED (`pyme-servicios-01`) + MDM (`mundo-pyme-01`) → ECE (`ece-pyme-01`, con coherencia + contradicción + ausencia) → capacidad «Comprender el estado» → producto compuesto que hace visible el estado, conserva la contradicción abierta y los faltantes, y remite al juicio humano.

**Siguiente nodo — PRIORIZADO por la Autoridad Estratégica (2026-07-21):** la **primera interfaz consumidora de capacidades** (F1-UI-01) — la primera experiencia completa de usuario usando una capacidad real. **No** es equivalente a agregar dominios/capacidades sintéticas: con el riesgo técnico retirado, la prioridad pasa a **demostrar valor a una persona real**. Verificado contra #17 (no gobierna interfaces → #16; dependencia de capacidades ya conformes satisfecha; priorización reservada a la Autoridad §5): **#17 no impone dependencia previa distinta**. Registro: `docs/decisions/prioridad-primera-interfaz.md`. La interfaz consume capacidades (jamás ECE/MED/MDM directo), presenta producto/evidencia/incertidumbre/faltante/asuntos reservados, y **no decide ni ejecuta** por el usuario. Conectores/efectos/datos reales siguen reservados (orden §9–§11).

**Deuda técnica / límites:** los datos son sintéticos (sin conectores ni interfaz, por decisión); una sola capacidad instanciada; la interfaz consumidora de capacidades (#16) y otras familias quedan como instanciaciones futuras.

## ✅ BLOQUE F1-CAP-01 (Sistema de Capacidades Ejecutable) — CERRADO Y VERIFICADO (2026-07-21)

Composiciones de operaciones intelectuales orientadas a un propósito humano, realizando #14 y **cerrando el arco conceptual ejecutable ECE → Operaciones → Capacidades → Persona**.

| Exigencia de cierre (§28) | Estado |
|---|---|
| Anatomía ejecutable de capacidad · definiciones versionadas | ✅ `@soec/capacidades` (capdef append-only) |
| Componen operaciones · sin dependencia inversa · sin acceso directo al ECE | ✅ vía `OperacionesPort`; prueba arquitectónica (escenario J) |
| Composición simple, secuencial y paralela · productos intermedios · producto compuesto | ✅ probados; intermedios conservados y recuperables |
| Soberanía · anti-atrofia · abstención · rechazo de ciclos | ✅ guardarraíles; abstención compuesta; `CicloDetectadoError` |
| PostgreSQL real · migraciones desde cero · proyecciones reconstruibles · API · worker | ✅ `proj_capdef`/`proj_capexec`; 7 pruebas PG; drenaje único |
| Suite completa verde · sin acciones externas · sin UI comercial · sin IA real | ✅ 223/223 |

**Resultados exactos (2026-07-21):** `pnpm -r typecheck` 10/10 OK · `pnpm lint` limpio · `pnpm test` **223 passed (42 files)** — nuevos capacidades: registry 6 · composición 5 · escenarios A–I 9 · guards 6 · proyección 2 · arquitectura (J) 4 · pg 7 (Postgres real) · api 3. Verde también desde base recién creada.

**Escenarios sintéticos (§23):** A capacidad simple · B secuencial sin convertir detección en decisión · C paralela conservando diferencias · D abstención intermedia · E contradicción abierta remitida al juicio humano · F versionado sin recálculo · G idempotencia · H no efecto · I rechazo de ciclo · J no atajo (arquitectónica) — todos probados.

**Arco conceptual ejecutable completo:** MED+MDM → ECE → Operaciones → Capacidades → Persona. El siguiente bloque lo determina el grafo del #17 (roadmap); **no** se inició aquí.

**Deuda técnica / límites declarados:** la composición cubre secuencia/paralelo/convergencia por `dependeDe`/`usaProductoDe` (no un motor genérico de workflows, por diseño §6) · `usaProductoDe` alimenta la configuración del paso siguiente incorporando el resumen del producto previo al propósito (composición a nivel de orquestador, sin motor de paso de datos arbitrario) · las definiciones sintéticas viven como fixtures de prueba, no como taxonomía comercial permanente (§9).

## ✅ BLOQUE F1-OI-01 (Sistema de Operaciones Intelectuales Ejecutable) — CERRADO Y VERIFICADO (2026-07-20)

Las cuatro operaciones que operan sobre el ECE, realizando #13 sin redefinirlo y sin implementar capacidades (#14) ni IA real.

| Exigencia de cierre (§31) | Estado |
|---|---|
| Las cuatro operaciones implementadas (esclarecer/detectar/proyectar/orientar) | ✅ `@soec/operaciones` |
| Consumen el ECE por su frontera (`EceReadPort`), sin tocar MED/MDM/ECE | ✅ prueba arquitectónica; escenario H (no efecto) |
| Productos persistentes y especializados; conservan evidencia/procedencia/faltante/incertidumbre | ✅ unión discriminada; anatomía común |
| Pueden abstenerse | ✅ 11 causas clasificadas (conceptuales/técnicas) |
| No crean decisiones ni ejecutan acciones · independientes de proveedores | ✅ `bindingDecision:false`; sin adaptadores de efecto; guardarraíles |
| Mecanismo determinístico + prueba de sustituibilidad | ✅ determinístico + IA simulada (escenario G) |
| PostgreSQL real · migraciones desde cero · proyecciones reconstruibles · API · worker | ✅ `proj_oi_current`; 7 pruebas PG; drenaje único |
| Suite completa verde · sin capacidades · sin IA real | ✅ 182/182 |

**Resultados exactos (2026-07-20):** `pnpm -r typecheck` 9/9 OK · `pnpm lint` limpio · `pnpm test` **182 passed (34 files)** — nuevos operaciones: service 10 · scenarios A–H 8 · esclarecer 6 · detectar 5 · proyectar 5 · orientar 5 · product 5 · projection 3 · architecture 5 · pg 7 (Postgres real) · api 4. Verde también desde base recién creada.

**Guardarraíles verificados:** soberanía (`bindingDecision:false`; rechazo de productos vinculantes), anti-atrofia (rechazo de conclusiones opacas; todo producto muestra razones/evidencia/faltante y, si orienta, cuestiones reservadas al juicio humano), no-efecto (MED/MDM/ECE intactos), no-retroyección (producto histórico no recalculado).

**Puerto para el #14:** las operaciones quedan como piezas estables y no vinculantes que las **capacidades (#14)** compondrán. El siguiente bloque del grafo (#17) es el **Sistema de Capacidades (#14)**, y **no** se inició aquí.

**Deuda técnica / límites declarados:** el mecanismo determinístico deriva señales estructurales del ECE (afirmación↔evidencia y elementos registrados); razonamiento semántico más rico corresponde a mecanismos futuros tras el mismo puerto · timeout/cancelación se realizan con `Promise.race`/`AbortController` (suficiente para el bloque; sin daemon) · la IA simulada es un adaptador de prueba, no un proveedor real.

## ✅ BLOQUE F1-ECE-01 (Estado Cognitivo Empresarial Ejecutable) — CERRADO Y VERIFICADO (2026-07-20)

Representación derivada, persistente, histórica y verificable que integra MED y MDM, realizando #12 sin redefinirlo y sin implementar operaciones intelectuales (#13).

| Exigencia de cierre (§26) | Estado |
|---|---|
| ECE como representación ejecutable derivada de MED y MDM | ✅ paquete `@soec/ece` (`EceBuildService`, `EceQueryService`) |
| No fusiona MED y MDM · no inventa información · no resuelve contradicciones | ✅ streams/tablas separados; derivación estructural; contradicciones y ausencias de primera clase |
| Conserva ausencias · permite reconstrucción histórica | ✅ ausencias→no evaluable; `estadoEnFecha` sin retroyección |
| Persistencia PostgreSQL real · proyección actual | ✅ `proj_ece_current`; 7 pruebas contra `soec_postgres` |
| Puede invalidarse y reconstruirse | ✅ `vigencia` on-demand + worker con causación; `reconstruir` conserva historia |
| API técnica · worker · puerto de lectura para #13 | ✅ rutas ECE; drenaje único MED+MDM+ECE; `EceReadPort` |
| Suite completa verde · migración desde cero | ✅ `{"migrated":["0001_init","0002_model_projections","0003_ece_projection"]}` |
| Sin operaciones intelectuales · sin capacidades · sin IA real | ✅ pruebas arquitectónicas lo garantizan |

**Resultados exactos (2026-07-20):** `pnpm -r typecheck` 8/8 OK · `pnpm lint` limpio · `pnpm test` **119 passed (23 files)** — nuevos ECE: derive 4 · build 6 · scenarios 6 (A–F) · temporal 4 · projection 3 · architecture 4 · pg 7 (Postgres real) · api 5. Verde también desde base recién creada.

**Escenarios sintéticos (§22):** A coherencia · B contradicción MED↔MDM registrada sin decidir · C ausencia no evaluable · D dependencia insatisfecha→satisfecha en versión histórica · E brecha sin acción · F cambio temporal consultable sin contaminación — todos probados.

**Puerto para el #13:** `EceReadPort` (solo lectura) queda como frontera estable; el bloque **no** implementa operaciones intelectuales ni capacidades. El siguiente bloque del grafo (#17) es el **Sistema de Operaciones Intelectuales (#13)**, y **no** se inició aquí.

**Deuda técnica / límites declarados:** las relaciones cross-model (coherencia/contradicción/dependencia/brecha entre MED y MDM) se **registran declaradas** (atribuidas), no se infieren semánticamente (la inferencia sería operación intelectual, #13) · el worker es drenaje de una pasada (invalidación en cascada requiere pasadas sucesivas del outbox) · la derivación intra-modelo cubre coherencia/contradicción/ausencia por afirmación↔evidencia; dimensiones semánticas más ricas pertenecen al #13.

## ✅ BLOQUE F1-MOD-01 (Núcleo de Modelos MED y MDM) — CERRADO Y VERIFICADO (2026-07-20)

Vertical de dominio ejecutable sobre la Base Técnica, realizando #9/#10/#11 sin redefinirlos.

| Exigencia de cierre (§18) | Estado |
|---|---|
| MED y MDM como verticales ejecutables | ✅ paquete `@soec/models` (`MedService`, `MdmService`) |
| Separación MED ╪ MDM conservada | ✅ streams y tablas separados; guarda `ModelSeparationError`; probado |
| Afirmaciones y evidencias de primera clase | ✅ estados pendiente/respaldada/cuestionada/superada; evidencia con procedencia, sin elevación automática |
| Persistencia PostgreSQL real | ✅ 7 pruebas contra `soec_postgres` |
| Consultas actuales e históricas | ✅ `estadoActual` / `estadoHistorico` (reconstrucción por `recordedAt`) |
| Proyecciones reconstruibles | ✅ borrar+reconstruir = incremental; idempotencia por secuencia |
| Worker procesa ambos modelos | ✅ `drenarProyecciones` sobre outbox; idempotente |
| Migración desde cero | ✅ `{"migrated":["0001_init","0002_model_projections"]}` |
| ADR y documentación sincronizados | ✅ ADR-0003; MASTER_STATUS + CHANGELOG |
| Git limpio · sin datos reales · sin mezcla · sin ECE anticipado | ✅ |

**Resultados exactos (2026-07-20):** `pnpm -r typecheck` 7/7 OK · `pnpm lint` limpio · `pnpm test` **80 passed (15 files)** — de ellos nuevos: models pg 7 (Postgres real) · med-vertical 9 · mdm-vertical 4 · evidence 4 · aggregate 4 · projection 5 · separation 3 · link 3 · architecture 4 · api modelos 6. Suite verde también desde base recién creada.

**Puertos para el ECE (#12):** servicios y proyecciones de MED y MDM quedan como frontera estable; el bloque **no** integra comprensión. El siguiente bloque del grafo (#17) es el ECE, y **no** se inició aquí.

**Deuda técnica / límites declarados:** el worker de proyecciones es un drenaje de una pasada (sin loop/daemon ni checkpoints persistidos por evento — la idempotencia es por secuencia en la propia proyección) · la API de modelos es técnica mínima (no pública) y valida forma en el borde de dominio, no con esquemas Zod · reconstrucción de proyecciones re-lee la tabla de eventos (operación de sistema).

## ✅ BLOQUE F1-BT-01 (Base Técnica Ejecutable) — CERRADO Y VERIFICADO (2026-07-20)

**Custodia versionada — repo Git activo.** Rama `main`; commit basal `cdfa754` (Fundación 19/19 + ADR). `.gitignore` y `.gitattributes` (LF) en su sitio. Árbol limpio tras el cierre.

| Sub-fase | Estado |
|---|---|
| **A — Custodia y versionado** | ✅ **COMPLETA y verificada** — auditoría (árbol limpio, sin `.git` previo, sin contaminación cruzada), git init, commit basal, repo limpio |
| **B — ADR-0001 (stack)** | ✅ **RESUELTA** — stack autorizado por el Propietario, estratificado A/B/C. Ecosistema TS/Node (B); ORM/Fastify/Next/outbox/IA (C); contratos de persistencia y transporte de contexto (A) |
| **C — Andamiaje monorepo** | ✅ pnpm workspaces + TS strict + ESLint flat + Prettier + Vitest + tsx; Postgres local aislado (`docker compose -p soec`, 5544) |
| **D — Contracts (núcleo neutral)** | ✅ puertos/tipos que realizan ADR-0002 (errores, ids marcados, Scope, Attribution, EventStore/Outbox, IntelligenceProvider no vinculante) |
| **E — Event store (memoria + PostgreSQL)** | ✅ ambas implementaciones realizan C-1..C-5; migración 0001 idempotente; `recorded_at timestamptz(3)` |
| **F — API Fastify 5** | ✅ `buildApp` con inyección; errores de contrato mapeados (403/422/409); contexto exigido por cabeceras |
| **G — Inteligencia determinista** | ✅ adaptador neutral, se abstiene, `bindingDecision:false`, `offerToHumanJudgment` (Soberanía Humana) |
| **H — Conformance compartida** | ✅ misma suite ejecutada por memoria **y** PostgreSQL real (prueba de sustituibilidad, ADR-0001 estrato B) |
| **I — Calidad** | ✅ typecheck 5/5 · lint limpio · **31/31 tests verdes** (11 con Postgres real) · migración desde cero verificada |

**Resultados exactos (2026-07-20):** `pnpm -r typecheck` 5/5 OK · `pnpm lint` limpio · `pnpm test` **31 passed (5 files)** — worker 1 · intelligence 5 · in-memory 9 · api 5 · **pg-event-store 11 (Postgres real)**. Migración desde volumen vacío: `{"migrated":["0001_init"]}`.

**Toolchain verificado:** git 2.53 · node v24.14.1 · npm 11.11 · docker 29.4 · pnpm 9.15.4 (vía npx; corepack global bloqueado por permisos en `C:\Program Files\nodejs` — workaround documentado) · red OK. `psql` no en PATH → Postgres vía Docker.

**Aislamiento verificado:** `soec_postgres` en 5544 con volumen propio; los contenedores `ssr_*` (5433/6379/8080) intactos — sin mezcla (Directiva §9).

**ADR-0002** ✅ contrato de conformidad satisfecho por evidencia objetiva. No hay elevaciones abiertas.

**Deuda técnica / límites declarados:** proyección real del worker diferida a incrementos posteriores (hoy solo drena el outbox) · sin remoto Git (push no autorizado) · corepack global bloqueado (pnpm vía npx).

## Entregables de la Fase 0 — COMPLETOS

| # | Entregable | Cubierto por | Estado |
|---|---|---|---|
| 1 | Biblioteca Maestra | `docs/` — 19/19 | ✅ |
| 2 | Arquitectura Oficial | #9 (conceptual) · #16 (técnica) | ✅ |
| 3 | Modelo del Dominio | #10 MED · #11 MDM · #12 ECE · #13 · #14 | ✅ |
| 4 | Estándares | #15 | ✅ |
| 5 | ADR / decisiones | `docs/decisions/` (deliberaciones, matrices, elevaciones) | ✅ |
| 6 | Roadmap | #17 | ✅ |
| 7 | Manual / gobernanza | #6 · #7 · #8 · #18 | ✅ |
| 8 | Sistema de Contexto | `MASTER_STATUS` · `CHANGELOG` · #5 Registro · bitácoras | ✅ |

Leyenda: ⬜ Pendiente · 🟡 En progreso · ✅ Completo · 🔵 En revisión

## Orden oficial de construcción (19 documentos)

La Biblioteca Maestra se construye en el orden fijado por el Propietario del Producto. Detalle y estado en `docs/00-INDICE-BIBLIOTECA-MAESTRA.md`.

- **Fase 0.A — Descubrimiento Fundacional:** 🏁 CONCLUIDA (6/6 bloques ratificados). Bitácora: `docs/constitution/_descubrimiento-fase-0A.md`.
- **Fase 0.B — Auditoría de Coherencia Constitucional:** 🏁 CONCLUIDA. Informe: `docs/constitution/_auditoria-coherencia-fase-0B.md`.
- **Fase 0.C — Lectura de Aceptación:** 🏁 CONCLUIDA. Único hallazgo AC-1 (acrónimos MED/MDM), corregido.
- **Documento #1 — Constitución Maestra:** ✅ **v1.0 — Fuente Oficial de Verdad Filosófica, ACEPTADA OFICIALMENTE.** A partir de aquí, todo cambio sigue el Art. 8.
- **Matriz de Trazabilidad Filosófica:** ✅ `docs/constitution/_matriz-trazabilidad-filosofica.md`.
- **Recomendación diferida:** 🟡 Interpretación Autorizada de la Constitución — `docs/decisions/interpretacion-autorizada-constitucion.md` (abrir tras primera arquitectura estable).

- **Documento #2 — Objetivo Supremo:** ✅ **v1.0 ACEPTADO** — superó los cuatro criterios de revisión.

## Delimitación de funciones (evita solapamiento entre documentos)

- **Constitución (#1):** ¿Qué es SOEC y qué jamás dejará de ser?
- **Objetivo Supremo (#2):** ¿Hacia dónde apunta permanentemente SOEC?
- **Filosofía del Proyecto (#3):** ¿Cómo piensa SOEC el mundo? (cosmovisión desde la que nacen todas las decisiones posteriores; no redefine identidad ni dirección).

- **Fase 0.D — Fundamentos Epistemológicos:** 🏁 CONCLUIDA (5/5 microbloques ratificados + reconciliación E1↔E5). Bitácora: `docs/constitution/_fundamentos-epistemologicos-fase-0D.md`.

- **Documento #3 — Filosofía del Proyecto:** ✅ **v1.0 ACEPTADO.** Añadido el *Principio de Conservación Semántica*; el juicio humano se acotó al **constitucionalmente reservado** (la automatización sin consecuencias para personas es admisible; la clasificación no se autodeclara).

**Trípode constitucional cerrado:** #1 define *qué es SOEC* · #2 define *hacia dónde se dirige* · #3 define *desde qué disciplina epistemológica piensa y actúa*.

**★ Principio de Jurisdicción Documental ratificado** (detalle en `docs/00-INDICE-BIBLIOTECA-MAESTRA.md`): cada documento tiene competencia normativa exclusiva sobre el territorio de su pregunta única. La jurisdicción no se autodeclara; el territorio huérfano se asigna antes de legislarse; todo documento declara en su encabezado qué **no** gobierna. Profundidad sobre una misma materia: **#1 declara · #4 interpreta · #7 ejecuta · #15 comprueba.** La Biblioteca es una retícula con cuatro autoridades declarantes (#1 identidad, #2 dirección, #3 epistemología, #4 conducta), no una cascada única.

- **Documento #4 — Principios Fundamentales:** ✅ **v1.0 ACEPTADO.** 21 principios de conducta + **Test de Decisión** de 11 preguntas (la 11ª, sobre preservación de la identidad constitucional, puede vetar por sí sola).

**Capa constitucional #1–#4 completa y aceptada.** Constitución multicapa: cada documento responde una pregunta única, con jurisdicción exclusiva, derivando coherentemente del nivel superior.

**Frontera del #5 fijada:** no declara — **custodia**. Es el *Registro Constitucional de Permanencia*: hace localizable, invocable y auditable lo ya declarado por #1–#4, con cláusula de jurisdicción negativa, sincronización obligatoria, precedencia de la fuente y custodia activa pero nunca correctiva. Detalle en el índice.

- **Documento #5 — Registro Constitucional de Permanencia:** ✅ **v1.0 ACEPTADO.** Opera en nivel **meta-normativo** (metaconstitución): no produce normas, preserva la integridad del orden normativo.

## Hallazgos de custodia abiertos

| # | Tipo | Estado |
|---|---|---|
| **C-1** | Inconsistencia | **Diferido**: enmienda única al cierre de la capa declarativa, redefiniendo los niveles de permanencia **por naturaleza, no por ubicación documental** |
| **C-2** | Inconsistencia | Abierto — el Principio de Jurisdicción Documental se declaró fuera de los 19 documentos |
| **C-3** | Observación | Se resuelve al redactar #6 |
| **C-4** | Observación | Se resuelve al redactar #9, #13, #14, #16 |
| **C-5** | Observación | Condicionado a la inicialización de Git |

- **Documento #6 — Gobierno del Proyecto:** ✅ **v1.0 ACEPTADO.** Gobierna **funciones de autoridad**, no personas ni cargos. **Resuelve C-3.** Registra como no vigente la futura función de *Interpretación Constitucional*.

**Principios de arquitectura documental vigentes:** Jurisdicción Documental (territorio) · **Monocompetencia Documental** (clase de acto) · Autoridad para la Clasificación (#6 §1).

- **Documento #7 — Metodología de Desarrollo:** ✅ **v1.0 ACEPTADO.** Gobierna el **método permanente de transformación legítima** (no la programación): Principio de Independencia Instrumental, siete fases como *cadena de legitimación*, proporcionalidad sin omisión de fases, cierre por fases completas, remisión en urgencia y autoaplicación.

**Observación registrada (no incorporada):** principio emergente *«el método nunca sustituye al juicio»* — el método ordena el camino; no decide, no autoriza, no interpreta, no verifica.

- **Documento #8 — Consejo de Diseño:** ✅ **v1.0 ACEPTADO.** Institución constitucional de deliberación: actúa *antes* de la decisión, mide examen y no verdad.

## 🏛️ CAPA CONSTITUCIONAL COMPLETA (#1–#8)

Cada documento responde **una única pregunta constitucional**:

| # | Pregunta única |
|---|---|
| 1 | ¿Qué es SOEC? |
| 2 | ¿Para qué existe? |
| 3 | ¿Cómo distingue conocimiento válido? |
| 4 | ¿Cómo debe comportarse? |
| 5 | ¿Cómo preserva su permanencia? |
| 6 | ¿Quién puede decidir qué? |
| 7 | ¿Cómo evoluciona legítimamente? |
| 8 | ¿Cómo madura una propuesta antes de decidirse? |

**Circuito completo:** propuesta → #8 deliberación → #6 decisión → #7 ejecución → #15 verificación, con #5 sincronizando al cierre. No quedan vacíos entre una idea y su implementación.

## ✅ Enmienda de los niveles de permanencia — COMPLETADA (2026-07-19)

**Primera aplicación del sistema a sí mismo, circuito completo:** #8 deliberación (3 rondas) → #6 decisión de la Autoridad Constitucional → #7 método → #5 sincronización.

**Constitución v1.1.** Art. 8.1 reescrito con la **taxonomía bidimensional**; añadidos 8.5 (reglas de clasificación), 8.6 (gobierno de los planos) y 8.7 (autoaplicación). Numeración de 8.2–8.4 preservada: todas las referencias cruzadas siguen válidas (verificado).

- **Planos** (crear uno es competencia exclusiva de la Autoridad Constitucional, con prueba de cinco requisitos): **sistema** · **meta-normativo**.
- **Niveles**, definición común a ambos planos: **I Constitutivo · II Directivo · III Instrumental**, por profundidad de la pérdida **inmediata y propia** en el objeto que gobierna. *La intensidad de una pérdida no equivale a su carácter constitutivo.*
- **La taxonomía se aplica a sí misma** (meta-normativo, Nivel I) y su reforma se tramita conforme a la clasificación vigente al iniciarse.

**Hallazgos:** **C-1 ✅ resuelto** · **C-2 ✅ resuelto en su dimensión de rango**, con residual desprendido como **C-7** (el índice alberga una regla de Nivel I sin ser documento numerado) · **tarea derivada abierta:** clasificar las 37+ reglas del plano del sistema, que es acto de clasificación y corresponde a la autoridad competente, no a la Custodia.

## Historial de la deliberación

Primera aplicación del sistema a sí mismo: deliberación (#8) → decisión (#6) → método (#7) → sincronización (#5). Registro: `docs/decisions/deliberacion-enmienda-niveles-permanencia.md`.

**Deliberación concluida (3 rondas). Resultado: propuesta madura con objeciones asumidas.**

**Conclusión:** taxonomía **bidimensional** — *plano de aplicación* × *profundidad de permanencia*, ejes **ortogonales**, con **escala común** aplicada a objetos distintos.

- **Plano:** ¿qué objeto gobierna la regla? → del sistema (SOEC) · meta-normativo (la Biblioteca).
- **Nivel:** profundidad de la pérdida **inmediata y propia** en el objeto que gobierna, evaluada contra las declaraciones superiores aplicables → **Constitutiva · Directiva · Instrumental**.
- **Migración:** los niveles pueden cambiar, nunca automáticamente. *La permanencia no es inmutabilidad: es resistencia formal al cambio.*

**Objeciones asumidas, a resolver al redactar:** **D-4** asimetría del nivel superior (constitutiva tiene 1 disyunto en el plano del sistema y 3 en el meta — arrastra hacia arriba) · **D-5** la taxonomía se clasifica a sí misma y debe declararlo · **vía de evasión**: la creación de un plano debe someterse a la Autoridad para la Clasificación, o C-2 reaparece un piso más arriba.

## ✅ C-7 — RESUELTO (2026-07-19)

**Constitución v1.2 · #6 v1.1 · #7 v1.1 · índice reducido a función informativa.**

- **Jurisdicción Documental → Art. 7.4** (el Art. 7 ya gobernaba el mismo objeto; elimina la autorreferencia del #6).
- **Fuente Declarante Única → Art. 7.5 (nueva).** *Una regla normativa tiene exactamente una fuente declarante competente; todo otro documento solo puede remitir a ella o resumirla sin pretensión normativa.* **Elimina la causa de C-7, no solo su manifestación.**
- **Monocompetencia + competencias por documento + fronteras → #6 §1.bis.**
- **Circuito de transformación + regla de profundidad → #7 §2.bis.**
- **Tres duplicaciones eliminadas** a favor de la fuente declarante (Art. 7.2 · #5 §2 · encabezado del #5).
- **Verificado:** cada regla tiene una única fuente declarante; el índice no conserva lenguaje normativo.
- **C-8 abierto**, detectado durante la ejecución: el #6 declara una pregunta referida a *actores* pero aloja reglas referidas a *documentos*.

## Historial — C-7 (deliberación)

Secuencia decidida por la Autoridad Constitucional: **1) cerrar C-7 · 2) clasificar el corpus pendiente · 3) abrir el #9.** Son transformaciones distintas y cada una deja su propia trazabilidad. Registro: `docs/decisions/deliberacion-c7-reglas-alojadas-en-el-indice.md`.

**Ronda 1 cerrada — la observación amplió el hallazgo:** el índice no aloja dos principios, sino **once bloques normativos**, y **tres están duplicados** (regla de conflicto ↔ Art. 7.2 · reglas de custodia ↔ #5 §2 · cláusula negativa del #5 ↔ encabezado de #5). Cerrar C-7 moviendo solo dos principios lo cerraría falsamente.

**Insuficiencia declarada — dos decisiones pendientes:**
1. ¿*Jurisdicción Documental* (Nivel I constitutivo) va al **#6** o a la **Constitución Art. 7**? La alternativa por nivel resuelve además la autorreferencia del #6.
2. Para cada duplicación, **qué texto prevalece y cuál se suprime**.

**Obstáculo registrado:** trasladar reglas sobre *documentos* al #6 exige **ampliar explícitamente su pregunta declarada** (hoy referida a actores), o se repetiría el vicio que se corrige.

## En curso — Clasificación del corpus (#3 y #4)

**Matriz preparada, ninguna clasificación vigente.** Registro: `docs/decisions/matriz-clasificacion-corpus-3-4.md`.

- **41 reglas individualizadas** tras descomponer tres enunciados compuestos (Memoria/No Retroyección · Conservación/Elevación · Hechos y Valores en tres componentes).
- **Discriminador propuesto** para la frontera I/II, ante el arrastre hacia arriba previsto en D-4: la certeza falsa **sistémica e inevitable** → I; **posible en casos concretos** → II.
- **Distribución propuesta:** I = 8 · II = 32 · III = 1.
- **5 casos controvertidos** con alternativa y condición de cambio: Carga de la Prueba · El tipo no se autodeclara · Conservación Semántica · Verificación Acotada · Recuperabilidad Organizacional.
- **Hallazgo:** el #5 §6 clasificó en Nivel III las *Consecuencias de diseño (1–12)* y el *Test de Decisión (1–11)* **sin acto de autoridad competente**. Requiere ratificación o corrección.
- **A decidir además:** si *Transparencia organizacional* es regla propia o derivación de la Interpretabilidad; y si el vacío del Nivel III es esperable o indica arrastre residual.

**Criterio decidido (2026-07-19) — Constitución v1.3.** Ratificado el discriminador con reformulación (*¿desaparece una **garantía constitutiva**, o solo aumenta el riesgo?*), elevada a permanente la **descomposición previa**, declarado que la distribución de un documento **no crea expectativa** para otros. *Carga de la Prueba* → **II provisional**. Clasificaciones históricas del #5 §6 → **DEROGADAS** por falta de competencia. **La matriz sigue sin ratificar.**

**Criterio definitivo (Art. 8.5, v1.3).** Sub-test temático **rechazado** por especificar prematuramente una clase cerrada de condiciones. Criterio adoptado: el nivel no depende de que desaparezca una garantía, sino de **si sobrevive la condición que esa garantía protegía**. La forma verbal del enunciado es irrelevante.

**Re-aplicado a las once reglas: la distribución NO se sostiene exactamente → 7–33–1.** Tres reglas cambian: *El tipo no se autodeclara* ⬆ II→I · *Hechos y Valores (a)* ⬇ I→II · *Evolución compatible* ⬇ I→II. Causa común de los descensos: **otra regla vigente ya preserva la condición**. El criterio cambió respuestas en lugar de confirmar intuiciones.

**Criterio derivado propuesto, no adoptado:** *una regla no es constitutiva si la condición que protege está garantizada de forma independiente por otra regla vigente de igual o mayor rango* — previene además el doble conteo de una misma condición.

**Ratificado (2026-07-19): distribución 7–33–1 y las tres reclasificaciones.** Incorporado a la Constitución **v1.4, Art. 8.5.bis**: principio de **no duplicación constitutiva** basado en suficiencia normativa independiente (no en rango declarado, que puede estar en determinación) · **prueba de independencia** de cinco condiciones · **prohibición de degradación circular o mutua** con sus tres casos (protección conjunta → ambas Nivel I · redundancia real → fuente primaria + refuerzo · protección parcial → cada una por su pérdida propia) · **inventario de condiciones constitutivas** · **revisión obligatoria cuando se transforma una fuente constitutiva**.

**Inventario construido: 7 condiciones constitutivas (K-1 … K-7).** Sin circularidad y **sin condiciones sin guardián**. Dos resultados de la verificación:
- *Evolución compatible* es **Caso 3 (protección parcial)**, no Caso 2: el Art. 8.4 protege la identidad **normativa**, la regla protegía además la **deriva fáctica**. Nivel II confirmado con fundamento corregido.
- **C-9 abierto:** se está clasificando el corpus apoyándose en reglas constitucionales (Art. 1, 3–7, 8.2–8.4 y #2) que **aún no tienen plano ni nivel asignado**.

**Decisiones finales (2026-07-19):** *Evolución compatible* → II con fundamento **sustituido** (Caso 3, no Caso 2) — precedente metodológico · **C-9 cambia de naturaleza**: no es defecto arquitectónico sino **dependencia de secuencia**, se resuelve completando la clasificación, sin enmienda · **descomposición previa** confirmada como regla permanente · *Transparencia organizacional* → **derivación** tras el contrafáctico.

**⚠ Consecuencia aritmética:** al salir *Transparencia organizacional* del corpus clasificado, la distribución pasa de **7–33–1 (41)** a **7–32–1 (40)**. No es una reclasificación: es una regla que abandona la clasificación hacia el registro de derivaciones.

## ✅ CLASIFICACIÓN DEL CORPUS #3 Y #4 — EMITIDA Y SINCRONIZADA (2026-07-19)

Emitida formalmente por la Autoridad Constitucional (Art. 8.6, #6 §1) y reflejada en el Registro (#5 §7), con lo que **la clasificación existe plenamente** (#5 §2.1).

- **40 reglas · 7 – 32 – 1 · 1 derivación.** Plano *sistema* en todas.
- **Nivel I (7):** No Confusión · No Transferencia de Autoridad · Provisionalidad · Doble Régimen de Revisión · Apropiación Organizacional · El tipo no se autodeclara · No cautividad.
- **Inventario K-1 … K-7** registrado en #5 §7.4: sin circularidad, sin condiciones sin guardián.
- **Verificado:** cero reglas «no asignado» residuales; conteo por nivel confirmado (7 · 20+12 · 1).
- *Carga de la Prueba* queda como **II provisional**; *Evolución compatible* como **II por Caso 3**; *Transparencia organizacional* pasa a derivaciones (#5 §8).

## Secuencia fijada por la Autoridad Constitucional

1. Ratificación regla por regla del **#3** ✅ *(lista preparada)*
2. Ratificación regla por regla del **#4** ✅ *(lista preparada)*
3. Clasificar **#1 y #2** → resuelve C-9
4. Clasificar **#5, #6, #7 y #8**
5. Cerrar definitivamente **C-9**
6. Recién entonces abrir el **#9 — Arquitectura Conceptual**

## 🏛️ ETAPA CONSTITUCIONAL — CERRADA (2026-07-19)

**La Constitución pasa de objeto de trabajo a insumo.** Modo de trabajo: *interpretar antes que enmendar, aplicar antes que ampliar, ejecutar antes que discutir.* Toda enmienda futura exige demostrar **contradicción estructural** o **laguna constitucional real**.

- **Capa constitucional #1–#8 completa**, Constitución **v1.6**.
- **Clasificación del corpus constitucional completa: 99 reglas · 21 – 71 – 7 · 16 condensadores.** Detalle en #5 §9 (Estado Constitucional Definitivo).
- **#2: cero reglas clasificables** — documento íntegramente condensador del Art. 2.
- **Inventario final K-1 … K-19** (8 sistema · 11 meta) + condiciones de las reglas meta ya registradas.
- **C-9 cerrado.** Verificado: sin reglas sin clasificar, sin circularidad, sin condiciones sin guardián, sin duplicaciones.
- **Hallazgos abiertos:** C-4, C-5, C-6 (condicionados a eventos futuros) · **C-7** (resuelto, con residual C-8) · **C-8** (pregunta declarada del #6 ↔ reglas sobre documentos).

## Historial — Clasificación de #1 y #2 (cerró C-9)

**Constitución v1.5 — Art. 8.5.ter:** protocolo para reglas autorreferentes (objeto inmediato · anterioridad de la condición · contrafáctico sin el resultado), más la columna documental *dependencia autorreferente*. Se alojó en el Art. 8 y no en la matriz: es permanente, y una regla normativa en documento no normativo reproduciría C-7.

**Matriz preparada:** `docs/decisions/matriz-clasificacion-corpus-1-2.md`.

- **#1 — 27 reglas · 8 – 16 – 3.** El Nivel III deja de estar vacío (lengua, régimen de Git, orden de redacción): confirma que emerge donde hay **decisiones operativas**, no principios.
- **Verificación autorreferente superada:** ninguna clasificación rechazada por circularidad. El régimen se clasificó a sí mismo **con los mismos criterios** que aplicó al resto — sin excepciones.
- **Condiciones nuevas K-8 … K-15**, siete de ellas del plano meta-normativo.
- **#2 resuelto: documento mixto.** 4 enunciados condensadores (§1, §3, §4, §5 → remisión al Art. 2) · 2 innovadores propuestos en Nivel II (§6 prohibición de inversión medio/fin · §7 el horizonte no define el objetivo).

**Constitución v1.6 — Art. 7.5 ampliado:** *dónde nace una norma* (la identidad de la fuente declarante depende del acto que originalmente declara, no del documento donde aparece; copiar, condensar, citar o reorganizar **no** genera declaración nueva) y distinción **condensador / innovador**, que se determina **enunciado por enunciado, no en bloque**.

**Distribución conjunta propuesta #1 + #2: 29 reglas · 8 – 18 – 3**, más 4 condensadores como remisión.

## Documento #9 — Arquitectura Conceptual: 🔵 v1.0 redactado

Alcance validado por el Director de Arquitectura y **#9 redactado en un bloque continuo** bajo el nuevo modo de trabajo. Mapa de alcance: `docs/architecture/_alcance-09-arquitectura-conceptual.md`.

- **Tres planos** (Realidad · Representación · Apropiación) y cinco bloques (Ontología · Relaciones · Límites · Ciclos · Invariantes).
- **Entidades situadas, no desarrolladas:** Empresa, Mundo, Representación, Modelo (MED/MDM/otros), ECE, Afirmación, Evidencia, Historia epistemológica, Comprensión organizacional, Persona.
- **10 invariantes** conceptuales; **8 límites** derivados de condiciones ya ratificadas.
- **Verificado contra la prueba de calidad:** sin lenguaje de implementación, sin tiempo futuro de desarrollo, ninguna entidad explicada por dentro (regla de las cuatro preguntas). No redefine ninguna entidad constitucional.

## Capa de dominio en curso — #10 MED y #11 MDM redactados

**#9 → v1.1:** incorporados los invariantes de familia de modelos —**Simetría** (misma anatomía, distinto dominio) y **Marco/Instanciación**—, decisión del Director de Arquitectura al validar el #10. Laguna real (la entidad *Modelo* carecía de estos invariantes), no refinamiento; su domicilio es #9 por Fuente Declarante Única.

**Directiva permanente adoptada:** todo documento de modelo abre con la frase fija *«Este documento desarrolla el interior de una entidad ya situada por el #9; ninguna definición aquí modifica su existencia, límites o relaciones arquitectónicas.»*

**#11 MDM redactado presumiendo simetría con el MED:** hereda por remisión anatomía, marco/instanciación, ciclo de vida e invariantes; desarrolla solo lo propio del dominio —**tres diferencias esenciales**: ajenidad (el mundo no se controla), acceso mediado (evidencia más débil, más incertidumbre declarada) y cambio autónomo (peso en detectar el cambio no informado)— y el criterio interno de la frontera MED╪MDM.

## Historial — Documento #10 (MED)

#9 **aprobado como documento raíz de la capa conceptual** (estable; no se reabre salvo contradicción estructural). Patrón adoptado: cada documento conceptual abre con **«Relación con el Documento #9»** (entidad que desarrolla · límites que hereda · invariantes que respeta).

**#10 redactado**, primer desarrollo de dominio: el interior del MED. Estrena la sección de relación con el #9.
- **Decisión de diseño interna (framework-consistente, no eleva a primer nivel):** el MED se define como **marco extensible de dimensiones**; el contenido de una organización concreta es **instanciación**, no parte de la definición conceptual. Derivada de la extensibilidad ratificada + universalidad progresiva.
- Anatomía, ciclo de vida y **7 invariantes internos** especializando los del #9. Sin redefinir ninguna entidad del #9. Verificado: sin lenguaje de implementación.

## En curso — #13 Sistema de Inteligencia (alcance)

**#12 aprobado definitivamente.** Alcance funcional reducido del #13 preparado (`docs/ai/_alcance-13-sistema-de-ia.md`): cuatro preguntas —qué es operar intelectualmente · sobre qué · qué produce · qué queda fuera— + **invariante operativo de soberanía**: *la IA produce hipótesis; nunca sustituye la soberanía de la persona*.

**El #13 se organiza alrededor de las *operaciones intelectuales*** (explicar, diagnosticar, inferir, proyectar, generar hipótesis, orientar…), no de tecnologías de IA.

**Decisión de nombre pendiente del Director:** el contenido trasciende la tecnología → «Sistema de IA» está en tensión con Independencia Tecnológica. Recomendado un nombre conceptual (*Sistema de Inteligencia* / *de Operaciones Intelectuales*). Cambiarlo actualiza el índice (no normativo, costo bajo).

## 🧊 CAPA CONCEPTUAL Y DE DOMINIO — CONGELADA (2026-07-19)

**Gate de Arquitectura superado** (`docs/architecture/_gate-arquitectura-capa-conceptual.md`): grafo de dependencias **acíclico**; sin referencias invertidas, duplicaciones, entidades huérfanas, operaciones sin consumidor, capacidades sin propósito ni invariantes incompatibles. Una observación menor (O-1: el *marco/instanciación* del #9 se generaliza a operaciones y capacidades), resuelta por interpretación, sin enmienda.

**Congelamiento:** #9–#14 no se modifican durante la construcción técnica. Reapertura solo por contradicción estructural, imposibilidad arquitectónica o inconsistencia demostrable — nunca por redacción ni comodidad de implementación; por el circuito #8→#6→#7→#5.

## Detalle — capa #9–#14

Arco cerrado: **#9 sitúa → #10 MED / #11 MDM representan → #12 ECE integra → #13 opera → #14 materializa.**

| Elemento | Documentos | Categoría |
|---|---|---|
| Mapa raíz | #9 (v1.1) | — |
| Representaciones | #10 MED · #11 MDM · #12 ECE | Estructurales |
| Facultades | #13 Operaciones Intelectuales · #14 Capacidades | Dinámicos |

**#14 redactado:** capacidad = composición de operaciones con propósito humano (nunca al revés). Jerarquía **ECE → Operaciones → Capacidades → Persona**. Marco extensible de familias (comprender el estado · detectar lo no visto · anticipar · preservar y transmitir · orientar la decisión); anatomía de 4 elementos; 8 invariantes internos. Verificado: sin implementación (pantallas/APIs/agentes/flujos), prueba de eliminación del #16 superada.

## Historial — Documento #13

**Elevación resuelta por el Director:** dos categorías arquitectónicas ratificadas —**Elementos Estructurales** (#10–#12, bloque I del #9) y **Elementos Dinámicos** (#13–#14, bloque IV)—, sin enmendar el #9. Regla metodológica: *cada documento desarrolla un elemento situado por el #9, estructural o dinámico*. Nombre fijado: **Sistema de Operaciones Intelectuales** (descartados «IA» y «Inteligencia»).

**#13 redactado:** desarrolla el elemento dinámico —las operaciones intelectuales del ciclo del #9—. Marco extensible de operaciones (esclarecer · detectar · proyectar · orientar); productos ofrecidos al juicio humano con incertidumbre y atribución; **invariante de soberanía** sostenido por topología (el lazo se cierra fuera del sistema); 9 invariantes internos. Verificado: sin tecnología concreta, prueba de eliminación del #14 superada.

## Historial — Elevación del #13 (resuelta)

Condición de parada activada. Registro: `docs/decisions/elevacion-naturaleza-documento-13.md`. **No se redacta el #13 hasta la decisión.**

**Hallazgo:** el #13 **no desarrolla una entidad** de la Ontología del #9 — describe una **actividad**. Está situado, pero en el **bloque IV (Ciclos)**: las operaciones intelectuales del ciclo Comprender→Aprender→Adaptarse→Orientar. El patrón se precisa: *cada documento desarrolla un elemento situado por el #9, que puede ser **entidad** (bloque I) o **facultad/ciclo** (bloque IV)*. La capa de dominio tiene dos categorías —Representaciones (#10–#12) y Facultades (#13–#14)—; el #9 ya contenía ambas, no requiere enmienda.

**Decisiones pendientes del Director:** (1) ratificar la lectura de dos categorías; (2) nombre del #13 derivado de la facultad —recomendado *Operaciones Intelectuales*—.

## 🏁 CAPA DE EJECUCIÓN COMPLETA (#17–#19) — BIBLIOTECA MAESTRA 19/19

Los tres documentos de ejecución redactados, estrictamente operativos (ninguno introduce arquitectura nueva):
- **#17 Roadmap Maestro** — fases de construcción en orden de dependencia (Base técnica → Modelos → ECE → Operaciones → Capacidades); avance gated por conformidad #15; priorización concreta = instanciación estratégica (#6).
- **#18 Manual del Ingeniero** — reúne la Fundación en práctica diaria: método de 7 fases, checklist de reglas permanentes con puntero a su fuente, cuándo detenerse y elevar. No crea reglas.
- **#19 Orden de Inicio de la Fase 1** — la puerta (Art. 3.2): declara el cierre de la Fundación en 4 capas, el régimen posterior, y **habilita** la decisión del Propietario de inicializar Git e iniciar la Fase 1.

**Régimen posterior:** interpretar antes que enmendar · capa congelada intacta salvo contradicción · todo cambio por el circuito #8→#6→#7→#5.

## Historial — capa técnica (#15–#16)

**#16 Arquitectura Técnica redactado:** instancia la arquitectura congelada sin redefinirla (verificado: cero definiciones nuevas). Doctrina propia: **Regla de Estratificación Técnica A/B/C** —irreemplazable (estructura derivada) · sustituible con adaptación · reemplazable sin impacto—. Componentes técnicos con rol Nivel A y realización Nivel C; el **órgano de IA es Nivel C por diseño** (demostración de Independencia Tecnológica). Prueba de reemplazabilidad superada: eliminar IA/BD/framework deja la arquitectura intacta. Selección concreta de productos = instanciación diferida a la autoridad competente.

Jerarquía de realización completa: **Principio (#4) → Método (#7) → Estándar (#15) → Implementación (#16)**, distinta de la jerarquía de capas y sin mezclarse con ella.

## Historial — Documento #15

Primer documento de la **capa técnica**. Convierte los principios congelados en criterios **objetivos, verificables y auditables**, sin redefinir ninguno (verificado: cero definiciones nuevas; 18 estándares con fuente citada).

- **Premisa:** la implementación se verifica contra la arquitectura; nunca la arquitectura se adapta al código (Art. 3 + congelamiento).
- **9 estándares de conformidad arquitectónica** (atribución, no confusión, historia inmutable, explicabilidad, soberanía, alcance transportado, no-elevación de certeza, anti-atrofia, extensibilidad), cada uno con su forma de auditoría.
- Estándares de proceso, calidad e invariantes de los estándares.
- **Umbrales y herramientas concretas = instanciación** diferida a que #16 fije la tecnología (mismo patrón marco/instanciación).

## Próximo paso — dos decisiones del Propietario, ninguna ejecutada aún

1. **Inicializar Git** (Art. 6.2) — marca el inicio oficial del desarrollo.
2. **Iniciar la Fase 1 — Desarrollo**, cuando se decida.

Ambas quedaron **deliberadamente diferidas** a la decisión explícita del Propietario. La Biblioteca las habilita; no las ejecuta.

**Cuando comience la Fase 1**, el primer trabajo del roadmap (#17) es la **Fase 1 — Base técnica**: instanciar las estructuras Nivel A tras sus fronteras.

**Secuencia de arranque recomendada por el Director de Arquitectura** (no funcionalidades visibles primero):
1. Instanciar la **Base Técnica** respetando las estructuras Nivel A (#16).
2. **Verificar** que la infraestructura satisface los estándares del #15.
3. **Inicializar el repositorio** (Git) solo cuando exista un primer estado base coherente para versionar (Art. 6.2).
4. Construir **incrementalmente** modelos → ECE → operaciones → capacidades, por el grafo de dependencias aprobado (#17).

> **Precisión de gobernanza:** esta secuencia sitúa la inicialización de Git en el paso 3, cuando exista base técnica versionable. Es coherente con el Art. 6.2 (Git marca el inicio del desarrollo). La *orden* de iniciar la Fase 1 y la *ejecución* de cada paso siguen siendo decisiones explícitas del Propietario; la Biblioteca las habilita, no las dispara.

**Régimen:** interpretar antes que enmendar · capa congelada intacta salvo contradicción · todo cambio por el circuito #8→#6→#7→#5.

**Cambio de criterio de evaluación (desde la Fase 1):** la pregunta deja de ser *«¿la Fundación es correcta y consistente?»* y pasa a ser *«¿la implementación mantiene la conformidad con la Fundación?»*. Cada decisión de ingeniería —cada ADR, componente e incremento— debe **justificarse contra la Biblioteca ya aprobada**, sin trasladar autoridad desde la implementación hacia la arquitectura. El rol de supervisión verifica conformidad, no redefine principios.

Hallazgos abiertos (no bloqueantes): C-4, C-5, C-6, C-8, residual de C-7.

## Historial — Documento #12 (ECE)

Alcance validado y **#12 redactado en un bloque**. Principio rector (Director de Arquitectura): **«El ECE transforma representación en comprensión integrada; nunca transforma comprensión en acción.»** Unifica las dos fronteras (integra conocimiento/no inteligencia · establece estructura/no decisión) en una sola línea: *lo que el ECE **es*** vs *lo que otras capas **hacen** con él*.

- Define **qué significa integrar** (coherencias, contradicciones, ausencias, dependencias, brechas — comprensión, no inteligencia; es la *coherencia gobernada* de #3).
- **7 invariantes internos**, incluido «no origina afirmaciones sobre el mundo» y «la integración no eleva la certeza».
- Sin lenguaje de implementación (motor/pipeline/orquestador/…): verificado, cero apariciones. Prueba de eliminación del #13: pasa.

## Próximo paso

Revisión de **#10, #11 y #12**. Después: **#13 Sistema de IA** —lo que *opera intelectualmente* sobre el ECE: razonar, aprender, recomendar; con la frontera del #12 ya trazada—. Luego #14 Capacidades.

Hallazgos abiertos (no bloqueantes): C-4, C-5, C-6, C-8, residual de C-7.

Hallazgos abiertos (no bloqueantes): C-4, C-5, C-6, C-8 y el residual de C-7.

Hallazgo abierto adicional: **C-8** (la pregunta declarada del #6 se refiere a actores, pero aloja reglas sobre documentos).

Hallazgos abiertos: **C-8** (jurisdicción del #6 — trazabilidad propia, no mezclar) · C-4, C-5, C-6 (condicionados a eventos futuros).

## Bitácora

| Fecha | Bloque cerrado | Notas |
|---|---|---|
| 2026-07-19 | Scaffolding Fase 0 | Estructura conocimiento-primero creada. Raíz oficial confirmada en `C:\proyectos\SOEC`. |
| 2026-07-19 | Índice + doc #1 (borrador) | Creado `docs/00-INDICE-BIBLIOTECA-MAESTRA.md` (mapa de los 19 documentos) y `docs/constitution/01-constitucion-maestra.md` v0.1. Git sigue sin inicializar por directiva. |
| 2026-07-19 | Fase 0.A concluida | 6 bloques de descubrimiento ratificados: categoría (Sistema Operativo Empresarial Cognitivo), problema (incapacidad cognitiva creciente), necesidad (dependencia social de organizaciones complejas), diferenciación (infraestructura cognitiva / diferenciación por misión), propósito (autonomía intelectual) y principios de identidad (Deber/Límites/Carácter con Prueba de Propósito). |
| 2026-07-19 | Constitución v0.2 | Artículo 2 (Identidad de SOEC) completado con la visión ratificada; añadidos preámbulo civilizatorio, Art. 5.7 (honestidad intelectual) y Art. 8 (tres niveles de permanencia + Prueba de Propósito). |
