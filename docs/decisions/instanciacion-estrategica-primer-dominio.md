# Instanciación Estratégica — Primer Dominio y Primera Capacidad Real

> **Registro de instanciación** (no declara arquitectura). Emitido por la **Autoridad Estratégica (#6)** conforme al **Roadmap #17 §5** («qué dominio inicial, qué capacidades primero … es una decisión de la Autoridad Estratégica, que se registra como instanciación y se justifica contra la arquitectura»).

- **Fecha:** 2026-07-21 · **Bloque:** F1-RM-01 · **Estado:** ✅ Emitida.

## Contexto

Al cerrar F1-CAP-01 quedó completo el arco conceptual ejecutable **MED+MDM → ECE → Operaciones → Capacidades → Persona**, construido **a nivel de marco extensible con fixtures sintéticos**. El Roadmap #17 (Fase 2 «para un primer dominio»; §4 universalidad progresiva; §5 instanciación estratégica) reserva a la Autoridad Estratégica la elección concreta del **primer dominio real** y de la **primera capacidad**. F1-RM-01 detectó esa bifurcación y la elevó.

## Decisión (Autoridad Estratégica)

1. **Dominio inicial:** **Pyme de servicios (genérico)**. Organización de servicios acotada; buen banco de universalidad progresiva (#17 §4), menor complejidad regulatoria que dominios altamente normados.
2. **Primera capacidad real:** familia **«Comprender el estado»** (#14 §4) — compone **esclarecer + detectar**. Es la de mayor anti-atrofia y soberanía: hace inteligible el estado actual **sin proyectar, orientar ni decidir**.
3. **Fuentes de datos:** **solo fixtures sintéticos**. Sin conectores, sin interfaz, sin datos ni credenciales reales (frontera de soberanía y causal de parada vigentes).

## Justificación contra la arquitectura

- **No introduce arquitectura nueva** (#17 §1, Art. 3): la pyme se representa **instanciando** el marco MED/MDM ya congelado; sus entidades concretas (unidades, procesos, ofertas, recursos, objetivos / normas, mercado) son **contenido de instanciación** (tipos de instancia), no conceptos de primer nivel (#10 §2).
- **Respeta la jerarquía y la soberanía:** la capacidad compone operaciones existentes por el `OperacionesPort`, entrega un producto **no vinculante** al juicio humano y **no ejecuta efectos** (#14 inv. 3; #13 §5).
- **Propósito humano autorizado (#14 §8):** *que la persona responsable de la pyme comprenda el estado actual de su organización y su entorno, con sus tensiones, contradicciones y faltantes visibles.*
- **Universalidad progresiva (#17 §4):** primer dominio acotado; la visión permanece universal.

## Alcance de F1-RM-01 (ejecución técnica habilitada)

Instanciar sobre el sistema existente (sin excepciones arquitectónicas, orden §8):
1. un **MED** y un **MDM** sintéticos de una pyme de servicios;
2. su **ECE** integrado;
3. la **capacidad real «Comprender el estado»** registrada y publicada (definición versionada, no fixture de prueba);
4. una **ejecución** que produce un producto compuesto no vinculante, con verificación (pruebas, PostgreSQL real).

## Fuera de alcance (reservado / no autorizado aquí)

Interfaces, conectores, efectos externos, datos reales, credenciales, otras capacidades (Anticipar/Orientar/Preservar), despliegue. Su priorización es nueva instanciación estratégica cuando el Roadmap y la Autoridad lo determinen.

## Trazabilidad

#6 (autoridad para la instanciación) · #10/#11 (marco MED/MDM) · #12 (ECE) · #13 (operaciones esclarecer/detectar) · #14 (familia «Comprender el estado») · #17 §4-§5 (universalidad progresiva e instanciación estratégica). Ninguna cláusula modifica la Fundación.
