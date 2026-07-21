# ADR-0009 — Realineamiento: SOEC como Departamento de Marketing Autónomo (F2-AUT-01)

- **Estado:** ✅ **ACEPTADO.** Realiza la enmienda constitucional v1.7 (Art. 2.1/2.4) y la Directiva Maestra (2026-07-21). Deliberación: `docs/decisions/deliberacion-ejecucion-operativa-autonoma.md`.
- **Fecha:** 2026-07-21 · **Bloque:** F2-AUT-01.

## Contexto

La Autoridad Estratégica decidió que SOEC debe **ejecutar** trabajo operativo de marketing de forma continua y autónoma **dentro de políticas humanas vigentes**. Se completó el circuito formal de enmienda: la Constitución (v1.7) distingue **decisión estratégica reservada** de **acción operativa autorizada por política**, preservando el propósito raíz (Autonomía Intelectual) por Prueba de Propósito. Este ADR fija las consecuencias arquitectónicas.

## Decisiones

### D-1. Dos clases de capacidad, misma anatomía, sin motores paralelos *(Nivel A)*

- **Intelectuales** (existentes): componen operaciones (#13), producen conocimiento **no vinculante** (`bindingDecision:false`). No ejecutan.
- **Operacionales** (nuevas): ejecutan acciones operativas **autorizadas por política**, consumiendo por **contratos públicos** productos intelectuales + políticas + autorizaciones + evidencia. No son un núcleo intelectual paralelo. Flujo no invertible:

```text
Capacidades intelectuales → Producto intelectual → Política+Autorización → Plan operativo → Capacidades operacionales → Efectos registrados
```

### D-2. Modelo de políticas versionadas como SSOT de la autorización *(Nivel A)*

- Una **Política** (append-only, versionada, con vigencia) define empresa/marca, objetivo, canales, presupuesto total/diario, tolerancias, productos promovibles/restringidos, territorios, afirmaciones permitidas/prohibidas, frecuencia, tono, acciones que requieren aprobación, acciones prohibidas, criterios de detención/ampliación, **nivel de autonomía** y **clase de riesgo** por tipo de acción. Modificar una política **no reescribe** ejecuciones anteriores; una acción histórica conserva la **versión exacta** de la política que la autorizó.

### D-3. Autorización evaluable: permitir/denegar con motivo *(Nivel A — contrato C-6)*

- **Ninguna acción operativa se ejecuta sin una política vigente que la autorice.** El motor de autorización evalúa una acción propuesta contra la política vigente y devuelve **permitida** o **denegada con motivo** (fuera de presupuesto, canal no autorizado, afirmación prohibida, riesgo que exige aprobación, nivel de autonomía insuficiente, política suspendida…). Auditable y reproducible.

### D-4. Niveles de autonomía y clases de riesgo *(Nivel A)*

- **Niveles 0–5** (Observación · Preparación · Aprobación por lote · Ejecución por política · Optimización acotada · Operación continua supervisada), definidos por empresa/canal/campaña/tipo de acción/presupuesto/riesgo. **Sin activación global indiscriminada.**
- **Riesgo bajo/medio/alto**: el alto riesgo exige aprobación explícita o permanece prohibido.

### D-5. Efectos por adaptadores simulados; ningún efecto externo real en este bloque *(Nivel A/C — contrato C-7)*

- Los canales ingresan por **puertos + adaptadores versionados y reemplazables** (no se acopla el núcleo a un proveedor). En F2-AUT-01 **solo** existe un adaptador **simulado/sandbox/dry-run**. Un efecto externo **real** (publicar, gastar, enviar, credenciales) es **causal de parada** hasta autorización explícita.

### D-6. Ejecución idempotente, verificada, reversible y auditada *(Nivel A — contratos C-8/C-9)*

- Toda acción operativa: es **idempotente** (no duplica por reintento/doble ejecución), **verifica el efecto**, registra identificadores externos (aquí simulados), es **reconciliable**, **reversible donde sea posible**, y deja **auditoría completa** (qué · cuándo · empresa · canal · política+versión · evidencia · producto intelectual de origen · presupuesto consumido · efecto · éxito · reversión · revisión). Persistencia event-sourced sobre la Base Técnica; **pausa y revocación**.

## Consecuencias

- La arquitectura reconoce formalmente que SOEC **puede ejecutar acciones operativas autónomas bajo políticas humanas vigentes**, sin sustituir la decisión estratégica.
- Se preservan intactos: propósito raíz, anti-atrofia, interpretabilidad, no-sustitución de la comprensión, y la no-vinculación de todo producto de conocimiento.
- Se habilitan los bloques B–I de la Directiva (núcleo de políticas → modelo operativo → planificador → fábrica de contenido → adaptadores → medición → centro de control → piloto), cada uno vertical y verificable.

## Trazabilidad

Const. 2.1/2.4 v1.7 · Art. 8.2 (Prueba de Propósito) · #9 inv. 9 (v1.7) · #13 inv. 7 (v1.7) · #14 §6 (v1.1) · ADR-0002 (contratos de conformidad) · Directiva Maestra 2026-07-21. Ninguna cláusula revisa el propósito raíz (2.2).
