# Arquitectura objetivo — Director de Marketing Autónomo (V1)

> Subordinada a `docs/governance/CONSTITUCION_SOEC.md`. Deriva de
> `docs/audits/DIRECTOR_AUTONOMO_CAPABILITY_AUDIT.md`. Principio rector: **completar y conectar lo
> existente en un ciclo cerrado gobernado**, no crear motores paralelos.

## 1. El ciclo cerrado (comportamiento objetivo)
```
Políticas y objetivos humanos
        ↓
Conocimiento del negocio (instancia, gobernado)
        ↓
Diagnóstico basado en evidencia   ── [@soec/diagnostico, reutilizar]
        ↓
Hipótesis                          ── [NUEVO]
        ↓
Decisión estratégica              ── [@soec/decision extendido: contexto/hipótesis/alternativas/resultado]
        ↓
Plan de campaña                   ── [@soec/marketing, conectar a decisión]
        ↓
Generación de activos             ── [@soec/contenido, gobernado por campaña]
        ↓
Aprobación según autonomía        ── [motor de niveles, NUEVO]
        ↓
Ejecución (simulada/emulada)      ── [@soec/canales + canal-emulado, reutilizar]
        ↓
Medición                          ── [@soec/medicion, reutilizar]
        ↓
Evaluación                        ── [evaluabilidad, reutilizar]
        ↓
Aprendizaje (experimento)         ── [NUEVO]
        ↓
Nueva decisión ↺
```
El ciclo es **una** máquina gobernada, no verticales sueltos. Cada arista conserva procedencia.

## 2. Núcleo común (única autoridad — no silos)
Una sola fuente para: **políticas · objetivos · permisos · estados · decisiones · evidencia ·
aprobaciones · auditoría · riesgo · resultados**. Se apoya en lo existente:
- **Event Store** (`@soec/event-store`) como SSOT append-only + trazabilidad.
- **Permisos/roles** existentes; **separación multiempresa** por `organizationId` (invariante).
- **Evaluabilidad** (`@soec/diagnostico` + ADR-002) como gate previo a conclusiones y ejecución.
- **Pausa/auditoría** (`@soec/control`) como plano de gobierno transversal.

Si se usan **roles internos** (Dirección estratégica, Investigación, Planificación, Copy, Creativo,
Canales, Presupuesto, Medición, Aprendizaje, Riesgo/Cumplimiento) serán **capacidades coordinadas
por el núcleo**, nunca silos con memoria/reglas/decisiones propias e incompatibles.

## 3. Entidades objetivo (con `id/organizacionId/origen/fecha/estado/confianza/autor/trazabilidad`)
- **Conocimiento de negocio [NUEVO, SSOT de instancia]:** Organización, Unidad de negocio, Marca,
  Producto/Servicio, **Público objetivo**, Propuesta de valor, Objetivo comercial, Restricción,
  Evidencia, **Competidor**, Canal, Política, Presupuesto, Indicador, Fuente de datos.
- **Decisión de marketing [extender `@soec/decision`]:** objetivo, contexto, datos observados,
  información faltante, hipótesis, alternativas (elegida/descartadas), justificación, riesgo,
  confianza, aprobación requerida, estado, resultado. Estados:
  `BORRADOR · NO_EVALUABLE · PROPUESTA · PENDIENTE_APROBACION · APROBADA · RECHAZADA · EN_EJECUCION ·
  DETENIDA · COMPLETADA · FALLIDA · EVALUADA`.
- **Campaña [derivada de decisión]:** objetivo, público, mensaje, oferta, canal, calendario,
  presupuesto, hipótesis, métricas, criterios de éxito/fracaso, reglas de pausa, nivel de autonomía,
  aprobación.
- **Contenido [gobernado por campaña]:** vínculo a campaña/marca/público/objetivo/etapa/canal/
  hipótesis/evidencia/versión/aprobación/resultado.
- **Hipótesis [NUEVO]** y **Experimento/Aprendizaje [NUEVO]:** hipótesis, contexto, variante,
  periodo, resultado, confiabilidad, conclusión, limitaciones, reutilización.

## 4. Adaptadores (frontera de efectos)
Ejecución vía **adaptadores simulados** que se comportan como conectores externos: `crear borrador ·
programar · publicar · rechazar · fallar · reintentar · pausar · cancelar · recibir métricas`. Toda
salida simulada se etiqueta **`SIMULATED`**; jamás se muestra como publicación real. Los canales
reales quedan **detrás de una decisión estratégica + credenciales** (acción externa, requiere
autorización — la arquitectura NO los habilita en V1).

## 5. Autonomía (motor configurable, NUEVO)
Escala `N0 Observar · N1 Recomendar · N2 Preparar · N3 Aprobación previa · N4 Autonomía dentro de
políticas · N5 Optimización controlada`. Reglas de diseño: SOEC **no** eleva su nivel; el usuario lo
reduce de inmediato; varía por empresa/canal/acción/presupuesto/riesgo; **PAUSA domina** todo nivel.

## 6. Modo seguro automático (NUEVO, unifica lo existente)
Gate de ejecución que **bloquea** cuando: falta aprobación · falta presupuesto/público/objetivo ·
evidencia insuficiente (`NO_EVALUABLE`) · el nivel de autonomía no lo permite · se exceden límites ·
hay inconsistencia · el sistema está pausado. Emite: qué se detuvo, por qué, evidencia, riesgo
evitado, qué debe resolver el usuario, qué sigue operativo. Reutiliza pausa (`@soec/control`) +
anomalías (`@soec/medicion`) + evaluabilidad.

## 7. ADR necesarios (mínimos)
Crear **solo** los indispensables: (1) SSOT de conocimiento comercial de instancia; (2) Modelo de
decisión de marketing; (3) Modelo de campaña derivada de decisión; (4) Sistema de evidencias;
(5) Niveles de autonomía; (6) Modo seguro automático; (7) Sistema de experimentos/aprendizaje.
Los demás (adaptadores de canales, medición/atribución) ya están cubiertos por ADRs/patrones
existentes (Centro de Integraciones ADR-003, medición). No se duplican.
