# ADR-0003 — Núcleo ejecutable de Modelos MED y MDM (F1-MOD-01)

- **Estado:** ✅ **ACEPTADO.** Realiza los contratos de #9/#10/#11 sobre la Base Técnica (ADR-0002); no redefine ninguna entidad congelada.
- **Fecha:** 2026-07-20 · **Fase:** 1 — Bloque F1-MOD-01.

## Contexto

F1-MOD-01 construye la vertical de dominio de los dos modelos fundamentales —MED (#10) y MDM (#11)— sobre el event store aprobado en F1-BT-01. La Simetría de los modelos (#9 inv. 11) exige una anatomía común; la frontera MED ╪ MDM (#11 §4) exige separación verificable; el ECE (#12) todavía **no** se implementa, pero deben quedar puertos estables para consumir ambos modelos después.

## Decisiones

### D-1. Modelado MED/MDM: agregado event-sourced con anatomía común, streams separados *(Nivel A/B)*

- Un único núcleo de agregado (`ModelInstanceState` + `aplicar`) realiza la anatomía común (afirmaciones, entidades representadas, relaciones internas, ámbito declarado, historia). Instancia la **Simetría** (#9 inv. 11): misma estructura, distinto dominio. **Rol Nivel A** (deriva del invariante); su realización concreta (reduce en TS) es Nivel C.
- MED y MDM viven en **streams distintos** por prefijo (`med:<id>`, `mdm:<id>`). La frontera es **verificable**: el repositorio rechaza (`ModelSeparationError`) todo evento cuyo namespace no corresponda al modelo del stream.
- Las entidades concretas (unidad, recurso, proceso / norma, actor externo…) son **contenido de instanciación** (`tipo` de instancia), no conceptos arquitectónicos nuevos (#10 §2). No se introdujo ningún término ajeno al #10/#11 como tipo de primer nivel.

### D-2. Afirmaciones y evidencias de primera clase, sin elevación automática *(Nivel A)*

- La afirmación es la unidad mínima (#10 §3); nace **pendiente** y no se vuelve hecho por existir (§9). Estados: `pendiente · respaldada · cuestionada · superada`.
- La evidencia porta **procedencia y atribución**, no se sobrescribe, y se relaciona con la afirmación como `sostiene · debilita · inconclusa`. La coexistencia de evidencia conflictiva **no se resuelve sola**: elevar el estado exige un evento de revisión explícito y atribuido (Conservación y Elevación Justificada, #3; C-4 de ADR-0002). Esto respeta que el bloque *almacena y organiza representación; no integra comprensión* (frontera del #12).

### D-3. Proyecciones separadas, reconstruibles e idempotentes *(Nivel B/C)*

- Proyecciones actuales en **tablas separadas por modelo** (`proj_med_current`, `proj_mdm_current`): la separación MED ╪ MDM es también física (§8); las proyecciones **no fusionan** ambos planos antes del ECE.
- Reconstruibles desde la historia: borrar y reconstruir produce el mismo estado que el procesamiento incremental. Idempotencia **por secuencia** (un evento con `sequence ≤ versión proyectada` se omite): procesar dos veces no duplica.
- La proyección histórica es el propio agregado reconstruido a un corte (`reconstructAt` + fold), sin tabla adicional.

### D-4. Tiempo efectivo ╪ tiempo de conocimiento *(Nivel A, heredado)*

- Se conserva la distinción de la Base Técnica: `occurredAt` (cuándo ocurrió en el mundo) ╪ `recordedAt` (cuándo SOEC lo supo). La reconstrucción temporal corta por `recordedAt` (no retroyección, #3/E3). Las observaciones y cambios externos del MDM registran su `occurredAt` propio.

### D-5. Extensión general del event store para migraciones de dominio *(Nivel B)*

- `runMigrations(pool, set)` acepta ahora un conjunto de migraciones externo. La infraestructura común aporta **solo el mecanismo**; las migraciones de MED/MDM viven en `@soec/models` (§10: sin atajos específicos de dominio en paquetes de infraestructura). El CLI de modelos compone `[...base, ...modelo]`.

## Consecuencias

- El ECE (#12) podrá consumir MED y MDM a través de los servicios y proyecciones sin conocer su persistencia. La frontera queda estable y no anticipa integración de comprensión.
- Los enlaces MED↔MDM existen como **agregado propio** (`link:<id>`), explícitos, tipados y atribuidos, con origen, naturaleza, organización, vigencia, incertidumbre e historial: enlazan sin fusionar (No Confusión, #11 §4).
- La separación es defendida por pruebas (evento cruzado rechazado, observación MDM no toca el MED, proyecciones y tablas separadas, aislamiento organizacional).

## Trazabilidad

#9 (invariantes; Simetría inv. 11; Marco/Instanciación inv. 12) · #10 (interior del MED) · #11 (interior del MDM; tres diferencias; frontera §4) · #12 (frontera: no se integra comprensión) · #15 (estándares de conformidad) · #16 (estructuras Nivel A) · ADR-0002 (contratos C-1..C-5). Ninguna cláusula redefine estos documentos; los realiza.
