# ADR-0033 — PCE-1 · SOEC como Producto Autónomo (Director de Marketing Autónomo)

Estado: aceptado · Fecha: 2026-08-04 · Rama: `feat/macrobloque-4d`

## Cambio de etapa

Con M5–M9 el "cerebro" de SOEC está completo (conoce, diseña, opera, aprende, optimiza) EN MODO SIMULADO.
PCE-1 no añade motores: convierte ese cerebro en un **producto usable**. SOEC deja de ser una plataforma de
módulos y pasa a comportarse como un **Director de Marketing Autónomo**. La misión del usuario se reduce a
definir: **objetivos, presupuesto, restricciones y nivel de autonomía**. Todo lo demás recae en SOEC.

## Leyes permanentes (gobiernan toda decisión futura)

- **LEY 1** — el éxito de SOEC se mide por **la cantidad de trabajo que deja de hacer el usuario**, no por
  cantidad de funciones.
- **Principio de Reducción** — nunca pedir un dato que SOEC pueda obtener/inferir/aprender/calcular/
  experimentar/validar/medir/descubrir por sí mismo.
- **Principio de Excepción** — SOEC sólo interrumpe al usuario para: una decisión humana, un riesgo, una
  excepción o una aprobación. Nunca por trabajo rutinario.
- **Reglas de pantalla** — cada pantalla justifica su existencia con «¿esto requiere una decisión humana?»;
  toda pantalla pasa «¿puede desaparecer?»; la experiencia parece una conversación, no un panel técnico; si
  una persona común no la entiende en minutos, se simplifica. El objetivo es OCULTAR la complejidad.

## Auditoría de la experiencia actual (fricción detectada)

La navegación actual (`apps/web/app/layout.tsx`) expone **12 enlaces de módulos** que reflejan los motores
internos, obligando al usuario a operarlos y a "comprender el estado" por sí mismo (el propio título es
«Comprender el estado de mi empresa» — el trabajo de comprender lo hace el usuario):

| Fricción actual | Por qué viola las leyes | Destino en PCE-1 |
|---|---|---|
| 12 módulos en la barra (Evaluación, Director Workspace, Programas, Marketing, Contenido, Publicación, Medición, Control, Piloto…) | El usuario navega y opera motores | **Desaparecen** de la navegación; su salida se presenta como trabajo hecho / decisiones |
| Pantallas por módulo (formularios, tablas, KPIs sueltos) | El usuario arma la conclusión | Consolidadas en **HOME** (qué hizo SOEC) y **Explicaciones** (por qué) |
| Configuración dispersa por módulo | Pide datos que SOEC infiere/mide | **Onboarding** único con SOLO lo no descubrible; el resto lo aprende SOEC |
| Sin bandeja única de decisiones | El usuario busca dónde aprobar | **Bandeja de Decisiones** única (M9 propuestas PENDIENTE_APROBACION) |
| Niveles de autonomía implícitos/técnicos | El usuario no controla cuánto delega | **Modo Autónomo** explícito (reusa niveles M4-D) |

**Conclusión de la auditoría:** el producto actual hace trabajar al usuario en navegación, comprensión,
configuración y operación. PCE-1 elimina las cuatro.

## Arquitectura UX de PCE-1 (todo consume M5–M9; ningún motor nuevo)

La navegación de 12 módulos se reemplaza por **una conversación con 3 superficies + configuración mínima**:

### 1. HOME — «¿Qué hizo SOEC por mí?»
Reemplaza el paradigma de módulos. No muestra Marketing/CRM/KPIs: muestra **trabajo realizado, decisiones
pendientes y avance de objetivos**, en lenguaje de Director.
- «Mientras no estabas» — actividad de M7 (ejecuciones) + M8 (aprendizajes) resumida. Fuente:
  `LecturaOperativa` + `LecturaMedicion.memoria`.
- «Necesito tu decisión» — enlace a la Bandeja. Fuente: `LecturaCicloSOEC.listarPropuestas` (PENDIENTE).
- «Objetivos actuales» — avance vs meta. Fuente: `LecturaMedicion` (evaluaciones) + Objetivos (M5 OBJETIVO).

### 2. BANDEJA DE DECISIONES — sólo decisiones humanas
Contiene ÚNICAMENTE lo que la LEY de Excepción permite interrumpir: propuestas de M9 que requieren
aprobación. Acciones: **Aprobar · Rechazar · Solicitar más información · Posponer**. Nada operativo.
Fuente: `LecturaCicloSOEC.listarPropuestas` (estado PENDIENTE_APROBACION) → `PropuestaService.aprobar/rechazar`
(aprobación HUMANA canónica de M9). Cada decisión trae su explicación embebida.

### 3. CENTRO DE EXPLICACIONES — «¿Por qué?»
SOEC explica, para cualquier acción o propuesta: qué hizo, por qué, qué evidencia usó, qué descartó, qué
aprendió, qué recomienda, qué NO recomienda, qué necesita del usuario. Fuente directa de las explicaciones ya
producidas por los motores: `EvaluacionOperacion.explicacion` (M8), `Recomendacion` (M8),
`AlternativaComparada.dimensiones/explicacion` y `CuerpoPropuesta.explicacion` (M9). **No se genera texto
nuevo: se surface la explicabilidad que M8/M9 ya emiten.**

### Configuración mínima (sólo lo no descubrible)

- **ONBOARDING** — SOLO preguntas que SOEC jamás podrá descubrir solo: nombre de empresa, qué vende, objetivo,
  presupuesto, restricciones, qué autoriza automáticamente, qué desea aprobar personalmente. Todo lo demás
  (segmentos, hipótesis, mensajes, calendario, métricas…) lo aprende/infiere SOEC (M5→M9). El onboarding
  siembra M5 (EMPRESA/OBJETIVO/PROPUESTA_VALOR) y la política de autonomía; nada más.
- **MODO AUTÓNOMO** — 4 niveles explícitos, reusando la activación gobernada de M4-D
  (`nivelActivacion` event-sourced): **Solo observar · Recomendar · Ejecutar con aprobación · Ejecutar
  automáticamente**. `AUTONOMOUS_REAL` permanece bloqueado; en simulado, "ejecutar" = aplicar la propuesta M9
  (nueva versión). Cambiar de nivel es un acto humano registrado (reusa M4-D `cambiarNivel`).
- **OBJETIVOS** — SOEC trabaja para cumplir OBJETIVOS, no para ejecutar campañas. Un objetivo = afirmación M5
  de clase OBJETIVO + su KPI (M8). El avance se mide, no se pregunta.
- **POLÍTICAS** — pocas y realmente importantes (presupuesto, riesgo aceptable, qué aprobar personalmente),
  no cientos de opciones. Alimentan `PoliticaOptimizacion`/`PoliticaOscilacion` (M9) y el presupuesto (M4-D).

### Navegación redefinida
De 12 módulos a: **Inicio (HOME) · Decisiones · Explicaciones**, más un acceso discreto a Objetivos/Autonomía/
Políticas (configuración que rara vez se toca). Sesión y Organización quedan fuera del flujo diario.

## Mapa "una superficie → un puerto de lectura" (sin motores nuevos)

| Superficie PCE-1 | Puerto/motor que la alimenta | Escritura (sólo decisiones humanas) |
|---|---|---|
| HOME · trabajo hecho | `LecturaOperativa` (M7) + `LecturaMedicion` (M8) | — |
| HOME · objetivos | `LecturaMedicion` (M8) + M5 OBJETIVO | — |
| Bandeja de Decisiones | `LecturaCicloSOEC.listarPropuestas` (M9) | `PropuestaService.aprobar/rechazar/aplicarSimulado` (M9) |
| Centro de Explicaciones | `EvaluacionOperacion`/`Recomendacion` (M8), `PropuestaOptimizacion` (M9) | — |
| Onboarding | — (siembra) | `EscrituraConocimiento` (M5) + política de autonomía (M4-D) |
| Modo Autónomo | `RegistroAdaptador.nivelActivacion` (M4-D) | `cambiarNivel` (M4-D, acto humano) |
| Objetivos | M5 OBJETIVO + `LecturaMedicion` (M8) | `EscrituraConocimiento` (M5) |
| Políticas | `PoliticaOptimizacion`/`PoliticaOscilacion` (M9) + presupuesto (M4-D) | política humana |

## Autoauditoría (fricción hallada → corregida en el diseño, no reportada)

- ¿El usuario debe elegir "qué medir"? **No** — el KPI del objetivo lo fija SOEC (M8); se eliminó de la config.
- ¿El usuario arma reportes? **No** — el "reporte" es HOME + Explicaciones, generado por M8/M9; se eliminó la
  pantalla de reportes.
- ¿El usuario navega a "Medición/Marketing/Contenido"? **No** — esas superficies desaparecen; su salida vive en
  HOME/Explicaciones.
- ¿El usuario configura segmentos/hipótesis/mensajes? **No** — los descubre M5/M6; fuera del onboarding.
- ¿El usuario decide cuándo optimizar? **No** — M9 abre ciclos; el usuario sólo aprueba en la Bandeja.

## Prototipo viewable

Se entrega un prototipo de alta fidelidad, autocontenido y theme-aware, de la nueva experiencia (HOME,
Bandeja de Decisiones, Centro de Explicaciones, Onboarding, Modo Autónomo, Objetivos), para evaluar en minutos
si «SOEC se comporta como un Director de Marketing Autónomo». Los datos del prototipo son ilustrativos y
SIMULADOS; su modelo mental es exactamente el de los puertos M5–M9 (no inventa capacidades).

## Criterio de cierre

PCE-1 define la experiencia que hace que «SOEC se comporte como un Director de Marketing Autónomo, no como un
software de marketing»: navegación por conversación (3 superficies), onboarding sólo con lo no descubrible,
decisiones separadas de la operación, explicabilidad de primera clase, autonomía explícita y reutilización
total de M5–M9. La implementación productiva de `apps/web` sobre estos puertos (y su exposición vía `apps/api`)
es el tramo de ingeniería siguiente; esta ADR + prototipo fijan la arquitectura de producto que lo gobierna.
