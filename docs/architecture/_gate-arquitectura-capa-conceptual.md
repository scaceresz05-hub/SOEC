# Gate de Arquitectura — Capa Conceptual y de Dominio (#9–#14)

> Auditoría **estructural**, no editorial. Busca únicamente inconsistencias de arquitectura. No propone mejoras ni ampliaciones.

- **Fecha:** 2026-07-19 · **Alcance:** #9, #10, #11, #12, #13, #14.
- **Método:** mapeo mecánico de referencias cruzadas + verificación de consumidores, propósitos y ámbito de principios + análisis del grafo de dependencias.

## 1. Grafo de dependencias — ¿hay ciclos?

Se distingue **dependencia** (A necesita que B esté definido para tener sentido) de **remisión** (A apunta a B como «desarrollado más adelante / frontera / continuidad»). Las remisiones hacia adelante **no** son dependencias.

**Dependencias reales (hacia atrás):**

```
#9  ─┬─▶ #10 (MED)
     ├─▶ #11 (MDM) ──▶ #10   (hereda anatomía por Simetría)
     ├─▶ #12 (ECE) ──▶ #10, #11   (integra los modelos)
     ├─▶ #13 (Operaciones) ──▶ #12   (opera sobre el ECE)
     └─▶ #14 (Capacidades) ──▶ #13   (compone operaciones)
```

**Verdicto:** DAG **acíclico**. Ningún documento depende de uno posterior para su definición. Verificado que las referencias «hacia adelante» (#10→#12, #12→#13, #13→#14, todos→#16) son **remisiones y fronteras**, no dependencias. La única relación lateral —#10↔#11— es asimétrica y sana: #11 depende de #10 (anatomía), #10 solo *referencia* a #11 (frontera MED╪MDM), sin necesitarlo. **Sin ciclos, sin dependencias invertidas.**

## 2. Checklist estructural

| Verificación | Resultado |
|---|---|
| Dependencias circulares | **Ninguna** (§1) |
| Referencias invertidas | **Ninguna** — todas las hacia-adelante son remisiones |
| Conceptos duplicados / principios declarados dos veces | **Ninguno.** *Brecha* se sitúa en #9, su cálculo se remite a #12, #11 remite; *marco/instanciación* se declara una vez en #9 (inv. 12); anti-atrofia, soberanía, atribución se **aplican** desde su fuente (Constitución/#3), no se re-declaran |
| Entidades sin propietario | **Ninguna.** Modelos → #10/#11; ECE → #12; Afirmación/Evidencia/Historia → declaradas en #3, situadas en #9; Empresa/Mundo/Persona → externas (no se desarrollan por diseño) |
| Operaciones sin consumidor | **Ninguna.** Las cuatro familias de #13 (esclarecer, detectar, proyectar, orientar) son compuestas por capacidades del #14 |
| Capacidades sin propósito | **Ninguna.** 5 familias, 5 propósitos humanos declarados |
| Invariantes incompatibles | **Ninguno.** «El ECE no origina afirmaciones sobre el mundo» (#12) es coherente con «las operaciones producen productos, no hechos» (#13); «la integración no eleva la certeza» (#12) con «operar no eleva la autoridad» (#13); soberanía y anti-atrofia coherentes en #12/#13/#14 |
| Jerarquía sin inversión | **Correcta:** Realidad → Modelos → ECE → Operaciones → Capacidades → Persona |

## 3. Observación menor (no bloqueante)

**O-1.** El invariante 12 del #9 (*Marco e instanciación*) está redactado sobre **modelos**; #13 y #14 aplican el mismo patrón a **operaciones** y **capacidades** («como los modelos, forman un marco extensible»). Es una **generalización por analogía**, no una contradicción ni una doble declaración.

**Resolución por interpretación (no requiere enmienda):** el invariante 12 se entiende como una propiedad general de los **conjuntos conceptuales extensibles** de SOEC —modelos, operaciones, capacidades—, no exclusiva de los modelos. Coherente con *interpretar antes que enmendar*. Se deja registrada, no se corrige.

## 4. Verdicto

**La arquitectura conceptual y de dominio (#9–#14) es estructuralmente consistente.** Sin ciclos, sin dependencias invertidas, sin duplicaciones normativas, sin entidades huérfanas, sin operaciones sin consumidor, sin capacidades sin propósito, sin invariantes incompatibles. Una sola observación menor, resuelta por interpretación.

## 5. Congelamiento

> **La capa conceptual y de dominio (#9–#14) queda CONGELADA el 2026-07-19.** No se modifica durante la construcción técnica. Solo puede reabrirse por **contradicción estructural**, **imposibilidad arquitectónica descubierta** o **inconsistencia demostrable** — nunca por mejora de redacción ni por comodidad de implementación. Toda reapertura recorre el circuito de transformación (#8 → #6 → #7 → #5).

Con este congelamiento, el trabajo cambia de naturaleza: **de definir qué es SOEC a establecer cómo construirlo** sobre una arquitectura ya validada.
