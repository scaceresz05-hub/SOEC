# ADR-0017 — Divulgación Progresiva Auditable en las Experiencias

- **Estado:** ✅ **ACEPTADO.** Principio transversal de experiencia que gobierna Director Workspace (F2-DISC-02) y toda experiencia futura (Captura Interactiva F2-DISC-03, Preparación, Operación, etc.).
- **Fecha:** 2026-07-23 · **Bloque:** F2-DISC-02 (previo a la implementación).

## Contexto

Al pasar de motores a **consumidores** (experiencias que un humano usa para gobernar), aparece una tensión clásica: una interfaz «simple» tiende a *ocultar* complejidad. En SOEC eso sería un defecto de gobernanza, no una virtud de UX: si una pantalla esconde faltantes, contradicciones o la cadena de procedencia para «verse limpia», compromete la **auditabilidad** y la **soberanía del juicio humano**. Este ADR formaliza una regla que hasta ahora era implícita (la sección Transparencia y la trazabilidad expandible de la directiva F2-DISC-02 ya la anticipan) y la eleva a principio.

## Decisiones

### D-1. Regla rectora *(Nivel B — directivo de experiencia)*
> **El Director Workspace —y toda experiencia de SOEC— nunca debe ocultar complejidad mediante simplificación; debe reducir la carga cognitiva mediante organización.**

No es un principio nuevo: es la **realización, en la capa de experiencia**, de la Transparencia organizacional (Constitución #4 §5 — «si el funcionamiento resulta inexplicable para quien lo usa, el defecto es del sistema»), la Evaluabilidad (Filosofía #3) y «No diseñar para reemplazar el criterio» (#4 §5). Este ADR remite a esas fuentes; no las re-legisla.

### D-2. Divulgación progresiva por capas, no por truncamiento
La experiencia muestra **primero lo esencial**, permite **profundizar progresivamente** (esencial → detalle → evidencia original) y **nunca impide llegar a la evidencia original**. Lo que se colapsa se puede expandir; nunca se elimina.

### D-3. Toda conclusión conserva ruta a su procedencia
Ninguna pantalla presenta un resultado sin un camino navegable a su cadena:
- candidato → explicación → mapeo (`MAP-*`) → señales (`SIG-*`) → hechos (preguntaId/valor) → respuestas originales;
- comprensión → evidencia / faltantes / contradicciones;
- decisión → snapshot congelado íntegro (comprensión + `ResultadoEstrategia` + candidato + huella).

### D-4. Lo ausente es de primera clase
Faltantes, contradicciones, incertidumbre y supuestos **nunca se ocultan** para «parecer simple»; se organizan y se hacen visibles (coherente con la sección **Transparencia** de F2-DISC-02: confianza global, supuestos, incertidumbre, próximos datos más valiosos).

### D-5. Alcance transversal
Aplica a **todas** las experiencias presentes y futuras (Director Workspace, Captura Interactiva, Preparación, Operación, y las de futuros departamentos), no solo a este bloque.

## Consecuencias
- **Criterio de aceptación de cualquier experiencia:** ¿toda conclusión mostrada permite llegar, por profundización progresiva, a su evidencia original? Si no, la experiencia no cierra.
- F2-DISC-02 implementa la divulgación progresiva (flujo deliberativo + trazabilidad expandible + Transparencia) como aplicación directa de este ADR.
- Reduce el riesgo de que una experiencia futura «amable» erosione la auditabilidad o la soberanía del juicio humano.
