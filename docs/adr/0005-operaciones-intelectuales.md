# ADR-0005 — Sistema de Operaciones Intelectuales ejecutable (F1-OI-01)

- **Estado:** ✅ **ACEPTADO.** Realiza el Documento #13 operando sobre el ECE (ADR-0004); no redefine ninguna entidad congelada y no incorpora capacidades ni IA real.
- **Fecha:** 2026-07-20 · **Fase:** 1 — Bloque F1-OI-01.

## Contexto

F1-OI-01 construye las cuatro operaciones intelectuales (esclarecer, detectar, proyectar, orientar) que operan **sobre el ECE** (nunca sobre la realidad ni sobre las tablas de MED/MDM/ECE), produciendo **productos ofrecidos al juicio humano**. El invariante de soberanía (#13 §5) es la vara: producen hipótesis, nunca deciden; pueden abstenerse.

## Decisiones

### D-1. Anatomía común + productos especializados discriminados *(Nivel A)*

- Toda ejecución produce un `ProductoBase` común (operación, corte del ECE, propósito, procedencia, evidencia, faltante, limitaciones, incertidumbre, razones, cuestiones reservadas al juicio humano, atribución, abstención, `bindingDecision: false`, mecanismo+versión) y un campo **especializado** por operación (`esclarecimiento` | `deteccion` | `proyeccion` | `orientacion`), en **unión discriminada** por `operacion`. No se impone "hipótesis" como supertipo (la Fundación no lo autoriza). La anatomía es Nivel A; el contenido, derivado del propósito.

### D-2. Operación (Nivel A) ╪ Mecanismo (Nivel C sustituible) *(Nivel A/C)*

- La operación es arquitectónica; el mecanismo que la realiza vive tras el puerto neutral `MecanismoOperacion`. Dos mecanismos compatibles se probaron: **determinístico** (referencia, sin IA) e **IA simulada** (adaptador, `requiereSalidaDeOrg` para ejercitar la política de datos). Sustituir el mecanismo no cambia la identidad ni la anatomía de la operación (escenario G). El dominio **no importa ningún SDK externo**.

### D-3. El determinístico consume solo datos autorizados del ECE, es reproducible y se abstiene *(Nivel C)*

- Deriva coherencias/contradicciones/ausencias/dependencias/brechas del ECE (por su puerto de lectura), sin inventar contenido, conservando procedencia, declarando limitaciones e incertidumbre, y **abstiene** cuando falta materia. Reproducible: mismas entradas → mismo producto.

### D-4. Guardarraíles verificables de soberanía y anti-atrofia *(Nivel A)*

- **Soberanía:** todo producto lleva `bindingDecision: false` (literal de tipo); el servicio rechaza (`SoberaniaVioladaError`) cualquier producto vinculante. No existe adaptador de efectos externos; una prueba arquitectónica lo garantiza.
- **Anti-atrofia:** el servicio rechaza (`ProductoOpacoError`) productos opacos (una conclusión sin razones, evidencia ni faltante; una orientación sin cuestiones reservadas al juicio humano). El guardarraíl aplica a todo mecanismo, presente y futuro.

### D-5. Abstención como resultado válido, con causas clasificadas *(Nivel A)*

- Once causas (evidencia_insuficiente, contradiccion_no_resoluble, ausencia_critica, alcance_insuficiente, ece_desactualizado, proposito_no_permitido, mecanismo_no_disponible, limite_presupuestario, timeout, cancelacion, politica_datos), clasificadas en **conceptuales** y **técnicas**. Una abstención conserva causa, faltante, limitaciones y atribución; nunca se reemplaza por un resultado inventado.

### D-6. Régimen temporal y persistencia append-only *(Nivel A, heredado)*

- Cada ejecución consume un **corte** específico del ECE y persiste como agregado event-sourced (`oi:<id>`: solicitada → ejecutada|abstenida). Un producto histórico **no se recalcula** con conocimiento posterior; una nueva ejecución es una nueva historia. Proyección `proj_oi_current` reconstruible; worker de drenaje único (MED+MDM+ECE+OI) idempotente. Extensión general del event store (sin atajos de dominio).

## Consecuencias

- El siguiente bloque (Capacidades, #14) podrá **componer** operaciones; las operaciones quedan como piezas estables y no vinculantes. Ninguna operación cierra el lazo humano: el ciclo se cierra fuera del sistema.
- El coordinador lee el ECE **solo por su puerto** (`EceReadPort`), nunca por tablas; una prueba arquitectónica prohíbe que las operaciones dependan de `@soec/models`, capacidades, UI o SDK externos.

## Trazabilidad

#9 (invariantes) · #12 (entrada: ECE) · #13 (autoridad principal: operaciones, productos, soberanía, anti-atrofia) · #14 (frontera posterior) · #15 (conformidad) · #16 (operación Nivel A / mecanismo Nivel C) · ADR-0002/0003/0004. Ninguna cláusula redefine estos documentos; los realiza.
