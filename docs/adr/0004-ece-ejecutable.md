# ADR-0004 — Estado Cognitivo Empresarial ejecutable (F1-ECE-01)

- **Estado:** ✅ **ACEPTADO.** Realiza el Documento #12 sobre MED y MDM (ADR-0003) y la Base Técnica (ADR-0002); no redefine ninguna entidad congelada.
- **Fecha:** 2026-07-20 · **Fase:** 1 — Bloque F1-ECE-01.

## Contexto

F1-ECE-01 construye el ECE: la representación integrada, derivada, histórica y verificable del estado de comprensión disponible. El #12 fija la frontera: *el ECE transforma representación en comprensión integrada; nunca comprensión en acción.* No decide, no recomienda, no eleva certeza, no cierra el lazo humano, no origina afirmaciones sobre el mundo (solo sobre relaciones entre representaciones), y **no integra mediante inteligencia** (#13 es posterior).

## Decisiones

### D-1. El ECE es una representación DERIVADA event-sourced, no una tercera fuente de verdad *(Nivel A)*

- El ECE tiene su propia representación (stream `ece:<id>`, proyección `proj_ece_current`), pero **MED y MDM siguen siendo las fuentes** de sus planos. No fusiona tablas ni tipos: integra referenciando. Un ECE integra un MED y un MDM a **cortes** explícitos (versión = tiempo de conocimiento).
- Reconstruible desde la historia; el estado actual es proyección sobre eventos inmutables (#9 inv. 4).

### D-2. Elementos de dos orígenes: derivados deterministas y registrados declarados *(Nivel A/B)*

- **Derivados** (durante `construir`, deterministas y reproducibles, sin inferencia semántica): a partir de la estructura afirmación↔evidencia de cada modelo → **coherencia** (respaldada + sostiene, sin debilita), **contradicción** (sostiene ∧ debilita), **ausencia** (pendiente sin evidencia → **no evaluable**). Mismas entradas → mismos ids.
- **Registrados** (eventos atribuidos): cualquier elemento declarado, incluidas las relaciones **cross-model** MED↔MDM (contradicción, dependencia, brecha). Son afirmaciones del ECE **sobre relaciones** entre representaciones (#12 inv. 2), no nuevos hechos del mundo. El ECE **registra** una contradicción; no decide cuál lado prevalece (§8).
- La integración **no eleva la certeza** (#12 inv. 3): cada elemento hereda incertidumbre, atribución y limitaciones de su fuente. Las contradicciones y ausencias son **de primera clase** y no se resuelven ni se ocultan.

### D-3. Separación entre representación fuente y estado derivado; sin fusión de planos *(Nivel A)*

- `reconstruir` reemplaza solo el conjunto **derivado** y conserva los **registrados** (superseding con historia). MED, MDM y ECE tienen streams y tablas separados; las proyecciones no fusionan planos antes del ECE.

### D-4. Temporalidad y cortes MED/MDM; no retroyección *(Nivel A, heredado)*

- Cada ECE conserva `medCorte`/`mdmCorte` (instancia + versión), `construidoEn` (tiempo de conocimiento), atribución, causación. La reconstrucción a una fecha corta por `recordedAt` sin contaminación posterior (#3/E3). Consultable: qué comprendía la empresa en una fecha, con qué información, qué faltaba, qué contradicciones existían, qué cambió y por qué.

### D-5. Invalidación por cortes, no actualización silenciosa *(Nivel B)*

- **On-demand:** `vigencia` compara los cortes con la versión actual de MED/MDM → `requiereReconstruccion`.
- **Worker:** al drenar el outbox, un evento de MED/MDM que supera el corte de un ECE emite `ece.invalidado` (append-only, **causación** = el evento que lo provocó); el estado anterior no se sobrescribe. Un único consumidor del outbox proyecta MED, MDM y ECE e invalida, evitando el problema de multi-consumo.

### D-6. Puerto de lectura estable para el #13 *(Nivel A)*

- `EceReadPort` expone solo lectura (estado actual/en fecha, coherencias, contradicciones, ausencias, dependencias, brechas, no evaluables, procedencia, evidencia, limitaciones, vigencia). No se nombra según ninguna tecnología de IA, no expone tablas internas como contrato, y **no** contiene consumidores del #13. Pruebas arquitectónicas rechazan toda dependencia del ECE hacia operaciones, capacidades, IA o UI.

## Consecuencias

- El #13 podrá operar *sobre* el ECE a través del puerto de lectura sin conocer su persistencia. El ECE llega hasta el borde de la comprensión integrada y se detiene.
- La estrategia de construcción (derivación determinista) es Nivel B/C y sustituible sin cambiar el contrato del ECE (Nivel A).

## Trazabilidad

#9 (invariantes) · #10/#11 (fuentes MED/MDM) · #12 (autoridad principal: qué integra, qué produce, frontera con #13) · #15 (conformidad) · #16 (estructuras Nivel A) · ADR-0002 (contratos C-1..C-5) · ADR-0003 (modelos). Ninguna cláusula redefine estos documentos; los realiza.
