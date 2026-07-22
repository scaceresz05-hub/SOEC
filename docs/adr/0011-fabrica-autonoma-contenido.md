# ADR-0011 — Fábrica Autónoma de Contenido Multicanal (F2-CONT-01)

- **Estado:** ✅ **ACEPTADO.** Tercera vertical del Departamento de Marketing Autónomo. Continúa ADR-0009 (plano operativo) y ADR-0010 (planificador), sin abrir circuito de enmienda.
- **Fecha:** 2026-07-21 · **Bloque:** F2-CONT-01.

## Contexto

F2-MKT-01 (ADR-0010) dejó una deuda explícita: SOEC sabía **qué** trabajo hacer (plan versionado con actividades), pero no sabía **producir** el material para ejecutarlo; `contenido_faltante` se resolvía a mano con fixtures. Este ADR fija la **fábrica de contenido** (`@soec/contenido`): dada una actividad de marketing bloqueada por falta de contenido, produce un **paquete publicable** versionado (brief → pieza fuente → adaptaciones por canal → activos → validación → revisión), lo entrega a la actividad por el contrato público de marketing y deja que el plano operacional lo ejecute (simulado). La fábrica **produce**; no publica, no se autoriza, no gasta.

## Decisiones

### D-1. La fábrica produce; el plano operacional sigue siendo la única puerta al efecto *(Nivel A)*

Cadena no invertible, sin núcleo de decisión ni vía alternativa de publicación:

```text
Planificador (actividad bloqueada por contenido)
   → Fábrica de contenido (brief → pieza → adaptaciones → validación → revisión → paquete)
   → entrega por contrato público de marketing (actividad → autorizable)
   → Motor de autorización (política vigente)
   → Coordinador operacional → Adaptador SIMULADO → verificación
```

`@soec/contenido` depende por **contrato público** de `@soec/marketing` (leer plan/objetivo; `PlanningService.prepararActividad`) y de `@soec/operacional` (tipos de política); nunca al revés. La fábrica **no** importa `@soec/operacional`'s adaptadores, no publica, no accede a SDK de canales, no gasta presupuesto. Prueba arquitectónica lo verifica.

### D-2. Modelo editorial explícito y versionado (event-sourced) *(Nivel A)*

Agregados append-only con máquinas de estado propias: **marca** (`marca:<id>`, identidad versionada), **prompt** (`prompt:<id>`, plantillas versionadas), **brief** (`brief:<id>`), y **paquete** (`paquete:<id>`) que agrupa pieza fuente, adaptaciones, activos, validaciones, revisiones, procedencia y huellas de integridad. Estados editoriales explícitos (brief: borrador…listo/bloqueado; pieza: propuesta…válida/rechazada; adaptación: pendiente…lista/bloqueada; paquete: ensamblando…listo/denegado/verificado). Las transiciones inválidas se rechazan y toda transición conserva historial. Una revisión **nunca sobrescribe** una versión anterior.

### D-3. Veracidad: procedencia de afirmaciones; la ausencia es visible *(Nivel A)*

SOEC no produce contenido comercial inventando datos. Toda afirmación relevante se **clasifica por origen** (hecho confirmado · declarada por la empresa · inferencia · propuesta creativa · no sustentada · prohibida · dato faltante) y conserva texto, fuente, confianza, política aplicable, riesgo y estado. Reglas duras: una afirmación **prohibida bloquea** la pieza; una **no sustentada** no se presenta como hecho; una **propuesta creativa** no se convierte en dato real; la **adaptación no eleva la certeza** de la pieza fuente; un **brief incompleto** no se completa inventando — queda `incompleto` con los faltantes visibles y no habilita producción.

### D-4. Frontera generativa independiente; el proveedor es NO confiable *(Nivel A/C)*

El dominio **no depende** de OpenAI/Anthropic/Google: define el puerto `ProveedorGenerativo` (solicitud estructurada → respuesta estructurada validada). El proveedor por defecto es **determinista** (fixture, reproducible, sin internet ni credenciales) — **no es "IA real"**. El sistema trata la salida del proveedor como **no confiable** (§9): la primera pasada no pre-filtra las restricciones; es la **validación del sistema**, no el proveedor, quien las garantiza. Un adaptador generativo real solo podría existir desactivado, sin secretos obligatorios, sin llamarse en pruebas y sin efectos de publicación. **Ningún secreto es obligatorio** (verificado por prueba arquitectónica).

### D-5. Prompts como activos versionados *(Nivel A)*

Las instrucciones de generación no viven dispersas como strings: son plantillas con propósito, versión, variables, restricciones, esquema esperado, idioma, vigencia, historial y **huella determinista**. Se conserva qué versión de prompt (`prompt:<id>@v<n>#<huella>`) produjo cada pieza. No se almacena razonamiento privado; solo instrucciones, entrada estructurada, salida, validaciones y decisiones del sistema.

### D-6. Validación estructurada y revisión automática acotada *(Nivel A)*

La validación produce **hallazgos** (código, severidad, ubicación, descripción, evidencia, acción posible, bloqueante), nunca un `true/false`: completitud, longitud, formato, coherencia con el brief, identidad de marca, afirmaciones, expresiones prohibidas, CTA, accesibilidad, compatibilidad de canal, idioma, disclaimers. Cuando un hallazgo bloqueante es **corregible** (afirmación/expresión prohibida), la **revisión automática** añade la subcadena ofensiva a la lista `evitar`, **regenera una nueva versión** y revalida, hasta un límite de rondas. Si el bloqueo persiste, la adaptación queda **bloqueada** conservando los hallazgos, sin publicar y sin repetir indefinidamente. **Una pieza inválida nunca alcanza un estado ejecutable ni desbloquea la actividad.**

### D-7. Adaptación multicanal y activos como especificaciones *(Nivel A/C)*

Perfiles de canal abstractos (blog, instagram, facebook, linkedin, meta_ads, correo) con formatos, límites, campos y reglas. Una misma pieza fuente produce varias adaptaciones **sin duplicar la semántica**: cada adaptación conserva las afirmaciones (no elevadas) y las advertencias (disclaimers esenciales) de la pieza. Los activos visuales son **especificaciones estructuradas verificables** (brief visual, storyboard, guion), no imágenes/videos finales; el modelo queda preparado para archivos reales.

## Consecuencias

- `contenido_faltante` deja de ser deuda manual: es una condición que la fábrica **resuelve sistemáticamente** cuando dispone de información suficiente. Una actividad pasa de `contenido_faltante` a `autorizable` con un paquete versionado, trazable y validado detrás.
- Se preservan intactos: propósito raíz, soberanía transformada, no-vinculación del conocimiento, y el guardarraíl de **ningún efecto externo real** (generación determinista; publicación simulada por el plano operacional).
- Se habilita el bloque siguiente (F2-CHAN-01, primer adaptador de publicación **controlada**): el paquete publicable es el contrato que ese adaptador consumirá. Publicar/gastar/enviar en real sigue siendo **causal de parada** hasta autorización explícita.

## Trazabilidad

ADR-0009 (autorización por política; efectos simulados) · ADR-0010 (planificador; contrato de actividades) · Const. v1.7 Art. 2.1/2.4 · #13 (composición) · ADR-0002 (contratos de conformidad) · ADR-0007 (dominio PyME sintético) · Principio de Evaluabilidad (la ausencia de información no es conclusión). La fábrica no revisa el propósito raíz (2.2) ni toca la capa congelada.
