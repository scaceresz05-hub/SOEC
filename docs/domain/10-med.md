# Modelo Empresarial Digital (MED) — SOEC

> **Documento #10 de la Biblioteca Maestra.** Capa de Dominio. Competencia primaria: **desarrollar el interior del MED**.
>
> **Pregunta que responde:** ¿Qué es el MED por dentro — qué contiene, cómo se estructura conceptualmente y cómo evoluciona?
>
> **Lo que este documento NO gobierna:** la ubicación del MED en el mapa conceptual y sus fronteras externas (→ #9), el interior del Modelo del Mundo (→ #11), cómo se integran los modelos en el ECE (→ #12), cómo la IA construye o actualiza el MED (→ #13), las capacidades que lo explotan (→ #14) y la implementación técnica (→ #16).

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** 🔵 En revisión.

---

## 0. Relación con el Documento #9

> Este documento desarrolla el interior de una entidad ya situada por el Documento #9. **Ninguna definición aquí contenida modifica su existencia, límites o relaciones arquitectónicas.**

- **Entidad que desarrolla:** *Modelo* → específicamente el **Modelo Empresarial Digital (MED)**, situado por el #9 en el **plano de la Representación**.
- **Límites que hereda** (no los redefine; los respeta): Realidad ╪ Representación (el MED **no es** la empresa), Modelo ╪ ECE (el MED **no es** el ECE: lo alimenta), Representación ╪ Apropiación (que el MED contenga algo no equivale a que la organización lo comprenda), Arquitectura conceptual ╪ sustrato técnico.
- **Invariantes que debe respetar:** los diez del #9, en particular Atribución, Declaración de la representación, Transporte, Historia inmutable, Separación de planos, Revisabilidad y Explicabilidad.
- **Regla de crecimiento:** toda entidad que aparezca aquí es **interna al MED** o deriva de una entidad ya situada por el #9. Una entidad que fuera arquitectónica de primer nivel detiene el trabajo y se eleva.

## 1. Qué es el MED

El MED es la **representación viva de la empresa** que SOEC sostiene: el modelo del *aspecto empresa* de la realidad. Representa la organización tal como es, cómo está configurada y cómo está cambiando — no la organización misma.

Por ser un **Modelo** (una Representación, en los términos del #9 y del #3), el MED **hereda la anatomía de toda representación**: declara para qué fue construido, qué representa, qué deja fuera y bajo qué supuestos; está hecho de afirmaciones; cada afirmación porta su tipo, alcance, régimen y justificación; se sostiene en evidencia; madura; y su estado es una proyección sobre su propia historia. El MED no reinventa nada de esto: lo **instancia sobre el dominio de la empresa**.

## 2. Qué representa el MED — un marco, no un catálogo cerrado

El MED representa la empresa a lo largo de **dimensiones**. Este documento fija las dimensiones como un **marco extensible**, no como una lista cerrada, porque la visión de SOEC es universal: el MED debe poder representar cualquier organización, y cada organización instancia el marco con su propio contenido.

Dimensiones estructurales del marco:

- **Lo que la empresa *es*** — su composición: unidades, roles, recursos, activos, ubicaciones.
- **Lo que la empresa *hace*** — su operación: procesos, actividades, servicios, flujos.
- **Lo que la empresa *tiene y debe*** — su estado material y de obligaciones: recursos disponibles, compromisos, restricciones.
- **Con qué y con quién se *relaciona*** — sus vínculos: personas, contrapartes, dependencias internas y externas.
- **Hacia dónde *quiere ir*** — sus objetivos, prioridades y criterios propios.
- **Cómo ha *cambiado*** — su dimensión temporal: la historia de su configuración.

> **Distinción de instanciación.** El MED, como concepto, define **el marco** (estas dimensiones y su anatomía). El **contenido** que llena el marco para una organización concreta —qué procesos, qué recursos, qué obligaciones tiene *esa* empresa— es una **instanciación** del MED, no parte de su definición conceptual. El marco es universal; la instancia es particular. Nuevas dimensiones pueden añadirse al marco sin romperlo, del mismo modo que nuevos modelos se añaden al ECE (extensibilidad ratificada en la Fase 0.A).

## 3. Anatomía interna del MED

El MED se compone internamente de:

- **Afirmaciones sobre la empresa.** La unidad mínima de contenido del MED. Cada una sostiene algo sobre una dimensión —«esta unidad ejecuta este proceso», «este recurso tiene este estado»— con su tipo, alcance, justificación y supuestos.
- **Entidades empresariales representadas.** Los referentes internos de esas afirmaciones: la representación de una unidad, de un recurso, de un proceso. Son *representaciones de* elementos de la empresa, nunca los elementos mismos (límite Realidad ╪ Representación).
- **Relaciones internas.** Los vínculos que el MED representa entre sus entidades: composición, dependencia, pertenencia, referencia — reflejo representado de las relaciones reales de la empresa.
- **Supuestos y ámbito de validez declarados.** Qué asume el MED y qué deja explícitamente fuera. Un MED sin ámbito declarado no es un modelo válido.
- **Historia del MED.** La secuencia de eventos por los que sus afirmaciones nacieron, cambiaron de estado o fueron revisadas. El MED actual es una proyección sobre ella; su pasado no se sobrescribe.

## 4. Ciclo de vida interno del MED

El MED instancia, sobre el dominio de la empresa, el ciclo de vida de toda representación (#9, bloque IV):

- **Nacimiento.** Una afirmación sobre la empresa se incorpora al MED, con su procedencia y su grado de madurez.
- **Maduración.** Una afirmación asciende de dato a reconocimiento, hipótesis o conocimiento a medida que se justifica — sin secuencia obligatoria.
- **Consolidación.** El MED integra afirmaciones coherentes en una representación estable de una dimensión.
- **Caducidad o archivo.** Una afirmación deja de estar vigente, o sale de la representación activa, sin que su historia se pierda.
- **Sustitución o recuperación.** Una representación es reemplazada por otra mejor justificada, o una afirmación invalidada se recupera con nueva justificación.

El MED nunca está terminado: la empresa cambia, y el MED cambia con ella registrando cada cambio como evento, no como sobrescritura.

## 5. Invariantes internos del MED

Especializaciones, sobre el dominio de la empresa, de los invariantes del #9. Una instanciación del MED que viole cualquiera de ellos no es un MED.

1. **El MED representa; no constituye.** Una afirmación del MED nunca crea un hecho de la empresa: lo representa. La empresa es anterior e independiente.
2. **Toda afirmación del MED es atribuible** a su fuente, propósito y supuestos. El MED no habla en primera persona sobre la empresa: habla desde representaciones declaradas.
3. **El MED declara su ámbito.** Siempre consta qué parte de la empresa representa y cuál no. Lo no representado no se presume inexistente (No Confusión de la Ausencia).
4. **El MED conserva su historia.** El estado actual es proyección sobre una historia inmutable de eventos; se puede reconstruir qué representaba el MED en cualquier momento pasado.
5. **El MED es extensible sin ruptura.** Añadir una dimensión o una entidad no invalida las existentes.
6. **El MED es explicable.** Toda afirmación que sostiene puede ser seguida por una persona; el MED no contiene representaciones que la organización no pueda comprender.
7. **El MED no cierra el lazo.** Alimenta el ECE y orienta a la persona; no decide ni actúa sobre la empresa.

## 6. Relación interna con el MDM y el ECE

*(El #9 ya fijó estas fronteras desde fuera; aquí solo se declara cómo el interior del MED se conecta, sin desarrollar lo ajeno.)*

- **Con el MDM.** El MED representa la empresa; el MDM representa el mundo. Son modelos distintos con dominios distintos. El MED no representa el entorno: cuando una afirmación concierne al mundo, pertenece al MDM. El interior del MDM se desarrolla en #11.
- **Con el ECE.** El MED es un **modelo contribuyente**: alimenta el ECE, que integra su representación con la de los demás modelos en una comprensión única. **Cómo** el ECE integra los modelos pertenece a #12. El MED no es el ECE ni lo contiene.

---

**Continuidad.** Este documento desarrolla el interior del MED dentro de los límites que el #9 estableció. La representación del entorno vive en #11; la integración de los modelos en el ECE, en #12; la construcción y actualización del MED mediante IA, en #13; las capacidades que lo explotan, en #14; y su realización técnica, en #16. La instanciación del marco del MED para una organización concreta es trabajo de configuración, no de este documento.
