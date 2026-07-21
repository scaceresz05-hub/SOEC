# Arquitectura Técnica — SOEC

> **Documento #16 de la Biblioteca Maestra.** Capa Técnica. Competencia primaria: **implementar** — definir cómo la tecnología **instancia** la arquitectura congelada.
>
> **Pregunta que responde:** ¿Cómo realiza la tecnología la arquitectura conceptual sin adquirir autoridad sobre ella y preservando la Independencia Tecnológica?
>
> **Lo que este documento NO gobierna:** los principios (→ #4), el método (→ #7), la arquitectura conceptual y de dominio (→ #9–#14, **congelada**), y los estándares de verificación (→ #15). **No redefine ningún concepto ni principio:** los instancia.

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** 🔵 En revisión.
- **Posición en la jerarquía de realización:** **Principio (#4) → Método (#7) → Estándar (#15) → Implementación (#16).** Este documento ocupa el último nivel y no invade los anteriores.

---

## 1. Premisa

> **La tecnología instancia la arquitectura; nunca la redefine ni la gobierna.** Toda decisión técnica es una *instancia* de un elemento arquitectónico, justificada por él, y se mantiene reemplazable cuando la arquitectura lo permite. Ninguna dificultad de implementación modifica la arquitectura sin demostrar antes una contradicción conceptual real (Art. 3; congelamiento del Gate).

## 2. Regla de Estratificación Técnica

Toda decisión técnica se clasifica **explícitamente** en un nivel de reemplazabilidad. Es la Independencia Tecnológica (Const. 2.5) llevada a la ingeniería.

| Nivel | Qué es | Al cambiar… |
|---|---|---|
| **A — Irreemplazable** | Deriva directamente de la arquitectura. No es una tecnología, es una **estructura exigida** por un invariante | …no puede cambiar mientras la arquitectura siga vigente |
| **B — Sustituible con adaptación** | Puede cambiar, pero obliga a adaptar piezas conectadas | …se re-adapta lo dependiente; la arquitectura permanece |
| **C — Reemplazable sin impacto** | Producto o tecnología concreta detrás de una frontera estable | …se sustituye sin tocar la arquitectura; solo se re-instancian las medidas del #15 |

**El Nivel A no contiene productos.** Contiene estructuras (p. ej. «un almacén cuya historia no se sobrescribe»). Los **productos concretos son siempre Nivel C**: viven detrás de una frontera y son sustituibles.

## 3. Componentes técnicos — instanciación de la arquitectura congelada

Cada componente **realiza** un elemento de #9–#14. Su **rol** es Nivel A (derivado de la arquitectura); su **realización tecnológica** es Nivel C.

| Componente (rol — Nivel A) | Realiza | Exigencia estructural (Nivel A) | Realización (Nivel C) |
|---|---|---|---|
| **Almacén de representaciones** | Modelos (#10, #11) · Historia epistemológica (#9) | Event-sourced; historia inmutable; toda afirmación atribuible; estado como proyección | *base de datos / motor de eventos concreto* |
| **Integrador cognitivo** | ECE (#12) | Integra modelos; representa brecha y consistencia; no origina hechos del mundo; no eleva la certeza | *técnica de integración concreta* |
| **Órgano de operaciones intelectuales** | Operaciones (#13) | Opera sobre el ECE; produce productos atribuidos con incertidumbre; **no cierra el lazo** | *LLM / motor simbólico / híbrido — el órgano reemplazable por excelencia* |
| **Compositor de capacidades** | Capacidades (#14) | Compone operaciones hacia un propósito humano; entrega al juicio | *framework de composición concreto* |
| **Adaptadores de fuentes** | Estrategia integrar→absorber; ERP/CRM como fuentes de los modelos | Convierten sistemas externos en evidencia con procedencia | *conectores concretos* (Nivel B/C) |
| **Frontera de soberanía** | Soberanía Humana (Const. 2.4) | Estructura que garantiza que todo producto llega al juicio humano y ningún curso cierra una decisión reservada | — *(estructural; sin producto propio)* |

## 4. Demostración de la Independencia Tecnológica

El componente más expuesto a la tecnología —el **órgano de operaciones intelectuales**— es deliberadamente **Nivel C**, tras una frontera estable. La arquitectura ya lo previó: *«la IA es un órgano reemplazable, no el cuerpo»* (Const. 2.5).

Consecuencia verificable: puede sustituirse el LLM por un motor simbólico, o por una técnica aún inexistente, **sin tocar** el ECE, los modelos, las operaciones como concepto, las capacidades ni ningún invariante. Lo único que cambia es la realización tras la frontera, y las medidas concretas del #15 se re-instancian.

## 5. Prueba de reemplazabilidad *(prueba del #16)*

El documento cumple su función si, al eliminar cualquiera de estas tecnologías, sigue sabiéndose con precisión qué permanece y qué se adapta:

| Se elimina… | Permanece intacto (Nivel A) | Se adapta (B) | Se re-instancia |
|---|---|---|---|
| El proveedor de IA | ECE, modelos, operaciones, capacidades, todos los invariantes | la frontera del órgano | medidas del #15 sobre ese órgano |
| La base de datos | la exigencia event-sourced, la atribución, la historia | el almacén | medidas de integridad |
| El framework de composición | las capacidades como composición, la soberanía | el compositor | — |
| Una librería | *(nada arquitectónico)* | lo que la usaba | — |

**Si al cambiar una tecnología se rompiera la arquitectura, el #16 habría fracasado.** Por construcción, ninguna tecnología de este documento es Nivel A.

## 6. Selección concreta de tecnologías — instanciación

Este documento define **la estructura técnica y su estratificación**, no elige productos por preferencia. La selección concreta de cada componente Nivel C —qué motor de IA, qué base de datos, qué frameworks— es una **instanciación** que decide la autoridad competente (#6) cuando corresponda, se registra con su nivel de reemplazabilidad, y **nunca adquiere rango arquitectónico**. Cambiarla es una transformación de Nivel C que recorre el circuito (#8→#6→#7→#5) sin tocar #9–#14.

## 7. Invariantes de la arquitectura técnica

1. **Instancia, no doctrina.** Ninguna decisión técnica crea, redefine ni gobierna un principio, un elemento de dominio o un invariante arquitectónico.
2. **Estratificación obligatoria.** Toda decisión técnica declara su nivel (A/B/C) y **justifica esa clasificación**. Una decisión sin nivel declarado no está autorizada. **Ninguna decisión asciende de nivel por conveniencia de implementación**; solo puede hacerlo mediante revisión arquitectónica formal (circuito #8→#6→#7→#5). Esto impide que una tecnología elegida por comodidad termine tratándose como parte de la arquitectura.
3. **Productos siempre reemplazables.** Ningún producto concreto es Nivel A; todos viven detrás de una frontera estable.
4. **Subordinación.** Ante conflicto entre una necesidad técnica y la arquitectura, prevalece la arquitectura; la técnica se adapta (Art. 7.2, #15 §7).
5. **Conformidad verificable.** Toda realización es auditable contra los estándares del #15.

---

**Continuidad.** Este documento instancia la arquitectura congelada en una estructura técnica estratificada y reemplazable. La **selección concreta de productos**, su configuración y su despliegue son instanciación operativa; la **secuencia** de construcción vive en el Roadmap (#17); el **modo de trabajo del ingeniero**, en #18; y la **puerta de inicio del desarrollo**, en #19. Con el #16, la arquitectura conceptual queda dotada de un cuerpo técnico que puede cambiar sin que ella cambie.
