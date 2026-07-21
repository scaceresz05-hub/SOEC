# Manual Operativo del Ingeniero de Implementación — SOEC

> **Documento #18 de la Biblioteca Maestra.** Capa de Ejecución. Competencia primaria: **operacionalizar** — traducir toda la Fundación en la práctica diaria.
>
> **Pregunta que responde:** ¿Cómo debe trabajar, día a día, quien construye SOEC para que su trabajo respete la Fundación completa?
>
> **Lo que este documento NO gobierna:** ningún principio, dominio, arquitectura, estándar ni secuencia nuevos (→ #1–#17). **No crea reglas:** reúne las ya establecidas en una guía de trabajo, con puntero a su fuente.

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** 🔵 En revisión.

---

## 1. Antes de tocar nada

1. **Leer `MASTER_STATUS.md`.** Es el primer archivo: dice dónde está el proyecto y qué está abierto.
2. **Identificar la capa que se va a tocar.** Constitucional, conceptual/dominio (congelada), técnica o ejecución. Cada una tiene reglas distintas.
3. **Inspeccionar antes de modificar** (Art. 5.1): verificar el estado real; no asumir.

## 2. El método de cada cambio

Toda transformación —de código, dato, configuración o documento— recorre las **siete fases del #7**, con profundidad proporcional a su impacto: **Observar → Comprender → Justificar → Decidir (autoridad competente) → Implementar → Verificar → Registrar y sincronizar.** Nada se implementa por haber sido propuesto; nada se declara terminado sin verificar.

## 3. Reglas permanentes en el trabajo diario

Checklist derivado; cada regla remite a su fuente, que **no** se reinterpreta aquí.

- **Atribución** (#9, #15): toda salida es rastreable a la representación, el propósito y los supuestos que la produjeron. SOEC nunca afirma en primera persona sobre el mundo.
- **No Confusión** (K-1): un modelo no es la realidad; no presentar representación como hecho.
- **Historia inmutable** (#9, #15): no se sobrescribe; las correcciones enlazan, no borran.
- **Soberanía** (Const. 2.4): ningún curso cierra una decisión reservada al juicio humano. Se produce el producto; decide la persona.
- **Explicabilidad** (Const. 2.4): nada que la persona no pueda seguir.
- **Anti-atrofia** (Const. 2.4, #14): toda capacidad declara qué capacidad humana desarrolla, preserva o sustituye; se rechaza la que crea dependencia.
- **Estratificación técnica** (#16): toda decisión técnica declara y justifica su nivel A/B/C; ninguna asciende de nivel por conveniencia.
- **Carga de la prueba** (#4): se justifica el cambio, nunca el estado vigente.
- **Deuda declarada** (#4): toda deuda consta con su condición de saldo. Deuda oculta = daño diferido.
- **Excepción registrada** (#4, #7): toda excepción es explícita, acotada y con plazo.

## 4. Cuándo detenerse y elevar

**No** resolver por cuenta propia —detener y elevar como decisión— cuando aparezca:

- una **contradicción estructural** demostrable o una **laguna** que ninguna regla vigente resuelve;
- una decisión que toque **objetivos, arquitectura, competencias, niveles de permanencia o principios constitutivos**;
- una **acción irreversible**;
- un **elemento arquitectónico de primer nivel** no previsto (nueva entidad o dinámica del #9);
- la necesidad de **modificar la capa congelada** (#9–#14): primero se demuestra la contradicción conceptual; jamás se adapta la arquitectura para facilitar el código.

Fuera de estos casos: **resolver y continuar** (modo de aplicación, no de deliberación).

## 5. Antes de declarar algo terminado

- **Verificar** contra los estándares del #15; una implementación conforme, no solo funcional.
- **Honestidad de estado** (Art. 5.6): lo hecho como hecho, lo pendiente como pendiente, lo incierto como incierto.
- **Sincronizar la Custodia** (#5): una transformación no está cerrada hasta que el registro la refleja.

## 6. Honestidad intelectual

Toda propuesta —propia o ajena— se evalúa por su razonamiento, no por su autor (Art. 5.7). Si una idea tiene una fisura, se señala aunque incomode. El objetivo es la solidez, no la validación.

---

**Continuidad.** Este manual reúne, para el trabajo diario, reglas que viven en su fuente. Ante cualquier duda sobre el contenido de una regla, se consulta el documento que la declara, no este manual. La autorización para comenzar la Fase 1 vive en #19.
