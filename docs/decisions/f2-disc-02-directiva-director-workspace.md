# Directiva F2-DISC-02 — Director Workspace (consumidor de gobierno)

> **Documento de diseño aprobado** por la Autoridad Estratégica (2026-07-23). Base del bloque de implementación. Subordinado al Modelo Operativo y a F2-DISC-01 (cerrado).
>
> **Estado:** ✅ Diseño aprobado — implementar en bloque separado, deteniéndose antes de cualquier paso hacia Preparación.

## §0. Encuadre
F2-DISC-01 construyó los **motores** (Rubros → Diagnóstico → Estrategia → Decisión). Este bloque construye el **consumidor** que permite a un humano gobernarlos. Misma disciplina: **motor primero, consumidor después**. No ejecuta trabajo: hace **visible, explicable y gobernable** todo lo construido. Límite permanente: **Decisión ≠ Preparación ≠ Operación**.

## §1. Objetivo
Que un **Director** pueda, desde un solo espacio, comprender lo que SOEC entendió, evaluar los candidatos y su fundamento completo, y **registrar (o no) una decisión humana** trazable — sin ejecutar nada sobre el negocio.

## §2. Nombre transversal
**Director Workspace** (no «UI», «panel» ni «dashboard»): el nombre vale para todo departamento (Marketing, Ventas, Finanzas, RR.HH., Compras, Operaciones); solo cambia el `departamentoId`. El Director siempre gobierna desde el mismo espacio.

## §3. Preguntas de gobierno que debe responder
¿Qué comprendió SOEC? · ¿Qué evidencia usó? · ¿Qué falta? · ¿Qué objetivos propone y **por qué cada uno**? · ¿Qué **alternativas** hay? · ¿Qué **implicancias regulatorias** observa? · ¿Qué ocurre **si acepto** / **si rechazo**? · ¿Qué decidí antes? · ¿Qué objetivo está **vigente** y por qué?

### §3.bis. Sección permanente «Transparencia» (ajuste 1)
Además de evidencia/contradicciones/faltantes, el Workspace debe hacer explícito **qué NO sabe SOEC**, en una sección permanente:
- **Confianza global** de la propuesta;
- **Supuestos** del rubro que se están utilizando;
- **Incertidumbre** declarada;
- **Próximos datos más valiosos**: qué información reduciría más la incertidumbre.

## §4. Flujo deliberativo — la decisión al final (ajuste 2)
La experiencia NO empieza con botones. El recorrido es:
```
Comprensión → Diagnóstico → Explicación → Alternativas → Impacto → Decisión
```
La decisión debe sentirse como la **consecuencia natural** del análisis, no como la primera acción disponible.

## §5. Trazabilidad expandible completa (ajuste 3)
Cada candidato debe poder expandirse mostrando la **cadena completa**, no solo texto:
```
Objetivo → Mapeo (MAP-*) → Señales (SIG-*) → Hechos (preguntaId/valor) → Respuestas originales
```
Se apoya en `procedencia` del candidato (mapeos/señales/hechos) + la comprensión (hechos) + las respuestas sembradas.

### §5.bis. Modelo de experiencia por niveles epistemológicos (consecuencia de ADR-0017)
La divulgación progresiva **no depende de la UI sino del modelo de experiencia**: el Workspace no se arma como una colección de componentes independientes, sino como una **secuencia de niveles de comprensión** por los que el Director desciende desde la conclusión hasta la evidencia original **sin perder nunca el contexto**. Es una jerarquía **epistemológica**, no de componentes:
```
Nivel 0 — ¿Qué debería saber ahora mismo?            (lo esencial)
Nivel 1 — ¿Por qué SOEC llegó a esa conclusión?      (explicación)
Nivel 2 — ¿Qué evidencia concreta la respalda?
Nivel 3 — ¿Qué falta? ¿Qué contradicciones? ¿Qué supuestos?   (transparencia)
Nivel 4 — Evidencia original (respuestas · señales · mapeos · conocimiento del rubro)
```

**Principio derivado (guía obligatoria del bloque):** *toda afirmación mostrada por SOEC debe ser navegable hasta la evidencia que la sustenta.* No basta con «mostrar la evidencia»: **ninguna conclusión queda aislada**. Desde cualquier elemento del Workspace debe existir un camino para responder «¿de dónde salió esto? ¿qué hecho lo produjo? ¿qué señal se activó? ¿qué regla intervino? ¿qué conocimiento lo respalda?», sin importar cuántos clics requiera.

### §5.ter. Regla de no-interpretación (única fuente de verdad)
**El Director Workspace nunca interpreta; únicamente organiza y presenta el conocimiento producido por los motores.** En concreto, ni la UI ni la capa de experiencia:
- calculan confianza; · resumen reglas; · deciden qué evidencia ocultar; · reconstruyen trazabilidad; · generan explicaciones propias.

Todo ese conocimiento (confianza, explicaciones *detecté/observé/necesito/me falta*, cobertura, advertencias regulatorias, factores de confianza, trazabilidad, vigente/historial) **proviene de los motores** (`@soec/diagnostico`, `@soec/estrategia`, `@soec/decision`); la capa de experiencia solo lo **compone**, y la UI solo decide **cómo recorrerlo**. Es la misma regla del Modelo Operativo — *el modelo de lectura no es una segunda fuente de verdad* —: los motores son la **única fuente de verdad**.

## §6. Acciones — incluir «Cerrar» (ajuste 4)
Las acciones son **Aceptar · Rechazar · Cerrar**. «Cerrar» = revisar y **salir sin registrar ningún evento** (no se llama a `DecisionService`). Así la experiencia **no fuerza** una decisión institucional. No requiere cambios en `@soec/decision`.

## §7. Alcance INCLUIDO (§10 resuelto)
- **Diagnóstico sintético SEMBRADO** (caso conocido y repetible — validamos la *gobernabilidad*, no la captura). El cuestionario interactivo se difiere a **F2-DISC-03**.
- **Capa de experiencia** (`apps/api`) que **compone** `@soec/diagnostico` + `@soec/estrategia` + `@soec/decision` para un `departamentoId`: comprensión (evidencia/faltantes/contradicciones), candidatos (explicación, cobertura, advertencias regulatorias, factores de confianza, alternativas, trazabilidad), transparencia, y estado de gobierno (**vigente + historial**).
- **Página web «Director Workspace»** (`apps/web`) — **en este mismo checkpoint** (la pregunta de validación exige una experiencia usable), organizada por el flujo §4.
- **Registrar una decisión** (ACEPTADO/RECHAZADO + justificación estructurada) vía `DecisionService`, o **Cerrar** sin registrar.
- **Honestidad del acto:** *si acepto* → el candidato queda como **objetivo vigente** (aún **no** se ejecuta; Preparación llegará después); *si rechazo* → registrado, sin cambiar el vigente.

## §8. Alcance EXCLUIDO
Preparación · Operación · marketing · campañas · publicación · gasto · IA · planificación · cuestionario interactivo · conversión del objetivo elegido en `Objetivo` operativo · cualquier efecto real.

## §9. Frontera dura
```
Director Workspace → DecisionService → Event Store
```
**Nunca** `Workspace → Preparación → Marketing`. Prueba arquitectónica: la experiencia importa **solo** `@soec/{diagnostico,estrategia,decision,rubros}` (+ contratos/event-store); **no** `@soec/{marketing,canales,operacional,piloto,control}` ni adaptadores.

## §10. Estructura técnica
Como F1-UI-01: experiencia en `apps/api` con **contexto sintético server-side** (sin login en la ruta de producto); ejecuta la cadena real (Diagnóstico→Estrategia sobre el caso sembrado) y consulta/actualiza Decisión (contexto con permiso `decisiones:decidir`). Sin acceso directo a MED/MDM/ECE ni a motores de operación. Página en `apps/web` que consume solo la API pública (route-handlers proxy).

**Ruta de API estable e independiente del idioma** (observación aprobada): **`/experience/director-workspace/*`** (la UI se muestra en español; el endpoint representa una capacidad de producto, no una palabra de dominio).

## §11. Qué validaremos — criterio de aceptación de dos dimensiones
El checkpoint se acepta solo si **ambas** respuestas son afirmativas:

**1. Gobernabilidad —** *¿puede un Director comprender, deliberar y tomar una decisión institucional usando únicamente este Workspace?* Si no, el defecto está en los motores o en la experiencia (no en la estética), y se corrige **antes** de Preparación.

**2. Auditabilidad —** *¿podría un auditor independiente reconstruir exactamente por qué el Director tomó esa decisión?* El Workspace debe permitir recorrer, **sin saltos, sin cajas negras y sin depender de memoria humana**, la cadena completa:
```
Decisión → Candidato elegido → Estrategia → Mapeo → Señales → Hechos → Respuestas originales → Conocimiento del rubro
```

Gobernabilidad valida que el Director **pueda decidir**; Auditabilidad valida que un tercero **pueda reconstruir** la decisión. Es la aplicación directa de ADR-0017 (navegabilidad completa) sobre el snapshot íntegro de `@soec/decision`.

## §12. Criterios de cierre + pruebas
`typecheck`/`lint`/`next build` verdes; **validación viva** conduciendo la app: el Workspace muestra comprensión/evidencia/faltantes/**transparencia**/candidatos/explicación/**alternativas**/**trazabilidad expandible**/regulatorio/**vigente**/historial, con el flujo deliberativo §4; **Aceptar → vigente actualizado**; **Rechazar → registrado sin cambiar vigente**; **Cerrar → sin evento**; prueba arquitectónica de la frontera §9; sin efectos operativos; sin push.

## §13. Diferido a F2-DISC-03
Captura interactiva (el Director responde las preguntas del rubro) como **otro consumidor** del mismo motor, aguas arriba del Director Workspace.
