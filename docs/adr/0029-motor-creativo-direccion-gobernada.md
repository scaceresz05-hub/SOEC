# ADR-0029 — M6 · Motor Creativo Estratégico: dirección creativa gobernada por M5

- **Estado:** Aceptado.
- **Fecha:** 2026-08-03.
- **Rama:** `feat/macrobloque-4d` (continúa tras el cierre de M5; M6 autorizado por Bloque Maestro LOCKED).
- **Relación:** consume M5 (`@soec/motor-estrategico`, ADR-0028) por `LecturaConocimiento`; reutiliza M3
  (`@soec/estrategia-creativa`, ADR-0019) sin duplicar. Invariante: M5 produce conocimiento, M6 produce
  dirección creativa, M7 ejecutará.

## Contexto

El Bloque Maestro de M6 exige transformar el conocimiento evaluable de M5 en dirección creativa
gobernada, sin ejecutar/publicar ni depender de un proveedor de IA, y — regla dura — "antes de crear una
entidad nueva, demostrar por discovery que no existe ya una equivalente".

El discovery mostró que **M3 ya provee** la mayor parte del andamiaje creativo: `ArtefactoEstrategiaCreativa`
(estrategia creativa de primera clase versionada), validador semántico A-3 (`validarContenidoComercial`),
variantes A/B (`VarianteAB`), calendario editorial (`EntradaCalendario`), aprobación canónica con
obsolescencia por versión (`Aprobacion`), y el orquestador generativo con puerto neutral. Lo que **no
existía** es el puente hacia M5 y la autoridad epistémica: nada derivaba de M5 (M3 deriva de M2), no había
proyección versionada del conocimiento con obsolescencia, ni un gate que exigiera que cada afirmación
estuviese realmente sostenida en M5.

## Decisión

Nuevo paquete **`@soec/motor-creativo`** que consume M5 solo por `LecturaConocimiento` y reutiliza M3:

- **Contexto creativo** (`contexto-creativo.ts`): proyección INMUTABLE y VERSIONADA derivada solo de M5.
  Guarda REFERENCIAS (rol → `afirmacionId` + versión de M5 + estado), nunca copias (SSOT intacto), y los
  FALTANTES (roles que M5 no sostiene). `detectarObsolescencia` (puro) + `verificarVigencia` marcan el
  contexto OBSOLETO cuando una versión referenciada de M5 cambia — la dirección creativa no se invalida en
  silencio. Event-sourced `creativo-contexto:<org>:<id>`.
- **Territorio creativo** (`territorio.ts`): dirección conceptual durable (tesis/tensión/beneficio/prueba/
  riesgos/compatibilidad-marca) cuya evidencia son referencias a M5; su evaluabilidad se DERIVA (no se
  almacena) evaluando esas afirmaciones. Abstiene con explicación si falta audiencia sostenida o evidencia.
- **Sistema de mensajes tipados** (`mensaje.ts`): mensajes por función (problema/beneficio/diferenciación/
  prueba/objeción/CTA/educativo); los que afirman un hecho EXIGEN respaldo en una afirmación de M5; todos
  declaran audiencia y condiciones de no-uso.
- **Validación creativa AUTORITATIVA** (`validacion-autoritativa.ts`): COMPONE el validador textual A-3 de
  M3 (reusado) con la resolución epistémica contra M5. Autoriza solo si el texto pasa A-3 **y** toda
  afirmación de respaldo existe, no está retirada y evalúa `VERDADERO`. La trazabilidad epistémica es
  autoritativa: un respaldo `NO_EVALUABLE`/`GRIS`/`FALSO`/retirado bloquea aunque el texto sea impecable.
- **Abstención creativa de primera clase** (`abstencion.ts`): `ResultadoCreativo<T>` = PROPUESTA |
  ABSTENCIÓN, reutilizando la `Explicacion` CANÓNICA de M5 (no un shape paralelo). La ausencia nunca es
  una propuesta.
- **Contratos para M7** (`contratos/index.ts`): `LecturaCreativa` (solo lectura), espejo de
  `LecturaConocimiento`; M7 consume sin poder mutar.
- **Ampliación ADITIVA de la EstrategiaCreativa de M3** (no un segundo modelo): `ArtefactoEstrategiaCreativa`
  gana, fuera del contenido canónico B-1, campos opcionales de gobernanza M5 (`afirmacionesProhibidas`,
  `referenciasM5` versionadas, `estadoGobernanza`, `contextoCreativoId`) vía el evento
  `creativa.artefacto_gobernanza_vinculada` y `vincularGobernanzaM5`.

## Consecuencias

- (+) Existe el puente M5→M6: la dirección creativa deriva de conocimiento evaluable, es trazable a
  afirmaciones de M5 por id+versión, y se vuelve obsoleta si M5 cambia.
- (+) El gate de validación es autoritativo, no solo textual: bloquea afirmaciones sin respaldo real.
- (+) Cero modelos paralelos: A/B, calendario, aprobación, validador A-3 y el artefacto se REUTILIZAN.
## Adenda — cierre interno de M6 (dictamen `AUDITORIA_M6_REQUIERE_CIERRE_INTERNO`)

Los pendientes declarados eran criterios LOCKED, no deuda opcional. Se cerraron sobre la misma rama, de
forma ADITIVA (sin modelos paralelos):

- **Brief canónico ampliado** — `@soec/contenido/brief.ts` (`ContenidoBrief`): campos opcionales de
  gobernanza M5 (`contextoCreativoId`, `razonesParaCreer`, `objeciones`, `referenciasM5` versionadas,
  `informacionFaltante`, `estadoEpistemico`, `explicacion`, `versionConocimiento`, `vigencia`). El brief es
  inmutable por versión (solo transiciona de estado); una versión nueva de M5 no lo muta en silencio.
- **Piezas canónicas ampliadas** — `@soec/contenido/pieza.ts` (`PiezaFuente` + `FormatoPieza` +
  `TrazaAfirmacion`): `formato`, `objetivo`, `segmento`, `briefId`, `territorioId`, `estrategiaCreativaId`,
  `mensajesUtilizados`, `referenciasM5`, `resultadoValidacion`, `versionConocimiento`, `naturaleza`,
  `trazabilidad`. Se adjuntan por el evento aditivo `paq.gobernanza_creativa_vinculada` (no toca la
  producción canónica ni la huella B-1 del paquete).
- **Orquestación end-to-end** — `PipelineCreativoService`: conecta contexto→brief→territorio→estrategia→
  mensajes→pieza (fábrica canónica reutilizada por puerto `ProductorPieza`)→A/B→calendario. Se ABSTIENE
  (primera clase) ante el primer gate que falla; no crea pieza/variante/calendario si la validación
  autoritativa no autoriza; NUNCA aprueba automáticamente; deja la entrada de calendario en BORRADOR (no
  programa); idempotente y multi-tenant.
- **Obsolescencia** — `vigencia.ts` (`estadoVigencia`/`desajustesVersiones`) + `LecturaCreativa.vigenciaContexto`:
  compara versiones M5 usadas vs actuales; un cambio deja el contexto OBSOLETO. El gate autoritativo bloquea
  además por `VERSION_CAMBIADA` (respaldo obsoleto), `RETIRADA`, `INEXISTENTE` (incl. cross-tenant),
  `NO_VERDADERA` (contradicción) y `TIPO_NO_AUTORIZADO` (la clase de la afirmación no autoriza el tipo de
  mensaje). La aprobación no se hereda entre versiones (gate canónico `estaAprobada` de M3).
- **Contratos M7 completos** — `LecturaCreativa` (solo lectura) + `LecturaCreativaService`: contexto,
  vigencia, brief, territorio, estrategia, pieza, experimento A/B y calendario.

Todo neutral/simulado; `AUTONOMOUS_REAL` bloqueado; M6 no ejecuta, no publica, no programa, no gasta.

## Adenda 2 — correcciones focalizadas (dictamen `AUDITORIA_M6_REQUIERE_CORRECCIONES_FOCALIZADAS`)

El cierre demostraba componentes, no las INTERACCIONES gobernadas. Corregido sin crear dominio nuevo:

- **A · Vigencia como gate ÚNICO** (`gobernanza-creativa-service.ts:evaluarVigenciaCreativa` + `vigencia-creativa.ts:evaluarVigencia`): la autoridad de la vigencia es la DERIVACIÓN (referenciasM5 vs M5); estados `VIGENTE`/`REQUIERE_REVISION`/`OBSOLETO`. Cuando no es VIGENTE, MATERIALIZA la obsolescencia de forma idempotente en el artefacto (`creativa.artefacto_obsoleto` → `estadoGobernanza`) y en la pieza (`paq.gobernanza_obsoleta` → `pieza.vigencia`), de modo que ninguna consulta diga "obsoleto" mientras el agregado sigue "vigente". El artefacto histórico se conserva.
- **B · Pipeline gobernado en dos fases** (`pipeline-creativo-service.ts`): `componer` deja PENDIENTE_APROBACION (nunca aprueba ni calendariza); `calendarizar` exige, por el gate único, vigencia VIGENTE + aprobación de la pieza **por versión exacta** (`estaAprobada`) + aprobación de la variante, y solo entonces crea la entrada de calendario. Una versión nueva no hereda aprobación.
- **C · Fallo parcial reparable**: test con store que falla el alta de variante → reintento idempotente repara solo lo faltante, sin duplicar pieza/variante/eventos (`producirPieza`/`gobernarPieza`/índice idempotentes).
- **D · Replay frío**: un `LecturaCreativaService` NUEVO reconstruye contexto/brief/estrategia/pieza/variante/calendario/vigencia idénticos desde el log, sin cachés de proceso.
- **E · Contratos M7**: `LecturaCreativa.listarPiezasAprobadas` devuelve SOLO piezas aprobadas por versión exacta y VIGENTES (re-derivando la vigencia); excluye retiradas, obsoletas y aprobaciones no vigentes; snapshots inmutables (paqueteId, versión, referenciasM5, trazabilidad). El puerto no expone escritura.
- **F · Autoauditoría**: aprobación vieja tras cambio de M5, pieza vigente/variante no aprobada, obsolescencia materializada + exclusión de la lista, fallo parcial + reintento, replay frío, cross-tenant, texto inválido. 35 tests en `@soec/motor-creativo`.

## Adenda 3 — recuperación, concurrencia, replay frío e inmutabilidad (`AUDITORIA_M6_REQUIERE_CORRECCIONES_FOCALIZADAS_2`)

Faltaba DEMOSTRAR atomicidad lógica y recuperación en todas las fronteras. Cerrado (52 tests en el paquete):

- **A · Matriz de fallos parciales por frontera** (`recuperacion-m6.test.ts`, `StoreFallaEvento`): fallo deliberado en producción de pieza, vinculación de gobernanza, índice de piezas, variante A/B, solicitud de aprobación y append de calendario. Para cada una: 1.º intento deja estado parcial → 2.º repara → 3.º no-op idempotente, con **conteo de eventos = 1** (sin duplicados).
- **B · Solicitud de aprobación canónica** (`solicitud-aprobacion.ts` + servicio): identidad determinista `sol:<org>:<tipo>:<id>:v<version>`, idempotente por versión, PENDIENTE hasta decisión humana, no equivale a aprobación, y pasa a OBSOLETA cuando la versión deja de ser la vigente. El pipeline la emite en `componer` y la devuelve en el plan.
- **C · Replay FRÍO**: `InMemoryEventStore.exportar()` + `desdeInstantanea()` reconstruyen un store **nuevo** desde el log serializado (round-trip JSON, sin referencias del proceso anterior); los snapshots de contexto/brief/estrategia/pieza/variante/calendario/vigencia/`listarPiezasAprobadas` coinciden exactamente.
- **D · Concurrencia**: dos calendarizaciones concurrentes ⇒ una entrada; dos evaluaciones de vigencia concurrentes sobre pieza obsoleta ⇒ un solo evento de obsolescencia; decisión humana repetida ⇒ una aprobación (concurrencia optimista + idempotencia por contenido).
- **E · Inmutabilidad runtime**: `congelarProfundo` congela los snapshots de `listarPiezasAprobadas`; mutar referencias/versiones falla y una segunda lectura permanece intacta (`readonly` no basta).
- **F · Contrato M7**: `listarPiezasAprobadas` excluye aprobación de otra versión, pieza obsoleta, retirada, aprobación revocada y cross-tenant.

Aditivos: `InMemoryEventStore.exportar/desdeInstantanea` (@soec/event-store, soporte de test); `SolicitudAprobacionService` y `congelarProfundo` (@soec/motor-creativo). `verify` global 1112 verde.

## Alcance respetado

Neutral y simulado: sin proveedores reales, SDK, red, publicación, gasto, canales, credenciales ni
campañas ejecutadas. `AUTONOMOUS_REAL` bloqueado. M6 produce dirección; no ejecuta.
