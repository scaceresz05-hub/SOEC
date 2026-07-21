# Capacidades del Sistema — SOEC

> **Documento #14 de la Biblioteca Maestra.** Capa de Dominio. Competencia primaria: **desarrollar las capacidades conceptuales del sistema**.
>
> **Pregunta que responde:** ¿Qué capacidades existen, qué propósito humano cumplen, qué operaciones intelectuales las componen y qué productos conceptuales entregan?
>
> **Lo que este documento NO gobierna:** la ubicación de las capacidades en el mapa (→ #9), las operaciones intelectuales que componen (→ #13), el ECE y los modelos (→ #10, #11, #12), y **toda la implementación** —interfaces, agentes, APIs, flujos de ejecución, pantallas, tecnologías— (→ #16). El **juicio y la decisión** son humanos (Const. 2.4).

- **Versión:** 1.1 · **Fecha:** 2026-07-21 · **Estado:** 🔵 En revisión. *(v1.1: §6 y ajuste del invariante 3 — dos clases de capacidad, intelectual y operacional; enmienda v1.7 por el circuito #8→#6→#7→#5. Ver Const. 2.1/2.4 v1.7 y ADR-0009.)*

---

## 0. Relación con el Documento #9

> Este documento desarrolla el interior de un elemento ya situado por el Documento #9. **Ninguna definición aquí contenida modifica su existencia, límites o relaciones arquitectónicas.**

- **Elemento que desarrolla:** el segundo **Elemento Dinámico** —las **capacidades**, que materializan las operaciones intelectuales al servicio de un propósito humano—. Cierra el arco *#12 integra → #13 opera → #14 materializa*.
- **Límites que hereda:** SOEC ╪ Persona (el juicio es humano), Capacidad ╪ Implementación (qué puede hacer SOEC, no cómo lo hace), Capacidad ╪ Operación (una capacidad compone; no es una operación elemental).
- **Invariantes que respeta:** los del #9, con especial peso de Cierre humano del ciclo, Explicabilidad, Atribución, Anti-atrofia e Independencia del sustrato.

## 1. Qué es una capacidad

Una **capacidad** es un **conjunto coherente de operaciones intelectuales orientadas a un propósito humano**. No es una operación: es una **composición** de operaciones (#13) puesta al servicio de algo que una persona necesita comprender o decidir.

Las capacidades responden *qué puede hacer SOEC por una persona*; no *cómo lo hace*. El *cómo* —con qué tecnología, a través de qué interfaz, mediante qué agente— pertenece a la implementación (#16) y no aparece en este documento.

## 2. Principio de composición

> **Las capacidades son composiciones de operaciones intelectuales. Nunca al revés.**

De aquí se sigue la jerarquía arquitectónica completa, que este documento no puede invertir:

```
ECE  →  Operaciones Intelectuales  →  Capacidades  →  Persona
(comprensión     (esclarecer, detectar,   (composiciones    (juzga
 integrada)       proyectar, orientar)     con propósito)     y decide)
```

Una capacidad **no inventa operaciones**: organiza las que el #13 ya definió. Si una capacidad necesitara una operación que el #13 no contiene, el trabajo se detiene y se eleva —sería una operación nueva, materia del #13, no del #14—.

## 3. Anatomía de una capacidad

Toda capacidad, cualquiera sea, se declara por cuatro elementos y solo cuatro:

- **Propósito humano** — qué necesita comprender o decidir la persona a la que sirve.
- **Operaciones que compone** — cuáles operaciones intelectuales del #13 la integran, y en qué relación.
- **Producto conceptual** — qué entrega a la persona, con su justificación, su incertidumbre y su atribución (régimen de #3).
- **Límite** — qué **no** hace: dónde termina la capacidad y comienza el juicio humano.

Ninguna capacidad se declara por su mecanismo, su tecnología ni su forma de presentación.

## 4. Familias de capacidades — un marco extensible

Como las operaciones y los modelos, las capacidades forman un **marco extensible**, no un catálogo cerrado: cada organización instancia las que necesita, y nuevas capacidades se incorporan sin romper las existentes. Se agrupan por el propósito humano que sirven.

- **Comprender el estado** — hacer inteligible la situación actual de la organización y su entorno. *Propósito:* saber dónde se está. *Compone:* esclarecer + detectar. *Entrega:* una comprensión explicada del estado, con sus tensiones y faltantes visibles.
- **Detectar lo que no se ve** — hacer visible la deriva silenciosa, la contradicción, la ausencia. *Propósito:* enterarse a tiempo de lo que nadie preguntó. *Compone:* detectar + esclarecer. *Entrega:* señales justificadas de aquello que merece atención, incluida la pregunta que aún no se formuló.
- **Anticipar** — extender la comprensión hacia lo que tendería a ocurrir. *Propósito:* prepararse. *Compone:* proyectar + comparar + esclarecer. *Entrega:* proyecciones y escenarios, presentados como tales —nunca como hechos—, con su incertidumbre declarada.
- **Preservar y transmitir la comprensión** — sostener el conocimiento de la organización frente al cambio de personas y del tiempo. *Propósito:* que la organización no pierda lo que comprende. *Compone:* esclarecer + detectar faltantes. *Entrega:* comprensión recuperable y transmisible (Deber Permanente, Const. 2.3).
- **Orientar una decisión** — poner la comprensión al servicio de una decisión humana concreta. *Propósito:* decidir mejor, sin dejar de decidir. *Compone:* orientar + esclarecer + reconocer incertidumbre. *Entrega:* cursos, prioridades o cuestiones a considerar, con su justificación, **para que la persona juzgue**.

## 5. Invariantes internos

Una realización de las capacidades que viole cualquiera de estos no pertenece a este sistema.

1. **Composición, no operación.** Toda capacidad compone operaciones del #13; ninguna es una operación elemental ni inventa operaciones nuevas.
2. **Propósito humano declarado.** Una capacidad sin un propósito humano identificable no es una capacidad.
3. **Entrega al juicio, no decisión estratégica** *(v1.7)*. Ninguna capacidad decide la **estrategia** por la persona ni sustituye su juicio. Las **capacidades intelectuales** terminan entregando un producto no vinculante a una persona. Las **capacidades operacionales** (§6) ejecutan únicamente **acciones operativas previamente autorizadas por una política humana vigente**, dentro de sus límites, de forma trazable, reversible donde sea posible, supervisada y revocable; su cierre operativo puede ocurrir dentro del sistema sin que ello sustituya la decisión estratégica humana (Const. 2.4, v1.7).
4. **Hereda el alcance.** Una capacidad no produce resultados con más autoridad, certeza o alcance que las operaciones y representaciones que la componen.
5. **Explicable.** Todo producto de una capacidad puede seguirse hasta las operaciones, la comprensión y las representaciones que lo originaron.
6. **Anti-atrofia.** Las capacidades amplían lo que las personas pueden comprender y hacer por sí mismas; no crean dependencia. Una capacidad que, al retirarse, dejara a la organización más incapaz que antes, contradice este sistema.
7. **Conceptual, no técnica.** Una capacidad se define por su propósito, sus operaciones y su producto; nunca por su tecnología, su interfaz ni su forma de presentación.
8. **Extensible.** Nuevas capacidades se incorporan sin romper las existentes; cada organización instancia las que necesita.

## 6. Dos clases de capacidad *(enmienda v1.7 — ejecución operativa autorizada por política)*

> Introducida por el circuito #8→#6→#7→#5 bajo la Directiva Maestra (2026-07-21) y la enmienda constitucional v1.7. No crea motores paralelos: ambas clases comparten anatomía (propósito humano · composición · producto · límite) y se distinguen por lo que producen.

- **Capacidades intelectuales** — componen operaciones intelectuales (#13) y producen **conocimiento** (comprensión, evidencia, hipótesis, alternativas). Su producto es **no vinculante** y se ofrece al juicio humano. No ejecutan por sí mismas una acción comercial irreversible. *(Son las del arco original: comprender el estado, detectar, anticipar, orientar…)*
- **Capacidades operacionales** — ejecutan **acciones operativas** previamente autorizadas por una **política humana vigente**. Consumen —por contratos públicos— productos intelectuales trazables, políticas, autorizaciones y evidencia; **no** son un núcleo intelectual paralelo. Ninguna se ejecuta sin política válida ni fuera de sus límites de presupuesto y riesgo; toda ejecución es trazable, verificable, reversible donde sea posible, supervisada y revocable.

Relación obligatoria (no invertible):

```text
Capacidades intelectuales → Producto intelectual trazable → Política y autorización → Plan operativo → Capacidades operacionales → Efectos registrados
```

**Invariantes propios de la capacidad operacional** (además de los internos aplicables): (a) **No hay acción sin política vigente que la autorice**; (b) **la autorización es evaluable y auditable** (permitir/denegar con motivo); (c) **idempotencia y reversibilidad donde sea posible**; (d) **soberanía transformada**: la persona conserva estrategia, presupuesto, prohibiciones, alto riesgo, supervisión, intervención y suspensión total; (e) **ningún efecto externo real sin autorización explícita**; (f) **anti-atrofia e interpretabilidad**: la persona debe poder comprender qué se hizo y por qué.

---

**Continuidad.** Este documento desarrolla las capacidades hasta el borde del propósito humano al que sirven. **Cómo** se realizan —con qué tecnología, a través de qué interfaz, mediante qué agente o flujo— vive en la Arquitectura Técnica (#16). Con el #14 se completa el arco conceptual **ECE → Operaciones Intelectuales → Capacidades → Persona**: qué comprende SOEC, qué hace con esa comprensión, qué pone al servicio de las personas, y dónde, siempre, se detiene ante su juicio.
