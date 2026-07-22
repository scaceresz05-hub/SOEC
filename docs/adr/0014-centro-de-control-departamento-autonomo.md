# ADR-0014 — Centro de Control del Departamento Autónomo (F2-CTRL-01)

- **Estado:** ✅ **ACEPTADO.** Sexta vertical del Departamento de Marketing Autónomo: la experiencia de dirección, gobierno y control. Continúa ADR-0009…0013, sin abrir circuito de enmienda.
- **Fecha:** 2026-07-21 · **Bloque:** F2-CTRL-01.

## Contexto

Las cinco verticales previas construyeron el ciclo completo (objetivo → plan → contenido → publicación → medición → optimización), pero cada una vivía en su propia experiencia. Faltaba una **experiencia integrada de supervisión y gobierno** que permita al propietario comprender, autorizar, limitar, pausar y auditar al departamento **sin operarlo cotidianamente**. Este ADR fija el **Centro de Control** (`@soec/control` + experiencia `/control`): reúne todo el ciclo mediante contratos públicos y proyecciones, con salud determinista, interruptor maestro de pausa, bandeja de decisiones, alertas y auditoría. Modo real desactivado; ningún efecto/gasto real.

## Decisiones

### D-1. El propietario dirige; SOEC realiza el trabajo *(Nivel A — §2)*

La experiencia prioriza **estado, excepciones, presupuesto, resultados, riesgos, próximas operaciones, decisiones pendientes y trazabilidad**; NO editores manuales, creación individual de publicaciones ni listas de microtareas. El lenguaje es de **trabajo realizado** («SOEC pausó la actividad… el plan quedó versionado»), no consultivo.

### D-2. Modelo de lectura integrado; no es otra fuente de verdad *(Nivel A — §3)*

El resumen del departamento se **compone en la capa de aplicación** a partir de **contratos públicos y proyecciones** de marketing, contenido, canales, medición, operacional y control. El paquete `@soec/control` **no importa los dominios operativos** (prueba arquitectónica): solo aporta sus propios agregados (pausa, decisiones, buzón) y los **tipos** del modelo de lectura. La composición **no recalcula indicadores, no reinterpreta estados, no muta agregados** de otros módulos.

### D-3. Salud operacional por precedencia determinista *(Nivel A — §4.2, §16)*

La salud (saludable / advertencias / degradado / parcialmente_bloqueado / intervencion_requerida / pausado / sin_informacion) se **deriva de señales explícitas** por una regla de precedencia documentada (1 pausa total · 2 riesgo crítico · 3 intervención requerida · 4 bloqueo significativo · 5 advertencias · 6 saludable · 7 sin datos), no de una descripción generativa libre.

### D-4. Interruptor maestro de pausa, real e integrado *(Nivel A — §9)*

La pausa (departamento, canal, campaña o tipo de acción) es event-sourced con propagación (la pausa total cubre todo) y **está integrada con la ejecución**: cuando hay pausa, el ciclo **no produce nuevos efectos ejecutables** (publicar, optimizar con efecto, escalar), mientras que **lecturas, verificación y auditoría continúan**. No es una pausa visual: el ciclo consulta la pausa antes de cada efecto y la respeta (verificado en vivo: `simular` estando pausado → 0 efectos).

### D-5. Bandeja de decisiones con permisos por rol *(Nivel A — §11, §20)*

Las decisiones que exceden la autonomía delegada (escalamiento, presupuesto, habilitar canal, cambio de modo…) se registran como **pendientes** y se resuelven (aprobar/denegar/modificar/posponer) con **control de permisos por rol** (propietario/supervisor/observador/operador técnico); una decisión de **alto riesgo exige `aprobar_alto_riesgo`**. Al **aprobar** un escalamiento, el efecto se aplica como **cambio versionado del plan** por el contrato público de marketing. No existe aprobación genérica sin alcance; una decisión resuelta no se re-resuelve.

### D-6. Alertas deduplicadas, notificaciones internas y auditoría integral *(Nivel A — §17, §18, §19)*

Las **alertas** (gasto anómalo, publicación fallida/desconocida, credencial, activo, política…) se persisten con severidad, evidencia, acción automática/humana y estado, **deduplicadas por clave** mientras estén abiertas. Las **notificaciones** internas (no correos/push reales) referencian la alerta/decisión original. La **auditoría** reconstruye la cadena objetivo → plan → actividad → paquete → publicación → medición → optimización a partir de productos persistidos, sin exponer secretos.

### D-7. Modo visible; el modo real permanece desactivado *(Nivel A — §8)*

La experiencia distingue inequívocamente simulado/sandbox/real_desactivado/real_habilitado, con señalización persistente. En este bloque solo simulado/sandbox operan; el **real permanece desactivado**; ninguna interfaz induce a creer que hubo publicaciones/gasto reales.

## Consecuencias

- El propietario puede **comprender y gobernar** todo lo que SOEC hace desde un único centro, interviniendo solo ante decisiones estratégicas, riesgos o excepciones.
- Se preservan intactos: propósito raíz, soberanía transformada, no-vinculación del conocimiento, y los guardarraíles de ningún efecto/gasto real y modo real desactivado.
- Se habilita **F2-PILOT-01** (piloto real acotado), que requerirá una **decisión estratégica expresa** (empresa/marca/objetivo/canal/cuenta/contenido/presupuesto/modo/nivel/aprobación/pausa/duración/indicadores/criterios de éxito y suspensión). Hasta entonces, todo efecto externo real continúa **prohibido**.

## Complemento — F2-CTRL-HARD-01: endurecimiento genérico previo al piloto (2026-07-21)

Revisión arquitectónica previa a F2-PILOT-01: se confirmó que el núcleo de `@soec/control` (salud, pausa, decisión, buzón, roles) ya es genérico y que el acoplamiento a marketing es **superficial y concentrado** en contratos de lectura y catálogos cerrados. Se aprobó la **Opción A** (endurecimiento mínimo), rechazando tanto dejar las fricciones (B) como introducir un puerto universal con un solo consumidor (C). Regla de gobierno: *preparar los puntos de extensión evidentes, pero extraer la abstracción completa solo cuando existan dos implementaciones reales.*

- **D-8. Catálogos extensibles.** `TipoDecision` y `TipoAlerta` pasan de uniones **cerradas** a catálogos **abiertos** (`string`): un departamento futuro puede registrar sus propios tipos **sin modificar `@soec/control`**. El núcleo valida **formato** (no membresía) y rechaza vacíos/malformados; los valores conocidos viven en un **catálogo base documentado** (`CATALOGO_DECISION_MARKETING`, `CATALOGO_ALERTA_MARKETING`) claramente separado de las primitivas. Los **estados** (`pendiente`/`aprobada`/…, `abierta`/`atendida`/…) permanecen como uniones **cerradas**. Sin migración de datos.
- **D-9. Pausa por alcance genérico.** El chequeo de pausa opera sobre `Alcance {tipo, valor}` genérico, por **igualdad + precedencia** (la pausa global precede), **sin condicionales que nombren `canal`/`campania`**. El llamador aporta la cadena de ancestros (organización → departamento → módulo/capacidad → entidad). Un alcance futuro válido (p. ej. `inventario:almacen-1`) funciona sin tocar el agregado. Los eventos ya persistidos (`{tipo, valor}`) son compatibles sin migración.
- **Diferido explícitamente:** el puerto universal «Módulo de operación» y el resumen totalmente genérico se posponen hasta un **segundo departamento real**; la abstracción se extraerá de dos consumidores, no de una proyección especulativa.

## Trazabilidad

ADR-0009…0013 (las cinco verticales que el Centro de Control integra) · Const. v1.7 Art. 2.1/2.4 · #14 §6 (dos clases de capacidad) · #16 (interfaz como realización, Nivel C). El Centro de Control no revisa el propósito raíz (2.2) ni toca la capa congelada; las decisiones de interfaz no se elevan a Constitución.
