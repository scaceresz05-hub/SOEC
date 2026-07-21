# ADR-0006 — Sistema de Capacidades ejecutable (F1-CAP-01)

- **Estado:** ✅ **ACEPTADO.** Realiza el Documento #14 componiendo operaciones intelectuales (ADR-0005); no redefine ninguna entidad congelada, no invierte la jerarquía, no implementa interfaces ni acciones externas.
- **Fecha:** 2026-07-21 · **Fase:** 1 — Bloque F1-CAP-01.

## Contexto

F1-CAP-01 construye las capacidades: **composiciones de operaciones intelectuales orientadas a un propósito humano** (#14 §1-§2). Una capacidad compone operaciones; nunca al revés, y nunca otra capacidad (§7). Cierra el arco conceptual **ECE → Operaciones → Capacidades → Persona**. La única ruta cognitiva permitida es Capacidad → operaciones (por su puerto público) → ECE.

## Decisiones

### D-1. Definición versionada, append-only, separada de la ejecución *(Nivel A)*

- Una capacidad se representa por un agregado de **definición** (`capdef:<id>`: versión registrada → publicada → retirada) y por agregados de **ejecución** (`capexec:<id>`: solicitada → paso_ejecutado* → compuesta|abstenida). Modificar una definición **no reescribe** ejecuciones anteriores; una ejecución histórica conserva la versión exacta usada. Categorías distinguidas: capacidad / definición / ejecución / producto / orquestador técnico (§5), sin mezclarlas.

### D-2. Composición de operaciones tras un puerto público, sin inversión ni atajos *(Nivel A)*

- El orquestador consume las operaciones **solo por `OperacionesPort`** (frontera pública nueva del #13); **no** accede al ECE, MED ni MDM. Una prueba arquitectónica prohíbe imports de `@soec/ece`/`@soec/models`/UI/SDK. La regla de composición (secuencia por `dependeDe`, paralelo entre independientes, convergencia en el producto, `usaProductoDe` para alimentar un paso con el producto de otro) vive en la **definición versionada**; la forma técnica de orquestación es reemplazable. No es un motor genérico de workflows: solo la composición necesaria para el #14.

### D-3. Protección contra ciclos y operaciones desconocidas *(Nivel A)*

- El registro valida cada definición: las operaciones deben ser las cuatro del #13 (`OperacionDesconocidaError`); el grafo de pasos debe ser acíclico; y una capacidad **no puede componerse de sí misma**, directa o indirectamente (`CicloDetectadoError`). En este bloque las capacidades se componen solo de operaciones (`componeCapacidades` vacío); el chequeo de ciclos existe como guardarraíl.

### D-4. Producto compuesto explicable, con guardarraíles *(Nivel A)*

- El producto de capacidad conserva definición+versión, propósito, operaciones ejecutadas, **referencias a cada ejecución intelectual** (nunca ocultas), productos intermedios, composición explicable, evidencia, procedencia, incertidumbre, limitaciones, faltante, **contradicciones abiertas**, cuestiones reservadas al juicio humano, abstención y `bindingDecision: false`.
- **Soberanía:** el orquestador rechaza (`GuardarrailCapacidadError`) todo producto vinculante; no hay adaptadores de efecto (prueba arquitectónica).
- **Anti-atrofia:** rechaza productos opacos (que oculten operaciones, no dejen nada al juicio humano o no tengan soporte). No convierte orientación en mandato, detección en alerta vinculante, proyección en plan ni esclarecimiento en verdad definitiva.

### D-5. Abstención compuesta y régimen temporal *(Nivel A)*

- Una capacidad puede completarse, completarse con limitaciones o abstenerse (parcial/total). Si un paso **obligatorio** se abstiene, la capacidad se abstiene, conservando paso afectado, causa, evidencia disponible y faltante. Cada ejecución consume (indirectamente, vía operaciones) un corte del ECE; el producto histórico **no se recalcula**.

### D-6. Persistencia y proyecciones reconstruibles *(Nivel B/C)*

- Persistencia PostgreSQL (`proj_capdef_current`, `proj_capexec_current`, migración `0005`); proyecciones reconstruibles e idempotentes; worker de drenaje único (MED+MDM+ECE+OI+Capacidades). Extensión general del event store (sin atajos de dominio); las capas exponen sets de migración acumulados (`migracionesHastaOperaciones`).

## Consecuencias

- Con el #14 se cierra el arco conceptual ejecutable de la Fundación. El bloque siguiente lo determina el grafo del #17. Las capacidades quedan como composiciones no vinculantes que terminan siempre ante el juicio humano.

## Trazabilidad

#9 (invariantes) · #13 (operaciones que compone, por su puerto) · #14 (autoridad principal: composición, propósito humano, anatomía, familias) · #15 (conformidad) · #16 (orquestador técnico reemplazable) · ADR-0002/0003/0004/0005. Ninguna cláusula redefine estos documentos; los realiza.
