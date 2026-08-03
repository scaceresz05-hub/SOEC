# ADR-0028 — M5 · Motor Estratégico Comercial: núcleo de evaluabilidad canónico + afirmación estratégica

- **Estado:** Aceptado.
- **Fecha:** 2026-08-03.
- **Rama:** `feat/macrobloque-4d` (continúa tras el cierre de M4-D; M5 autorizado por Bloque Maestro LOCKED).
- **Relación:** implementa el Bloque Maestro M5. Consolida y completa el conocimiento comercial de M2/M3
  (ADR-0016..0019) bajo el marco de evaluabilidad de ADR-002 / Constitución §8. NO reabre M4.

## Contexto

El Bloque Maestro de M5 pide "definir el modelo de conocimiento sobre el que vivirá SOEC" con entidades
evaluables (Empresa, Mercado, Competencia, ICP, Buyer Persona, Propuesta de Valor, Objetivos, Hipótesis,
Estrategias, Planes, KPI), marco epistémico obligatorio (Evidencia, Evaluabilidad, Pertinencia,
Suficiencia, Confianza; estados **VERDADERO/FALSO/GRIS/NO_EVALUABLE**), trazabilidad, event-sourcing,
multi-tenant, explicabilidad y contratos que M6–M9 consuman sin modificar.

La inspección del repositorio (regla de arquitectura controlada) mostró que **la mayor parte de ese
dominio ya existe**, construido en M2/M3, y que la regla SSOT del propio Bloque Maestro ("prohibido
mantener modelos paralelos / duplicar información") **prohíbe reconstruirlo**:

| Componente M5 | Hogar canónico existente | Acción M5 |
|---|---|---|
| Empresa / Mercado / Competencia / ICP / Propuesta de valor | `@soec/negocio` (existencia + evidencia) + `@soec/crm-comercial/perfiles` (perfil tipado + procedencia por campo + cobertura) | Referenciar por id |
| Hipótesis | `@soec/crm-comercial/hipotesis` (agregado evaluable completo: evidencia a favor/contra, veredicto admisible, aprendizaje) | Referenciar/enlazar; no reimplementar |
| Estrategias | `@soec/estrategia` (candidatos, sin ejecución) + `@soec/decision` (objetivo vigente) | Referenciar |
| Planes | `@soec/marketing/plan` | Referenciar |
| KPI | `@soec/medicion/indicator` (indicador calculado) | Referenciar; modelar la META como afirmación enlazada |
| Trazabilidad | `@soec/contracts` (`Attribution`, dos ejes temporales, `causationId`) | Reusar |
| Explicabilidad | `@soec/crm-comercial/explicabilidad` (`Recomendacion｜Abstencion`) | Reusar el patrón |

La brecha **genuina** —verificada por búsqueda exhaustiva: el string `GRIS` no aparecía en todo el
repositorio, y `NO_EVALUABLE` vivía disperso y binario por dominio— es que **la máquina de estados de
evaluabilidad canónica de cuatro estados NO estaba codificada**: existía solo como doctrina. Cada dominio
inventaba su propia señal de "no sé" (`NO_EVALUABLE` binario, `NO_CONCLUYENTE`, `INCONCLUSA`…). Ese es el
núcleo que faltaba y sobre el que "vivirá SOEC".

## Decisión

Nuevo paquete **`@soec/motor-estrategico`**, en dos capas, sin duplicar ningún modelo existente:

### 1) Núcleo epistémico canónico (`src/nucleo/`)
- **`EstadoEvaluabilidad = VERDADERO | FALSO | GRIS | NO_EVALUABLE`** — SSOT de la semántica de
  evaluabilidad. Regla fundacional inviolable: **la ausencia de información nunca es una conclusión**;
  sin evidencia pertinente ⇒ `NO_EVALUABLE`, jamás `FALSO` (que es un veredicto positivo de refutación).
  `GRIS` (se evaluó, no alcanzó) y `NO_EVALUABLE` (no había con qué evaluar) **nunca se confunden**.
- **`evaluar(enunciado, evidencias, politica)`** — función PURA y determinista que recorre la cadena raíz
  **SSOT → Evaluabilidad → Pertinencia → Suficiencia → Confianza → Estado**. Pertinencia explícita (nunca
  inferida; la evidencia no pertinente se conserva y se excluye del cómputo). Suficiencia gobernada por
  política inyectada (mínimo de evidencia pertinente; si exige origen fuerte). Confianza solo donde tiene
  significado (`null` en GRIS/NO_EVALUABLE, nunca decorativa). Toda evaluación **explica**: por qué, qué
  evidencia usó, qué falta y qué impediría concluir.
- Reutiliza el vocabulario epistémico canónico de `@soec/negocio` (`TipoEvidencia`, `Confianza`) — no lo
  redefine.

### 2) Dominio estratégico (`src/dominio/`, `src/app/`)
- **`AfirmacionEstrategica`** — agregado event-sourced (`estrategico:<org>:<id>`), multi-tenant, que
  generaliza el patrón de la hipótesis a toda clase estratégica (`EMPRESA … KPI`, más `HIPOTESIS` para
  enlazar). Acumula **conocimiento** (enunciado, evidencia con sentido/pertinencia, enlaces tipados) y
  **jamás persiste un veredicto**: el estado se DERIVA con `evaluar()` en cada consulta. Así se honra
  "SOEC no almacena respuestas, almacena conocimiento" y el replay es trivialmente determinista.
- **Enlaces tipados y explícitos** (`PERTENECE_A`, `RESPONDE_A`, `DERIVA_DE`, `MIDE`, `SUSTENTA`,
  `CONTRADICE`), validados: el destino debe existir en la MISMA organización (nunca al vacío ni
  cross-tenant). Ej.: varias `BUYER_PERSONA` `PERTENECE_A` un mismo `ICP`; un `KPI` `MIDE` un `OBJETIVO`.
- **`sujetoRef`** — referencia OPACA (dominio + id) a la entidad descriptiva en su SSOT (`negocio`,
  `crm-comercial`, `hipotesis`); nunca copia su contenido.
- **Contratos** (`src/contratos/`): `LecturaConocimiento` (cargar/evaluar/listar — lo único que M6–M9
  necesitan) separado de `EscrituraConocimiento` (registrar/evidencia/enlazar/asignar/retirar). Los
  consumidores dependen del puerto de lectura y **no pueden mutar** el conocimiento.

## Frontera SSOT (regla permanente, en la línea de ADR-0018)

- `@soec/motor-estrategico/nucleo` es la **SSOT de la semántica de evaluabilidad** (los 4 estados + la
  cadena de evaluación). Todo dominio que necesite "concluir con evidencia" debería, en adelante, derivar
  de aquí.
- La **capa de afirmación** NO es una segunda base de entidades comerciales: es la capa EVALUATIVA que
  razona con evidencia SOBRE entidades cuya existencia y descripción siguen siendo SSOT de `negocio` /
  `crm-comercial` / `hipotesis`, referenciadas por `sujetoRef` (mismo id).
- **Hipótesis**: su ciclo de vida rico (EN_PRUEBA, resultado, aprendizaje) permanece en `crm-comercial`
  (SSOT). M5 solo la enlaza en el grafo estratégico.
- **KPI**: el cálculo del indicador permanece en `@soec/medicion` (SSOT). M5 modela la META/objetivo del
  KPI como afirmación evaluable enlazada (`MIDE`).

## Consecuencias

- (+) Existe, por fin, la máquina canónica de evaluabilidad de 4 estados que el producto solo tenía como
  doctrina; es pura, determinista y explicable, lista para que M6–M9 la consuman.
- (+) Cero duplicación: M5 referencia los SSOT existentes; no reabre ni reescribe el dominio de M2/M3.
- (+) M6–M9 consumen `LecturaConocimiento` (solo lectura); el productor/consumidor queda separado por tipo.
- (−) Los estados de evaluabilidad dispersos preexistentes (`decisiones-mkt`, `medicion`,
  `director-workspace`) **todavía no derivan** del enum canónico: su unificación es deuda deliberada de
  consolidación posterior (no se toca código auditado de M2/M3 en este tramo para no ampliar el radio de
  cambio). Queda registrada como trabajo futuro, no como parte de M5.
- (−) La pertinencia y la suficiencia son declaradas/gobernadas por política inyectada: el motor no juzga
  la verdad de la pertinencia, la registra de forma trazable (atribución por evento).

## Alcance respetado

Neutral y simulado: sin proveedores, SDK, red, credenciales, datos reales ni costos. `AUTONOMOUS_REAL`
permanece bloqueado. M5 produce conocimiento estructurado; no genera campañas ni contenido (prohibiciones
del Bloque Maestro).

## Adenda — cierre de los pendientes descriptivos (auditoría de cobertura M5)

Tras la auditoría de cobertura del dominio se cerraron, como **ampliaciones ADITIVAS** (sin crear modelos
paralelos, extendiendo la capa tipada `@soec/crm-comercial/perfiles`, con existencia canónica en
`@soec/negocio` por el MISMO id):

- **Mercado** — `ESQUEMAS.MERCADO` + `segmentos`, `tamano`, `barreras`.
- **Competencia** — `ESQUEMAS.COMPETIDOR` + `diferenciadores`, `riesgos`.
- **Buyer Persona** — nuevo `TipoPerfil='BUYER_PERSONA'` (esquema: rol, responsabilidades, objetivos,
  dolores, motivaciones, objeciones, criteriosDecision, canalesInformacion, nivelDecision, influencia);
  existencia canónica nueva en `@soec/negocio` (`TipoEntidad='BUYER_PERSONA'`). La relación
  "pertenece a un ICP, varias por ICP" vive en el grafo evaluable (enlace `PERTENECE_A`).
- **Propuesta de Valor** — nuevo `TipoPerfil='PROPUESTA_VALOR'` (beneficios, problemasResueltos,
  diferenciadores, prueba); canónico en `@soec/negocio` (`PROPUESTA_VALOR`, ya existente).
- **KPI con meta/umbral/responsable** — nuevo `TipoPerfil='KPI'` (meta, umbral, responsable, unidad,
  frecuencia); canónico como `INDICADOR`. **El CÁLCULO del valor sigue siendo SSOT de `@soec/medicion`**
  (`Indicador`); aquí solo vive la DEFINICIÓN de la meta, no el valor observado → sin duplicación.

**Decisión de arquitectura reservada (no cerrada por ingeniería):** si "Empresa" debe pasar a ser un
agregado raíz nominal dedicado o se mantiene como la `EntidadComercial` singleton tipada actual
(`ID_EMPRESA`). Queda a resolución del Arquitecto antes del cierre formal de M5.
