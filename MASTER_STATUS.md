# MASTER STATUS — SOEC

> Estado vivo del proyecto. Es el primer archivo a leer al retomar el trabajo. Se actualiza al cerrar cada bloque.

**Fase actual:** 🔨 **FASE 1 — DESARROLLO (iniciada por Directiva Operacional, 2026-07-19).** Fase 0 cerrada; Biblioteca Maestra 19/19 es la autoridad. Rol de Claude: **Arquitecto de Implementación** — bloques grandes, autónomo, se detiene solo en los 6 casos de la Directiva. **Git activo** (rama `main`; basal `cdfa754`).

**Modo de trabajo Fase 1:** avanzar en el mayor bloque seguro; no pedir validación cuando haya evidencia objetiva (compilar, probar, verificar conformidad #15); la implementación no modifica la arquitectura; toda decisión técnica deriva de la Biblioteca, declara su nivel A/B/C y mantiene trazabilidad. Detenerse solo por: (1) modificar la Biblioteca · (2) contradicción estructural · (3) decisión estratégica de negocio · (4) alternativas equivalentes de alto impacto · (5) riesgo a datos/producción · (6) acción externa no automatizable (credenciales, pagos, licencias…).

## ✅ BLOQUE F1-BT-01 (Base Técnica Ejecutable) — CERRADO Y VERIFICADO (2026-07-20)

**Custodia versionada — repo Git activo.** Rama `main`; commit basal `cdfa754` (Fundación 19/19 + ADR). `.gitignore` y `.gitattributes` (LF) en su sitio. Árbol limpio tras el cierre.

| Sub-fase | Estado |
|---|---|
| **A — Custodia y versionado** | ✅ **COMPLETA y verificada** — auditoría (árbol limpio, sin `.git` previo, sin contaminación cruzada), git init, commit basal, repo limpio |
| **B — ADR-0001 (stack)** | ✅ **RESUELTA** — stack autorizado por el Propietario, estratificado A/B/C. Ecosistema TS/Node (B); ORM/Fastify/Next/outbox/IA (C); contratos de persistencia y transporte de contexto (A) |
| **C — Andamiaje monorepo** | ✅ pnpm workspaces + TS strict + ESLint flat + Prettier + Vitest + tsx; Postgres local aislado (`docker compose -p soec`, 5544) |
| **D — Contracts (núcleo neutral)** | ✅ puertos/tipos que realizan ADR-0002 (errores, ids marcados, Scope, Attribution, EventStore/Outbox, IntelligenceProvider no vinculante) |
| **E — Event store (memoria + PostgreSQL)** | ✅ ambas implementaciones realizan C-1..C-5; migración 0001 idempotente; `recorded_at timestamptz(3)` |
| **F — API Fastify 5** | ✅ `buildApp` con inyección; errores de contrato mapeados (403/422/409); contexto exigido por cabeceras |
| **G — Inteligencia determinista** | ✅ adaptador neutral, se abstiene, `bindingDecision:false`, `offerToHumanJudgment` (Soberanía Humana) |
| **H — Conformance compartida** | ✅ misma suite ejecutada por memoria **y** PostgreSQL real (prueba de sustituibilidad, ADR-0001 estrato B) |
| **I — Calidad** | ✅ typecheck 5/5 · lint limpio · **31/31 tests verdes** (11 con Postgres real) · migración desde cero verificada |

**Resultados exactos (2026-07-20):** `pnpm -r typecheck` 5/5 OK · `pnpm lint` limpio · `pnpm test` **31 passed (5 files)** — worker 1 · intelligence 5 · in-memory 9 · api 5 · **pg-event-store 11 (Postgres real)**. Migración desde volumen vacío: `{"migrated":["0001_init"]}`.

**Toolchain verificado:** git 2.53 · node v24.14.1 · npm 11.11 · docker 29.4 · pnpm 9.15.4 (vía npx; corepack global bloqueado por permisos en `C:\Program Files\nodejs` — workaround documentado) · red OK. `psql` no en PATH → Postgres vía Docker.

**Aislamiento verificado:** `soec_postgres` en 5544 con volumen propio; los contenedores `ssr_*` (5433/6379/8080) intactos — sin mezcla (Directiva §9).

**ADR-0002** ✅ contrato de conformidad satisfecho por evidencia objetiva. No hay elevaciones abiertas.

**Deuda técnica / límites declarados:** proyección real del worker diferida a incrementos posteriores (hoy solo drena el outbox) · sin remoto Git (push no autorizado) · corepack global bloqueado (pnpm vía npx).

## Entregables de la Fase 0 — COMPLETOS

| # | Entregable | Cubierto por | Estado |
|---|---|---|---|
| 1 | Biblioteca Maestra | `docs/` — 19/19 | ✅ |
| 2 | Arquitectura Oficial | #9 (conceptual) · #16 (técnica) | ✅ |
| 3 | Modelo del Dominio | #10 MED · #11 MDM · #12 ECE · #13 · #14 | ✅ |
| 4 | Estándares | #15 | ✅ |
| 5 | ADR / decisiones | `docs/decisions/` (deliberaciones, matrices, elevaciones) | ✅ |
| 6 | Roadmap | #17 | ✅ |
| 7 | Manual / gobernanza | #6 · #7 · #8 · #18 | ✅ |
| 8 | Sistema de Contexto | `MASTER_STATUS` · `CHANGELOG` · #5 Registro · bitácoras | ✅ |

Leyenda: ⬜ Pendiente · 🟡 En progreso · ✅ Completo · 🔵 En revisión

## Orden oficial de construcción (19 documentos)

La Biblioteca Maestra se construye en el orden fijado por el Propietario del Producto. Detalle y estado en `docs/00-INDICE-BIBLIOTECA-MAESTRA.md`.

- **Fase 0.A — Descubrimiento Fundacional:** 🏁 CONCLUIDA (6/6 bloques ratificados). Bitácora: `docs/constitution/_descubrimiento-fase-0A.md`.
- **Fase 0.B — Auditoría de Coherencia Constitucional:** 🏁 CONCLUIDA. Informe: `docs/constitution/_auditoria-coherencia-fase-0B.md`.
- **Fase 0.C — Lectura de Aceptación:** 🏁 CONCLUIDA. Único hallazgo AC-1 (acrónimos MED/MDM), corregido.
- **Documento #1 — Constitución Maestra:** ✅ **v1.0 — Fuente Oficial de Verdad Filosófica, ACEPTADA OFICIALMENTE.** A partir de aquí, todo cambio sigue el Art. 8.
- **Matriz de Trazabilidad Filosófica:** ✅ `docs/constitution/_matriz-trazabilidad-filosofica.md`.
- **Recomendación diferida:** 🟡 Interpretación Autorizada de la Constitución — `docs/decisions/interpretacion-autorizada-constitucion.md` (abrir tras primera arquitectura estable).

- **Documento #2 — Objetivo Supremo:** ✅ **v1.0 ACEPTADO** — superó los cuatro criterios de revisión.

## Delimitación de funciones (evita solapamiento entre documentos)

- **Constitución (#1):** ¿Qué es SOEC y qué jamás dejará de ser?
- **Objetivo Supremo (#2):** ¿Hacia dónde apunta permanentemente SOEC?
- **Filosofía del Proyecto (#3):** ¿Cómo piensa SOEC el mundo? (cosmovisión desde la que nacen todas las decisiones posteriores; no redefine identidad ni dirección).

- **Fase 0.D — Fundamentos Epistemológicos:** 🏁 CONCLUIDA (5/5 microbloques ratificados + reconciliación E1↔E5). Bitácora: `docs/constitution/_fundamentos-epistemologicos-fase-0D.md`.

- **Documento #3 — Filosofía del Proyecto:** ✅ **v1.0 ACEPTADO.** Añadido el *Principio de Conservación Semántica*; el juicio humano se acotó al **constitucionalmente reservado** (la automatización sin consecuencias para personas es admisible; la clasificación no se autodeclara).

**Trípode constitucional cerrado:** #1 define *qué es SOEC* · #2 define *hacia dónde se dirige* · #3 define *desde qué disciplina epistemológica piensa y actúa*.

**★ Principio de Jurisdicción Documental ratificado** (detalle en `docs/00-INDICE-BIBLIOTECA-MAESTRA.md`): cada documento tiene competencia normativa exclusiva sobre el territorio de su pregunta única. La jurisdicción no se autodeclara; el territorio huérfano se asigna antes de legislarse; todo documento declara en su encabezado qué **no** gobierna. Profundidad sobre una misma materia: **#1 declara · #4 interpreta · #7 ejecuta · #15 comprueba.** La Biblioteca es una retícula con cuatro autoridades declarantes (#1 identidad, #2 dirección, #3 epistemología, #4 conducta), no una cascada única.

- **Documento #4 — Principios Fundamentales:** ✅ **v1.0 ACEPTADO.** 21 principios de conducta + **Test de Decisión** de 11 preguntas (la 11ª, sobre preservación de la identidad constitucional, puede vetar por sí sola).

**Capa constitucional #1–#4 completa y aceptada.** Constitución multicapa: cada documento responde una pregunta única, con jurisdicción exclusiva, derivando coherentemente del nivel superior.

**Frontera del #5 fijada:** no declara — **custodia**. Es el *Registro Constitucional de Permanencia*: hace localizable, invocable y auditable lo ya declarado por #1–#4, con cláusula de jurisdicción negativa, sincronización obligatoria, precedencia de la fuente y custodia activa pero nunca correctiva. Detalle en el índice.

- **Documento #5 — Registro Constitucional de Permanencia:** ✅ **v1.0 ACEPTADO.** Opera en nivel **meta-normativo** (metaconstitución): no produce normas, preserva la integridad del orden normativo.

## Hallazgos de custodia abiertos

| # | Tipo | Estado |
|---|---|---|
| **C-1** | Inconsistencia | **Diferido**: enmienda única al cierre de la capa declarativa, redefiniendo los niveles de permanencia **por naturaleza, no por ubicación documental** |
| **C-2** | Inconsistencia | Abierto — el Principio de Jurisdicción Documental se declaró fuera de los 19 documentos |
| **C-3** | Observación | Se resuelve al redactar #6 |
| **C-4** | Observación | Se resuelve al redactar #9, #13, #14, #16 |
| **C-5** | Observación | Condicionado a la inicialización de Git |

- **Documento #6 — Gobierno del Proyecto:** ✅ **v1.0 ACEPTADO.** Gobierna **funciones de autoridad**, no personas ni cargos. **Resuelve C-3.** Registra como no vigente la futura función de *Interpretación Constitucional*.

**Principios de arquitectura documental vigentes:** Jurisdicción Documental (territorio) · **Monocompetencia Documental** (clase de acto) · Autoridad para la Clasificación (#6 §1).

- **Documento #7 — Metodología de Desarrollo:** ✅ **v1.0 ACEPTADO.** Gobierna el **método permanente de transformación legítima** (no la programación): Principio de Independencia Instrumental, siete fases como *cadena de legitimación*, proporcionalidad sin omisión de fases, cierre por fases completas, remisión en urgencia y autoaplicación.

**Observación registrada (no incorporada):** principio emergente *«el método nunca sustituye al juicio»* — el método ordena el camino; no decide, no autoriza, no interpreta, no verifica.

- **Documento #8 — Consejo de Diseño:** ✅ **v1.0 ACEPTADO.** Institución constitucional de deliberación: actúa *antes* de la decisión, mide examen y no verdad.

## 🏛️ CAPA CONSTITUCIONAL COMPLETA (#1–#8)

Cada documento responde **una única pregunta constitucional**:

| # | Pregunta única |
|---|---|
| 1 | ¿Qué es SOEC? |
| 2 | ¿Para qué existe? |
| 3 | ¿Cómo distingue conocimiento válido? |
| 4 | ¿Cómo debe comportarse? |
| 5 | ¿Cómo preserva su permanencia? |
| 6 | ¿Quién puede decidir qué? |
| 7 | ¿Cómo evoluciona legítimamente? |
| 8 | ¿Cómo madura una propuesta antes de decidirse? |

**Circuito completo:** propuesta → #8 deliberación → #6 decisión → #7 ejecución → #15 verificación, con #5 sincronizando al cierre. No quedan vacíos entre una idea y su implementación.

## ✅ Enmienda de los niveles de permanencia — COMPLETADA (2026-07-19)

**Primera aplicación del sistema a sí mismo, circuito completo:** #8 deliberación (3 rondas) → #6 decisión de la Autoridad Constitucional → #7 método → #5 sincronización.

**Constitución v1.1.** Art. 8.1 reescrito con la **taxonomía bidimensional**; añadidos 8.5 (reglas de clasificación), 8.6 (gobierno de los planos) y 8.7 (autoaplicación). Numeración de 8.2–8.4 preservada: todas las referencias cruzadas siguen válidas (verificado).

- **Planos** (crear uno es competencia exclusiva de la Autoridad Constitucional, con prueba de cinco requisitos): **sistema** · **meta-normativo**.
- **Niveles**, definición común a ambos planos: **I Constitutivo · II Directivo · III Instrumental**, por profundidad de la pérdida **inmediata y propia** en el objeto que gobierna. *La intensidad de una pérdida no equivale a su carácter constitutivo.*
- **La taxonomía se aplica a sí misma** (meta-normativo, Nivel I) y su reforma se tramita conforme a la clasificación vigente al iniciarse.

**Hallazgos:** **C-1 ✅ resuelto** · **C-2 ✅ resuelto en su dimensión de rango**, con residual desprendido como **C-7** (el índice alberga una regla de Nivel I sin ser documento numerado) · **tarea derivada abierta:** clasificar las 37+ reglas del plano del sistema, que es acto de clasificación y corresponde a la autoridad competente, no a la Custodia.

## Historial de la deliberación

Primera aplicación del sistema a sí mismo: deliberación (#8) → decisión (#6) → método (#7) → sincronización (#5). Registro: `docs/decisions/deliberacion-enmienda-niveles-permanencia.md`.

**Deliberación concluida (3 rondas). Resultado: propuesta madura con objeciones asumidas.**

**Conclusión:** taxonomía **bidimensional** — *plano de aplicación* × *profundidad de permanencia*, ejes **ortogonales**, con **escala común** aplicada a objetos distintos.

- **Plano:** ¿qué objeto gobierna la regla? → del sistema (SOEC) · meta-normativo (la Biblioteca).
- **Nivel:** profundidad de la pérdida **inmediata y propia** en el objeto que gobierna, evaluada contra las declaraciones superiores aplicables → **Constitutiva · Directiva · Instrumental**.
- **Migración:** los niveles pueden cambiar, nunca automáticamente. *La permanencia no es inmutabilidad: es resistencia formal al cambio.*

**Objeciones asumidas, a resolver al redactar:** **D-4** asimetría del nivel superior (constitutiva tiene 1 disyunto en el plano del sistema y 3 en el meta — arrastra hacia arriba) · **D-5** la taxonomía se clasifica a sí misma y debe declararlo · **vía de evasión**: la creación de un plano debe someterse a la Autoridad para la Clasificación, o C-2 reaparece un piso más arriba.

## ✅ C-7 — RESUELTO (2026-07-19)

**Constitución v1.2 · #6 v1.1 · #7 v1.1 · índice reducido a función informativa.**

- **Jurisdicción Documental → Art. 7.4** (el Art. 7 ya gobernaba el mismo objeto; elimina la autorreferencia del #6).
- **Fuente Declarante Única → Art. 7.5 (nueva).** *Una regla normativa tiene exactamente una fuente declarante competente; todo otro documento solo puede remitir a ella o resumirla sin pretensión normativa.* **Elimina la causa de C-7, no solo su manifestación.**
- **Monocompetencia + competencias por documento + fronteras → #6 §1.bis.**
- **Circuito de transformación + regla de profundidad → #7 §2.bis.**
- **Tres duplicaciones eliminadas** a favor de la fuente declarante (Art. 7.2 · #5 §2 · encabezado del #5).
- **Verificado:** cada regla tiene una única fuente declarante; el índice no conserva lenguaje normativo.
- **C-8 abierto**, detectado durante la ejecución: el #6 declara una pregunta referida a *actores* pero aloja reglas referidas a *documentos*.

## Historial — C-7 (deliberación)

Secuencia decidida por la Autoridad Constitucional: **1) cerrar C-7 · 2) clasificar el corpus pendiente · 3) abrir el #9.** Son transformaciones distintas y cada una deja su propia trazabilidad. Registro: `docs/decisions/deliberacion-c7-reglas-alojadas-en-el-indice.md`.

**Ronda 1 cerrada — la observación amplió el hallazgo:** el índice no aloja dos principios, sino **once bloques normativos**, y **tres están duplicados** (regla de conflicto ↔ Art. 7.2 · reglas de custodia ↔ #5 §2 · cláusula negativa del #5 ↔ encabezado de #5). Cerrar C-7 moviendo solo dos principios lo cerraría falsamente.

**Insuficiencia declarada — dos decisiones pendientes:**
1. ¿*Jurisdicción Documental* (Nivel I constitutivo) va al **#6** o a la **Constitución Art. 7**? La alternativa por nivel resuelve además la autorreferencia del #6.
2. Para cada duplicación, **qué texto prevalece y cuál se suprime**.

**Obstáculo registrado:** trasladar reglas sobre *documentos* al #6 exige **ampliar explícitamente su pregunta declarada** (hoy referida a actores), o se repetiría el vicio que se corrige.

## En curso — Clasificación del corpus (#3 y #4)

**Matriz preparada, ninguna clasificación vigente.** Registro: `docs/decisions/matriz-clasificacion-corpus-3-4.md`.

- **41 reglas individualizadas** tras descomponer tres enunciados compuestos (Memoria/No Retroyección · Conservación/Elevación · Hechos y Valores en tres componentes).
- **Discriminador propuesto** para la frontera I/II, ante el arrastre hacia arriba previsto en D-4: la certeza falsa **sistémica e inevitable** → I; **posible en casos concretos** → II.
- **Distribución propuesta:** I = 8 · II = 32 · III = 1.
- **5 casos controvertidos** con alternativa y condición de cambio: Carga de la Prueba · El tipo no se autodeclara · Conservación Semántica · Verificación Acotada · Recuperabilidad Organizacional.
- **Hallazgo:** el #5 §6 clasificó en Nivel III las *Consecuencias de diseño (1–12)* y el *Test de Decisión (1–11)* **sin acto de autoridad competente**. Requiere ratificación o corrección.
- **A decidir además:** si *Transparencia organizacional* es regla propia o derivación de la Interpretabilidad; y si el vacío del Nivel III es esperable o indica arrastre residual.

**Criterio decidido (2026-07-19) — Constitución v1.3.** Ratificado el discriminador con reformulación (*¿desaparece una **garantía constitutiva**, o solo aumenta el riesgo?*), elevada a permanente la **descomposición previa**, declarado que la distribución de un documento **no crea expectativa** para otros. *Carga de la Prueba* → **II provisional**. Clasificaciones históricas del #5 §6 → **DEROGADAS** por falta de competencia. **La matriz sigue sin ratificar.**

**Criterio definitivo (Art. 8.5, v1.3).** Sub-test temático **rechazado** por especificar prematuramente una clase cerrada de condiciones. Criterio adoptado: el nivel no depende de que desaparezca una garantía, sino de **si sobrevive la condición que esa garantía protegía**. La forma verbal del enunciado es irrelevante.

**Re-aplicado a las once reglas: la distribución NO se sostiene exactamente → 7–33–1.** Tres reglas cambian: *El tipo no se autodeclara* ⬆ II→I · *Hechos y Valores (a)* ⬇ I→II · *Evolución compatible* ⬇ I→II. Causa común de los descensos: **otra regla vigente ya preserva la condición**. El criterio cambió respuestas en lugar de confirmar intuiciones.

**Criterio derivado propuesto, no adoptado:** *una regla no es constitutiva si la condición que protege está garantizada de forma independiente por otra regla vigente de igual o mayor rango* — previene además el doble conteo de una misma condición.

**Ratificado (2026-07-19): distribución 7–33–1 y las tres reclasificaciones.** Incorporado a la Constitución **v1.4, Art. 8.5.bis**: principio de **no duplicación constitutiva** basado en suficiencia normativa independiente (no en rango declarado, que puede estar en determinación) · **prueba de independencia** de cinco condiciones · **prohibición de degradación circular o mutua** con sus tres casos (protección conjunta → ambas Nivel I · redundancia real → fuente primaria + refuerzo · protección parcial → cada una por su pérdida propia) · **inventario de condiciones constitutivas** · **revisión obligatoria cuando se transforma una fuente constitutiva**.

**Inventario construido: 7 condiciones constitutivas (K-1 … K-7).** Sin circularidad y **sin condiciones sin guardián**. Dos resultados de la verificación:
- *Evolución compatible* es **Caso 3 (protección parcial)**, no Caso 2: el Art. 8.4 protege la identidad **normativa**, la regla protegía además la **deriva fáctica**. Nivel II confirmado con fundamento corregido.
- **C-9 abierto:** se está clasificando el corpus apoyándose en reglas constitucionales (Art. 1, 3–7, 8.2–8.4 y #2) que **aún no tienen plano ni nivel asignado**.

**Decisiones finales (2026-07-19):** *Evolución compatible* → II con fundamento **sustituido** (Caso 3, no Caso 2) — precedente metodológico · **C-9 cambia de naturaleza**: no es defecto arquitectónico sino **dependencia de secuencia**, se resuelve completando la clasificación, sin enmienda · **descomposición previa** confirmada como regla permanente · *Transparencia organizacional* → **derivación** tras el contrafáctico.

**⚠ Consecuencia aritmética:** al salir *Transparencia organizacional* del corpus clasificado, la distribución pasa de **7–33–1 (41)** a **7–32–1 (40)**. No es una reclasificación: es una regla que abandona la clasificación hacia el registro de derivaciones.

## ✅ CLASIFICACIÓN DEL CORPUS #3 Y #4 — EMITIDA Y SINCRONIZADA (2026-07-19)

Emitida formalmente por la Autoridad Constitucional (Art. 8.6, #6 §1) y reflejada en el Registro (#5 §7), con lo que **la clasificación existe plenamente** (#5 §2.1).

- **40 reglas · 7 – 32 – 1 · 1 derivación.** Plano *sistema* en todas.
- **Nivel I (7):** No Confusión · No Transferencia de Autoridad · Provisionalidad · Doble Régimen de Revisión · Apropiación Organizacional · El tipo no se autodeclara · No cautividad.
- **Inventario K-1 … K-7** registrado en #5 §7.4: sin circularidad, sin condiciones sin guardián.
- **Verificado:** cero reglas «no asignado» residuales; conteo por nivel confirmado (7 · 20+12 · 1).
- *Carga de la Prueba* queda como **II provisional**; *Evolución compatible* como **II por Caso 3**; *Transparencia organizacional* pasa a derivaciones (#5 §8).

## Secuencia fijada por la Autoridad Constitucional

1. Ratificación regla por regla del **#3** ✅ *(lista preparada)*
2. Ratificación regla por regla del **#4** ✅ *(lista preparada)*
3. Clasificar **#1 y #2** → resuelve C-9
4. Clasificar **#5, #6, #7 y #8**
5. Cerrar definitivamente **C-9**
6. Recién entonces abrir el **#9 — Arquitectura Conceptual**

## 🏛️ ETAPA CONSTITUCIONAL — CERRADA (2026-07-19)

**La Constitución pasa de objeto de trabajo a insumo.** Modo de trabajo: *interpretar antes que enmendar, aplicar antes que ampliar, ejecutar antes que discutir.* Toda enmienda futura exige demostrar **contradicción estructural** o **laguna constitucional real**.

- **Capa constitucional #1–#8 completa**, Constitución **v1.6**.
- **Clasificación del corpus constitucional completa: 99 reglas · 21 – 71 – 7 · 16 condensadores.** Detalle en #5 §9 (Estado Constitucional Definitivo).
- **#2: cero reglas clasificables** — documento íntegramente condensador del Art. 2.
- **Inventario final K-1 … K-19** (8 sistema · 11 meta) + condiciones de las reglas meta ya registradas.
- **C-9 cerrado.** Verificado: sin reglas sin clasificar, sin circularidad, sin condiciones sin guardián, sin duplicaciones.
- **Hallazgos abiertos:** C-4, C-5, C-6 (condicionados a eventos futuros) · **C-7** (resuelto, con residual C-8) · **C-8** (pregunta declarada del #6 ↔ reglas sobre documentos).

## Historial — Clasificación de #1 y #2 (cerró C-9)

**Constitución v1.5 — Art. 8.5.ter:** protocolo para reglas autorreferentes (objeto inmediato · anterioridad de la condición · contrafáctico sin el resultado), más la columna documental *dependencia autorreferente*. Se alojó en el Art. 8 y no en la matriz: es permanente, y una regla normativa en documento no normativo reproduciría C-7.

**Matriz preparada:** `docs/decisions/matriz-clasificacion-corpus-1-2.md`.

- **#1 — 27 reglas · 8 – 16 – 3.** El Nivel III deja de estar vacío (lengua, régimen de Git, orden de redacción): confirma que emerge donde hay **decisiones operativas**, no principios.
- **Verificación autorreferente superada:** ninguna clasificación rechazada por circularidad. El régimen se clasificó a sí mismo **con los mismos criterios** que aplicó al resto — sin excepciones.
- **Condiciones nuevas K-8 … K-15**, siete de ellas del plano meta-normativo.
- **#2 resuelto: documento mixto.** 4 enunciados condensadores (§1, §3, §4, §5 → remisión al Art. 2) · 2 innovadores propuestos en Nivel II (§6 prohibición de inversión medio/fin · §7 el horizonte no define el objetivo).

**Constitución v1.6 — Art. 7.5 ampliado:** *dónde nace una norma* (la identidad de la fuente declarante depende del acto que originalmente declara, no del documento donde aparece; copiar, condensar, citar o reorganizar **no** genera declaración nueva) y distinción **condensador / innovador**, que se determina **enunciado por enunciado, no en bloque**.

**Distribución conjunta propuesta #1 + #2: 29 reglas · 8 – 18 – 3**, más 4 condensadores como remisión.

## Documento #9 — Arquitectura Conceptual: 🔵 v1.0 redactado

Alcance validado por el Director de Arquitectura y **#9 redactado en un bloque continuo** bajo el nuevo modo de trabajo. Mapa de alcance: `docs/architecture/_alcance-09-arquitectura-conceptual.md`.

- **Tres planos** (Realidad · Representación · Apropiación) y cinco bloques (Ontología · Relaciones · Límites · Ciclos · Invariantes).
- **Entidades situadas, no desarrolladas:** Empresa, Mundo, Representación, Modelo (MED/MDM/otros), ECE, Afirmación, Evidencia, Historia epistemológica, Comprensión organizacional, Persona.
- **10 invariantes** conceptuales; **8 límites** derivados de condiciones ya ratificadas.
- **Verificado contra la prueba de calidad:** sin lenguaje de implementación, sin tiempo futuro de desarrollo, ninguna entidad explicada por dentro (regla de las cuatro preguntas). No redefine ninguna entidad constitucional.

## Capa de dominio en curso — #10 MED y #11 MDM redactados

**#9 → v1.1:** incorporados los invariantes de familia de modelos —**Simetría** (misma anatomía, distinto dominio) y **Marco/Instanciación**—, decisión del Director de Arquitectura al validar el #10. Laguna real (la entidad *Modelo* carecía de estos invariantes), no refinamiento; su domicilio es #9 por Fuente Declarante Única.

**Directiva permanente adoptada:** todo documento de modelo abre con la frase fija *«Este documento desarrolla el interior de una entidad ya situada por el #9; ninguna definición aquí modifica su existencia, límites o relaciones arquitectónicas.»*

**#11 MDM redactado presumiendo simetría con el MED:** hereda por remisión anatomía, marco/instanciación, ciclo de vida e invariantes; desarrolla solo lo propio del dominio —**tres diferencias esenciales**: ajenidad (el mundo no se controla), acceso mediado (evidencia más débil, más incertidumbre declarada) y cambio autónomo (peso en detectar el cambio no informado)— y el criterio interno de la frontera MED╪MDM.

## Historial — Documento #10 (MED)

#9 **aprobado como documento raíz de la capa conceptual** (estable; no se reabre salvo contradicción estructural). Patrón adoptado: cada documento conceptual abre con **«Relación con el Documento #9»** (entidad que desarrolla · límites que hereda · invariantes que respeta).

**#10 redactado**, primer desarrollo de dominio: el interior del MED. Estrena la sección de relación con el #9.
- **Decisión de diseño interna (framework-consistente, no eleva a primer nivel):** el MED se define como **marco extensible de dimensiones**; el contenido de una organización concreta es **instanciación**, no parte de la definición conceptual. Derivada de la extensibilidad ratificada + universalidad progresiva.
- Anatomía, ciclo de vida y **7 invariantes internos** especializando los del #9. Sin redefinir ninguna entidad del #9. Verificado: sin lenguaje de implementación.

## En curso — #13 Sistema de Inteligencia (alcance)

**#12 aprobado definitivamente.** Alcance funcional reducido del #13 preparado (`docs/ai/_alcance-13-sistema-de-ia.md`): cuatro preguntas —qué es operar intelectualmente · sobre qué · qué produce · qué queda fuera— + **invariante operativo de soberanía**: *la IA produce hipótesis; nunca sustituye la soberanía de la persona*.

**El #13 se organiza alrededor de las *operaciones intelectuales*** (explicar, diagnosticar, inferir, proyectar, generar hipótesis, orientar…), no de tecnologías de IA.

**Decisión de nombre pendiente del Director:** el contenido trasciende la tecnología → «Sistema de IA» está en tensión con Independencia Tecnológica. Recomendado un nombre conceptual (*Sistema de Inteligencia* / *de Operaciones Intelectuales*). Cambiarlo actualiza el índice (no normativo, costo bajo).

## 🧊 CAPA CONCEPTUAL Y DE DOMINIO — CONGELADA (2026-07-19)

**Gate de Arquitectura superado** (`docs/architecture/_gate-arquitectura-capa-conceptual.md`): grafo de dependencias **acíclico**; sin referencias invertidas, duplicaciones, entidades huérfanas, operaciones sin consumidor, capacidades sin propósito ni invariantes incompatibles. Una observación menor (O-1: el *marco/instanciación* del #9 se generaliza a operaciones y capacidades), resuelta por interpretación, sin enmienda.

**Congelamiento:** #9–#14 no se modifican durante la construcción técnica. Reapertura solo por contradicción estructural, imposibilidad arquitectónica o inconsistencia demostrable — nunca por redacción ni comodidad de implementación; por el circuito #8→#6→#7→#5.

## Detalle — capa #9–#14

Arco cerrado: **#9 sitúa → #10 MED / #11 MDM representan → #12 ECE integra → #13 opera → #14 materializa.**

| Elemento | Documentos | Categoría |
|---|---|---|
| Mapa raíz | #9 (v1.1) | — |
| Representaciones | #10 MED · #11 MDM · #12 ECE | Estructurales |
| Facultades | #13 Operaciones Intelectuales · #14 Capacidades | Dinámicos |

**#14 redactado:** capacidad = composición de operaciones con propósito humano (nunca al revés). Jerarquía **ECE → Operaciones → Capacidades → Persona**. Marco extensible de familias (comprender el estado · detectar lo no visto · anticipar · preservar y transmitir · orientar la decisión); anatomía de 4 elementos; 8 invariantes internos. Verificado: sin implementación (pantallas/APIs/agentes/flujos), prueba de eliminación del #16 superada.

## Historial — Documento #13

**Elevación resuelta por el Director:** dos categorías arquitectónicas ratificadas —**Elementos Estructurales** (#10–#12, bloque I del #9) y **Elementos Dinámicos** (#13–#14, bloque IV)—, sin enmendar el #9. Regla metodológica: *cada documento desarrolla un elemento situado por el #9, estructural o dinámico*. Nombre fijado: **Sistema de Operaciones Intelectuales** (descartados «IA» y «Inteligencia»).

**#13 redactado:** desarrolla el elemento dinámico —las operaciones intelectuales del ciclo del #9—. Marco extensible de operaciones (esclarecer · detectar · proyectar · orientar); productos ofrecidos al juicio humano con incertidumbre y atribución; **invariante de soberanía** sostenido por topología (el lazo se cierra fuera del sistema); 9 invariantes internos. Verificado: sin tecnología concreta, prueba de eliminación del #14 superada.

## Historial — Elevación del #13 (resuelta)

Condición de parada activada. Registro: `docs/decisions/elevacion-naturaleza-documento-13.md`. **No se redacta el #13 hasta la decisión.**

**Hallazgo:** el #13 **no desarrolla una entidad** de la Ontología del #9 — describe una **actividad**. Está situado, pero en el **bloque IV (Ciclos)**: las operaciones intelectuales del ciclo Comprender→Aprender→Adaptarse→Orientar. El patrón se precisa: *cada documento desarrolla un elemento situado por el #9, que puede ser **entidad** (bloque I) o **facultad/ciclo** (bloque IV)*. La capa de dominio tiene dos categorías —Representaciones (#10–#12) y Facultades (#13–#14)—; el #9 ya contenía ambas, no requiere enmienda.

**Decisiones pendientes del Director:** (1) ratificar la lectura de dos categorías; (2) nombre del #13 derivado de la facultad —recomendado *Operaciones Intelectuales*—.

## 🏁 CAPA DE EJECUCIÓN COMPLETA (#17–#19) — BIBLIOTECA MAESTRA 19/19

Los tres documentos de ejecución redactados, estrictamente operativos (ninguno introduce arquitectura nueva):
- **#17 Roadmap Maestro** — fases de construcción en orden de dependencia (Base técnica → Modelos → ECE → Operaciones → Capacidades); avance gated por conformidad #15; priorización concreta = instanciación estratégica (#6).
- **#18 Manual del Ingeniero** — reúne la Fundación en práctica diaria: método de 7 fases, checklist de reglas permanentes con puntero a su fuente, cuándo detenerse y elevar. No crea reglas.
- **#19 Orden de Inicio de la Fase 1** — la puerta (Art. 3.2): declara el cierre de la Fundación en 4 capas, el régimen posterior, y **habilita** la decisión del Propietario de inicializar Git e iniciar la Fase 1.

**Régimen posterior:** interpretar antes que enmendar · capa congelada intacta salvo contradicción · todo cambio por el circuito #8→#6→#7→#5.

## Historial — capa técnica (#15–#16)

**#16 Arquitectura Técnica redactado:** instancia la arquitectura congelada sin redefinirla (verificado: cero definiciones nuevas). Doctrina propia: **Regla de Estratificación Técnica A/B/C** —irreemplazable (estructura derivada) · sustituible con adaptación · reemplazable sin impacto—. Componentes técnicos con rol Nivel A y realización Nivel C; el **órgano de IA es Nivel C por diseño** (demostración de Independencia Tecnológica). Prueba de reemplazabilidad superada: eliminar IA/BD/framework deja la arquitectura intacta. Selección concreta de productos = instanciación diferida a la autoridad competente.

Jerarquía de realización completa: **Principio (#4) → Método (#7) → Estándar (#15) → Implementación (#16)**, distinta de la jerarquía de capas y sin mezclarse con ella.

## Historial — Documento #15

Primer documento de la **capa técnica**. Convierte los principios congelados en criterios **objetivos, verificables y auditables**, sin redefinir ninguno (verificado: cero definiciones nuevas; 18 estándares con fuente citada).

- **Premisa:** la implementación se verifica contra la arquitectura; nunca la arquitectura se adapta al código (Art. 3 + congelamiento).
- **9 estándares de conformidad arquitectónica** (atribución, no confusión, historia inmutable, explicabilidad, soberanía, alcance transportado, no-elevación de certeza, anti-atrofia, extensibilidad), cada uno con su forma de auditoría.
- Estándares de proceso, calidad e invariantes de los estándares.
- **Umbrales y herramientas concretas = instanciación** diferida a que #16 fije la tecnología (mismo patrón marco/instanciación).

## Próximo paso — dos decisiones del Propietario, ninguna ejecutada aún

1. **Inicializar Git** (Art. 6.2) — marca el inicio oficial del desarrollo.
2. **Iniciar la Fase 1 — Desarrollo**, cuando se decida.

Ambas quedaron **deliberadamente diferidas** a la decisión explícita del Propietario. La Biblioteca las habilita; no las ejecuta.

**Cuando comience la Fase 1**, el primer trabajo del roadmap (#17) es la **Fase 1 — Base técnica**: instanciar las estructuras Nivel A tras sus fronteras.

**Secuencia de arranque recomendada por el Director de Arquitectura** (no funcionalidades visibles primero):
1. Instanciar la **Base Técnica** respetando las estructuras Nivel A (#16).
2. **Verificar** que la infraestructura satisface los estándares del #15.
3. **Inicializar el repositorio** (Git) solo cuando exista un primer estado base coherente para versionar (Art. 6.2).
4. Construir **incrementalmente** modelos → ECE → operaciones → capacidades, por el grafo de dependencias aprobado (#17).

> **Precisión de gobernanza:** esta secuencia sitúa la inicialización de Git en el paso 3, cuando exista base técnica versionable. Es coherente con el Art. 6.2 (Git marca el inicio del desarrollo). La *orden* de iniciar la Fase 1 y la *ejecución* de cada paso siguen siendo decisiones explícitas del Propietario; la Biblioteca las habilita, no las dispara.

**Régimen:** interpretar antes que enmendar · capa congelada intacta salvo contradicción · todo cambio por el circuito #8→#6→#7→#5.

**Cambio de criterio de evaluación (desde la Fase 1):** la pregunta deja de ser *«¿la Fundación es correcta y consistente?»* y pasa a ser *«¿la implementación mantiene la conformidad con la Fundación?»*. Cada decisión de ingeniería —cada ADR, componente e incremento— debe **justificarse contra la Biblioteca ya aprobada**, sin trasladar autoridad desde la implementación hacia la arquitectura. El rol de supervisión verifica conformidad, no redefine principios.

Hallazgos abiertos (no bloqueantes): C-4, C-5, C-6, C-8, residual de C-7.

## Historial — Documento #12 (ECE)

Alcance validado y **#12 redactado en un bloque**. Principio rector (Director de Arquitectura): **«El ECE transforma representación en comprensión integrada; nunca transforma comprensión en acción.»** Unifica las dos fronteras (integra conocimiento/no inteligencia · establece estructura/no decisión) en una sola línea: *lo que el ECE **es*** vs *lo que otras capas **hacen** con él*.

- Define **qué significa integrar** (coherencias, contradicciones, ausencias, dependencias, brechas — comprensión, no inteligencia; es la *coherencia gobernada* de #3).
- **7 invariantes internos**, incluido «no origina afirmaciones sobre el mundo» y «la integración no eleva la certeza».
- Sin lenguaje de implementación (motor/pipeline/orquestador/…): verificado, cero apariciones. Prueba de eliminación del #13: pasa.

## Próximo paso

Revisión de **#10, #11 y #12**. Después: **#13 Sistema de IA** —lo que *opera intelectualmente* sobre el ECE: razonar, aprender, recomendar; con la frontera del #12 ya trazada—. Luego #14 Capacidades.

Hallazgos abiertos (no bloqueantes): C-4, C-5, C-6, C-8, residual de C-7.

Hallazgos abiertos (no bloqueantes): C-4, C-5, C-6, C-8 y el residual de C-7.

Hallazgo abierto adicional: **C-8** (la pregunta declarada del #6 se refiere a actores, pero aloja reglas sobre documentos).

Hallazgos abiertos: **C-8** (jurisdicción del #6 — trazabilidad propia, no mezclar) · C-4, C-5, C-6 (condicionados a eventos futuros).

## Bitácora

| Fecha | Bloque cerrado | Notas |
|---|---|---|
| 2026-07-19 | Scaffolding Fase 0 | Estructura conocimiento-primero creada. Raíz oficial confirmada en `C:\proyectos\SOEC`. |
| 2026-07-19 | Índice + doc #1 (borrador) | Creado `docs/00-INDICE-BIBLIOTECA-MAESTRA.md` (mapa de los 19 documentos) y `docs/constitution/01-constitucion-maestra.md` v0.1. Git sigue sin inicializar por directiva. |
| 2026-07-19 | Fase 0.A concluida | 6 bloques de descubrimiento ratificados: categoría (Sistema Operativo Empresarial Cognitivo), problema (incapacidad cognitiva creciente), necesidad (dependencia social de organizaciones complejas), diferenciación (infraestructura cognitiva / diferenciación por misión), propósito (autonomía intelectual) y principios de identidad (Deber/Límites/Carácter con Prueba de Propósito). |
| 2026-07-19 | Constitución v0.2 | Artículo 2 (Identidad de SOEC) completado con la visión ratificada; añadidos preámbulo civilizatorio, Art. 5.7 (honestidad intelectual) y Art. 8 (tres niveles de permanencia + Prueba de Propósito). |
