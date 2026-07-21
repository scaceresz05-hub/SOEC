# ADR-0010 — Modelo Operativo y Planificador Autónomo de Marketing (F2-MKT-01)

- **Estado:** ✅ **ACEPTADO.** Segunda vertical del Departamento de Marketing Autónomo. Continúa ADR-0009 (realineamiento + plano operativo) sin abrir nuevo circuito de enmienda.
- **Fecha:** 2026-07-21 · **Bloque:** F2-MKT-01.

## Contexto

F2-AUT-01 (ADR-0009) instaló el **plano operativo** `@soec/operacional`: dada una acción propuesta, una política vigente la **autoriza** (permite/deniega con motivo) y un adaptador **simulado** la ejecuta, verifica y audita. Faltaba el eslabón anterior: un componente que, a partir de un **objetivo comercial** y un **contexto de empresa/marca sintéticos**, produzca un **plan operativo versionado, persistido y ejecutable** (iniciativas → campañas → actividades → calendario), y que lo lleve a ejecución a través del plano operativo existente. Este ADR fija ese eslabón: `@soec/marketing`.

El propósito raíz (Autonomía Intelectual) y la soberanía transformada (v1.7) se mantienen: el planificador **propone**; el plano operativo **autoriza y ejecuta (simulado)**. Ningún efecto externo real.

## Decisiones

### D-1. Separación planificador ⊳ plano operativo: quién propone, quién autoriza *(Nivel A)*

- `@soec/marketing` **propone**: traduce objetivo+contexto+política en un plan y selecciona la siguiente acción. **Nunca publica, nunca se autoriza a sí mismo, nunca produce un efecto.** Depende de `@soec/operacional` por su **contrato público** (`OperationalService.ejecutar`), no al revés. El plano operativo sigue siendo la **única** puerta a un efecto (simulado). Flujo no invertible:

```text
Objetivo + Contexto + Política → Planificador (propone) → Plan operativo versionado
   → siguiente acción → Plano operativo (autoriza/ejecuta SIMULADO) → verifica → registra
```

### D-2. Planificador determinista y auditable, sin LLM ni azar *(Nivel A)*

- El planificador es **una función pura del objetivo, la política y las opciones**: mismas entradas → mismo plan. Sin `Math.random`, sin `Date.now` no controlado (las fechas del calendario derivan de `fechaInicio` + frecuencia). Cada actividad lleva su **explicación** (por qué existe, a qué objetivo atiende, bajo qué política) — trazabilidad, no caja negra. Esto permite probar el plan por igualdad estructural y hace la planificación revisable por una persona.

### D-3. Modelo operativo persistido y versionado (event-sourced) *(Nivel A)*

- El **Objetivo** (contexto de organización + dirección comercial) es un agregado append-only (`obj:<id>`, evento `obj.registrado`) sujeto a **evaluabilidad**: `validarObjetivo` devuelve `evaluable`/`faltantes`/`error` (horizonte no positivo, frecuencia no positiva, objetivo que no supera la línea base, presupuesto negativo, o faltantes de empresa/marca/audiencia/indicador/canales). La ausencia de información **no** es una conclusión: un objetivo no evaluable no genera plan.
- El **Plan** (`plan:<id>`) es un agregado versionado; **replanificar no reescribe** la historia: emite una nueva versión (`plan.replanificado`) conservando las anteriores y registrando las diferencias. Máquinas de estado explícitas para el plan (borrador…activo/pausado/reemplazado…) y para cada actividad (`propuesta → planificada → autorizable → autorizada → en_ejecución → ejecutada → verificada`, con ramas `bloqueada/fallida/omitida/cancelada`), con transiciones validadas.

### D-4. Clasificación en la planificación vs. autorización en la ejecución *(Nivel A)*

- El planificador **pre-clasifica** cada actividad con lo que puede saber sin ejecutar: `bloqueada` si el canal no está en `canalesAutorizados` (`canal_no_autorizado`), si falta contenido (`contenido_faltante`) o si el tipo está en acciones prohibidas (`accion_prohibida`); en caso contrario, `autorizable`. **No** decide sobre afirmaciones/presupuesto/nivel de autonomía: eso es competencia del **motor de autorización** del plano operativo, evaluado **en el momento de ejecutar** contra la política vigente. Así, una actividad `autorizable` puede aún ser **denegada** en ejecución (p. ej. `afirmacion_prohibida`) sin contradicción: son dos evaluaciones distintas, en dos momentos distintos, cada una registrada.

### D-5. Selección e idempotencia de la ejecución *(Nivel A)*

- `siguienteActividad` elige la actividad `autorizable` más temprana por fecha programada — política de selección explícita y determinista. `ejecutarSiguiente` construye una `AccionPropuesta` desde la actividad (tipo, canal, contenido, costo, referencia al producto intelectual de origen `plan:<id>#<actividad>`) y la ejecuta por `OperationalService.ejecutar` con `executionId = <planId>:<actividadId>` — **idempotente**: reintentar no duplica el efecto. El resultado (`verificada` si permitida; `omitida` si denegada) se registra como `plan.actividad_ejecutada`. Un plan **pausado** rechaza ejecutar (interruptor de pausa heredado del plano operativo).

### D-6. Estrategia sintética y ningún efecto real *(Nivel A/C)*

- Contexto **exclusivamente sintético** (`fixtures.ts`: PyME de servicios demo). Los efectos son **simulados** por construcción (`Efecto.simulado === true`, garantizado por el plano operativo). La API (`/marketing/*`) y la interfaz («Centro de control de marketing») exponen preparar/estado/ejecutar-siguiente/replanificar/pausar/reanudar; **no** existe endpoint para publicar en real ni para saltarse la autorización. La interfaz habla en lenguaje de **trabajo** («esto es lo que SOEC realiza por la empresa»), no de consejo, y declara que ningún efecto externo real ocurre.

## Consecuencias

- SOEC recibe un objetivo comercial y produce **trabajo operativo planificado, versionado, ejecutable y trazable**, no un documento de estrategia. El plan es un artefacto persistido; la ejecución pasa siempre por la puerta de autorización del plano operativo.
- Se preservan intactos: propósito raíz, soberanía transformada (el humano define estrategia/presupuesto/prohibiciones), no-vinculación del conocimiento, y el guardarraíl de **ningún efecto externo real**.
- Se habilitan los bloques siguientes de la Directiva (fábrica de contenido, adaptador de publicación controlada, medición, centro de control ampliado, piloto). Publicar/gastar/enviar en real sigue siendo **causal de parada** hasta autorización explícita.

## Trazabilidad

ADR-0009 (dos clases de capacidad; políticas; autorización; efectos simulados) · Const. v1.7 Art. 2.1/2.4 · #13 (composición de operaciones) · ADR-0002 (contratos de conformidad) · ADR-0007 (primer dominio PyME sintético) · Principio de Evaluabilidad (ADR SSR-002 análogo: la ausencia de información no es conclusión). El planificador no revisa el propósito raíz (2.2) ni toca la capa congelada.
