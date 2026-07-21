# Sistema de Operaciones Intelectuales — SOEC

> **Documento #13 de la Biblioteca Maestra.** Capa de Dominio. Competencia primaria: **desarrollar el interior de las operaciones intelectuales**.
>
> **Pregunta que responde:** ¿Qué significa operar intelectualmente sobre la comprensión, qué operaciones existen, sobre qué actúan, qué producen y dónde se detienen?
>
> **Lo que este documento NO gobierna:** la ubicación de las operaciones en el mapa (→ #9), el interior de los modelos y del ECE (→ #10, #11, #12), la **orquestación** de estas operaciones en **capacidades concretas** y su interacción con usuarios (→ #14), la tecnología y la implementación —qué modelo, cómo se ejecuta— (→ #16). El **juicio y la decisión** no son materia de ningún documento del sistema: son humanos (Const. 2.4).

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** 🔵 En revisión.

---

## 0. Relación con el Documento #9

> Este documento desarrolla el interior de un elemento ya situado por el Documento #9. **Ninguna definición aquí contenida modifica su existencia, límites o relaciones arquitectónicas.**

- **Elemento que desarrolla:** un **elemento dinámico** —las **operaciones intelectuales** del ciclo perpetuo *Comprender → Aprender → Adaptarse → Orientar*, situado por el #9 en su **bloque IV (Ciclos conceptuales)**—. No es una entidad estructural: es aquello que *ocurre* sobre las entidades.
- **Límites que hereda:** SOEC ╪ Persona (el juicio es humano), Representación ╪ Realidad (las operaciones actúan sobre representaciones), ECE ╪ IA (integrar es del ECE; operar sobre lo integrado es de aquí).
- **Invariantes que respeta:** los del #9, con especial peso de Cierre humano del ciclo, Explicabilidad, Atribución e Independencia del sustrato.

## 1. Qué es una operación intelectual

Una **operación intelectual** es un acto de pensamiento sobre la comprensión ya integrada: no un algoritmo, sino aquello que se *hace* con lo que se comprende. Cada operación **toma** la comprensión del ECE (y, a través de él, de los modelos) y **produce** un resultado intelectual —una explicación, un diagnóstico, una hipótesis, una orientación— **ofrecido al juicio humano**.

Las operaciones intelectuales son **independientes de la tecnología** que las realiza: podrán ejecutarse con un modelo de lenguaje, un sistema simbólico, un razonador probabilístico o una técnica aún inexistente. Este documento describe **qué son y qué producen**, no cómo se ejecutan.

## 2. Sobre qué operan

Sobre el **ECE** —la comprensión integrada— y, a través de él, sobre los modelos. **Nunca sobre la realidad directamente.** Una operación intelectual no observa el mundo: opera sobre representaciones que otros ya sostienen. Por eso **hereda de ellas** su alcance, su régimen, su incertidumbre y su atribución, y no puede producir un resultado con más autoridad que las representaciones sobre las que trabajó.

## 3. Los tipos de operación intelectual — un marco extensible

Como los modelos, las operaciones forman un **marco extensible**, no una lista cerrada: nuevas operaciones se incorporan sin romper las existentes. Se organizan por lo que hacen con la comprensión.

- **Esclarecer** — hacer comprensible lo ya comprendido: **explicar** (por qué se sostiene algo), **interpretar** (qué significa), **comparar** (en qué se distinguen dos situaciones).
- **Detectar** — hacer visible lo que no se veía: **diagnosticar** (qué estado revela la comprensión), **identificar faltantes** (qué se necesitaría saber), **detectar tensiones** (dónde los modelos se contradicen o la organización deriva sin advertirlo).
- **Proyectar** — extender la comprensión más allá de lo dado: **inferir** (qué se sigue), **proyectar** (qué tendería a ocurrir), **generar hipótesis** (qué podría explicar lo observado).
- **Orientar** — poner la comprensión al servicio de una decisión humana: **proponer** cursos, prioridades o cuestiones a considerar, **con su justificación y su incertidumbre**, para que la persona juzgue.

**Aprender** atraviesa todas ellas: una operación puede detectar que una representación debería revisarse y **proponer** esa revisión. Pero revisar una representación es un evento del modelo (gobernado por #3 y #10–#12), no un acto que estas operaciones ejecuten por sí mismas. Y todo aprendizaje está sujeto a la anti-atrofia: **debe ampliar la capacidad de comprender de las personas, no reemplazarla.**

## 4. Qué producen

**Productos intelectuales ofrecidos al juicio humano.** Cada producto —explicación, diagnóstico, hipótesis, proyección, orientación— porta:

- su **justificación** y su **tipo** (régimen de #3): una proyección no se presenta como hecho, una interpretación no se presenta como demostración;
- su **incertidumbre y su alcance** declarados;
- su **atribución**: de qué comprensión y de qué representaciones proviene.

**Ninguno es una decisión.** Ninguno es vinculante. Cada uno es una entrada para el juicio de una persona, no un sustituto de él.

## 5. El invariante de soberanía

> **La operación intelectual produce hipótesis; nunca sustituye la soberanía de la persona.**

Operativamente: las operaciones **proponen, explican, justifican, reconocen su incertidumbre y pueden abstenerse** —«no sé» es un resultado legítimo (E4)—; **nunca deciden, nunca priorizan como acto vinculante, nunca sustituyen el juicio humano.**

Esta soberanía no se sostiene solo por prohibición, sino por **topología**: las operaciones actúan sobre el ECE y entregan productos a la persona; **el lazo del ciclo se cierra fuera del sistema, en la decisión humana**, cuya acción y cuyos efectos reingresan como nuevos eventos. Una operación no tiene por dónde cerrar el lazo por sí misma.

## 6. Invariantes internos

Una realización de las operaciones intelectuales que viole cualquiera de estos no es este sistema.

1. **Producto, no decisión.** Toda operación entrega algo al juicio humano; ninguna decide.
2. **Sobre representación, no sobre realidad.** Ninguna operación observa el mundo; todas operan sobre el ECE y heredan alcance, régimen, incertidumbre y atribución de las representaciones sobre las que trabajan.
3. **No eleva la autoridad.** Operar sobre una comprensión no la vuelve más cierta; la certeza solo crece con justificación independiente (#3, #12).
4. **Declara incertidumbre y puede abstenerse.** La ignorancia y la incertidumbre son resultados legítimos, no fallos.
5. **Explicable.** Todo producto puede seguirse hasta la comprensión y las representaciones que lo originaron.
6. **Anti-atrofia.** Las operaciones amplían la capacidad de comprender de las personas; no crean dependencia ni la sustituyen.
7. **No cierra el ciclo estratégico** *(v1.7)*. Las **operaciones intelectuales** orientan y entregan productos no vinculantes; no deciden ni ejecutan. La decisión estratégica es humana. La **ejecución de acciones operativas** autorizadas por política vive en las capacidades operacionales (#14 §6), fuera de este documento: las operaciones intelectuales siguen sin cerrar el lazo por sí mismas.
8. **Independientes del sustrato.** Las operaciones son las mismas cualquiera sea la tecnología que las realice.
9. **Extensibles.** Nuevas operaciones se incorporan sin romper las existentes.

---

**Continuidad.** Este documento desarrolla las operaciones intelectuales hasta el borde de la orientación, donde el juicio humano toma el relevo. **Cómo** estas operaciones se organizan en capacidades concretas y se ofrecen a usuarios vive en #14; **cómo** se ejecutan y con qué tecnología, en #16. Ninguna operación descrita aquí decide: todas terminan entregando su producto a una persona.
