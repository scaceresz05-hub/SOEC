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
- (−) Deuda declarada (no bloqueante, para la auditoría/decisión): el brief (`@soec/contenido`) y las
  piezas se REUTILIZAN tal cual — su ampliación descriptiva (objeciones/razones-para-creer/estado de
  evaluabilidad en el brief; exposición de `piezaId`/`formato`/`segmento` en la pieza) y la orquestación
  end-to-end que hile brief→territorio→estrategia→mensajes→piezas→variantes→calendario quedan como
  ampliación aditiva posterior. La obsolescencia del contexto no propaga aún automáticamente
  `estadoGobernanza=OBSOLETO` al artefacto (settable, no auto-cableado).

## Alcance respetado

Neutral y simulado: sin proveedores reales, SDK, red, publicación, gasto, canales, credenciales ni
campañas ejecutadas. `AUTONOMOUS_REAL` bloqueado. M6 produce dirección; no ejecuta.
