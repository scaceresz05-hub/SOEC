# DIRECTIVA MAESTRA — PLATAFORMA DE CAPACIDADES EXTERNAS (PCE)

## Constitución tecnológica de las capacidades externas de SOEC · M4 = primera aplicación

> **Versión:** v2.1 (BORRADOR para ratificación). **Estado:** no gobierna hasta ser aprobado por la Dirección Técnica.
> **Autoridad:** subordinada a la Constitución de SOEC y a la Directiva Maestra (el humano dirige, SOEC ejecuta bajo política). Fuente declarante única (Art. 7.5). Aprobado, el **Título I** es autoridad **permanente** sobre TODA capacidad externa (IA, correo, pagos, canales, CRM, almacenamiento, mensajería…); el **Título II** aplica la constitución a M4 y es **revisable por bloque**.
> **Precondición:** `main = a210b04` (M1+M2+M3 integrados; tag `macrobloque-3`). Rama `feat/macrobloque-4` congelada hasta aprobar este documento.

> ### ⭐ Principio rector
> **El dominio conoce Capacidades, no Proveedores.** (Todo lo demás deriva de aquí.)

---

## Jerarquía normativa

```
Constitución del proyecto (SOEC)
        ↓
Directiva Maestra PCE  (este documento)
        ↓
ADR
        ↓
Arquitectura
        ↓
Implementación
        ↓
Pruebas
```

**Ningún ADR, arquitectura, implementación, prueba o decisión técnica podrá contradecir esta Directiva Maestra.** Si aparece una contradicción, **prevalece esta Directiva** y el cambio deberá formalizarse mediante una **nueva versión** de la misma (Título III — Enmienda). Esta Directiva es, a su vez, subordinada a la Constitución de SOEC.

---

## Nombre y encuadre

Lo que M4 empieza a construir no es un "centro de integraciones" para IA: es la **Plataforma de Capacidades Externas (PCE)** — la infraestructura por la que SOEC usará cualquier proveedor externo (generación, correo, pagos, publicidad, mensajería, CRM, almacenamiento). M4 instancia la PCE y su **primera capacidad**: **generación de contenido supervisada**. El Título I gobierna la PCE entera; no habla de proveedores concretos.

---

# TÍTULO I — CONSTITUCIÓN DE CAPACIDADES EXTERNAS (permanente)

> Estos artículos gobiernan **toda** capacidad externa presente y futura. Ningún bloque (M4, M5, M6…) puede violarlos; sólo aplicarlos.

### Art. 1 — Constitución de Integraciones (toda integración es un adaptador, no una dependencia)
Toda capacidad externa debe poder, **sin modificar el dominio**: `ser habilitada · ser deshabilitada · ser pausada · ser auditada · ser simulada · ser reemplazada · ser eliminada`. Una capacidad que no pueda simularse o reemplazarse sin tocar el dominio **no es un adaptador** y no se admite.

### Art. 2 — Separación absoluta entre dominio y proveedores (y costo)
**Toda dependencia externa termina en un adaptador; nunca en el dominio.** El dominio **solicita una Capacidad**; nunca conoce el **proveedor** (p. ej. un modelo/servicio concreto) **ni el costo** (p. ej. una tarifa). El proveedor y el costo **pertenecen a la Plataforma**, no al dominio. El SDK/protocolo de un proveedor vive **sólo** en su adaptador-frontera, verificado por test de arquitectura; su fuga —o la del costo/proveedor— al dominio es una violación.

### Art. 3 — Capacidad ≠ Activación (ciclo de vida explícito)
Que un adaptador **exista** no significa que pueda usarse. Estados gobernados: `DISPONIBLE → REGISTRADA → CONFIGURADA → HABILITADA → AUTORIZADA → EN_USO`, con transiciones transversales `PAUSADA · DESHABILITADA · REEMPLAZADA · ELIMINADA · SIMULADA`. Cada avance es un **acto humano/gobernado y auditado**; estar en un estado anterior **no** habilita el uso. Por defecto, toda capacidad nace `SIMULADA` hasta que un humano la lleve, paso a paso, a `EN_USO`.

### Art. 4 — Secretos por capacidad (el dominio nunca lee un secreto)
**Ningún componente del dominio podrá leer un secreto. Sólo podrá solicitar una capacidad. El adaptador resolverá la referencia.** El Event Store, los logs y las respuestas de API guardan como mucho una **referencia** (`secretRef`), nunca el valor. La rotación ocurre fuera del dominio. El agente (Claude) **nunca** ingresa, lee ni transporta secretos reales; el aprovisionamiento es del propietario.

### Art. 5 — Gobernanza económica (el costo es multidimensional y limita, no advierte)
El costo no es sólo dinero. Toda capacidad con costo declara y respeta límites en las dimensiones que le apliquen —`dinero · tokens · RPM · TPM`— y en los ámbitos —`por organización · por usuario · por flujo · por campaña`— y ventanas —`por solicitud · diario · mensual`—. **Costeo previo obligatorio**: si la estimación o el acumulado supera un tope, la operación **se abstiene** (no se llama al proveedor); no es una advertencia. El costo real medido se rotula REAL; el estimado, ESTIMADO. (Coherente con Art. 2: el dominio no ve el costo; lo gobierna la Plataforma.)

### Art. 6 — Observabilidad constitucional (toda capacidad rinde cuentas)
Toda ejecución de una capacidad debe poder responder, desde la traza event-sourced: `¿qué hizo? · ¿cuándo? · ¿por qué? · ¿con qué proveedor? · ¿cuánto costó? · ¿qué devolvió? · ¿qué versión? · ¿qué política? · ¿quién aprobó? · ¿qué organización? · ¿qué solicitud/prompt? · ¿qué respuesta? · ¿qué modelo?`. Observabilidad no es sólo medir: es **poder responder**. Una capacidad que no pueda responder este cuestionario no está lista para `EN_USO`.

### Art. 7 — Constitución del Cambio (todo comportamiento es versionado)
`toda política · todo adaptador · todo proveedor · todo prompt · todo modelo · todo parser · todo validador` **es versionado**. Un cambio de comportamiento sin cambio de versión es una violación. La traza (Art. 6) registra qué versión de cada uno produjo cada resultado, de modo que un resultado pasado sea siempre explicable con la configuración que lo generó.

### Art. 8 — Soberanía humana y modo seguro
`AUTONOMOUS_REAL` permanece bloqueado por dominio. **Intención ≠ estado** (Art. 3). Existe un **kill-switch** que devuelve toda capacidad real a `SIMULADA`/`PAUSADA` al instante. La activación de una capacidad real y el aprovisionamiento de sus credenciales son **actos del propietario**, no del agente. Ninguna capacidad produce efectos externos irreversibles (publicar, enviar, cobrar, gastar) sin autorización humana explícita para ese acto concreto.

### Art. 9 — Honestidad de capacidades y del dato
Toda salida conserva su naturaleza `REAL / SIMULADO / ESTIMADO / DESCONOCIDO`. Una capacidad declara lo que realmente puede y no puede hacer. Nada "simulado" se presenta como "real"; nada "conectado" se presenta como "habilitado".

### Art. 10 — Multi-tenant y trazabilidad
Toda capacidad, credencial, cuota, costo, política, versión y artefacto está **aislado por organización** y es **auditable por event-sourcing**. No hay lectura ni efecto cross-tenant.

### Art. 11 — Degradación gobernada (comportamiento ante indisponibilidad)
Toda capacidad debe **declarar explícitamente** su comportamiento cuando no está disponible o falla. La política de degradación se elige de un conjunto cerrado y **nunca queda implícita**: `abstenerse · usar simulación · usar capacidad/proveedor alternativo · usar caché · detener el flujo`. La degradación efectiva queda en la traza (Art. 6). Ninguna capacidad falla "en silencio" ni "a medias".

### Art. 12 — Determinismo (auditable y reproducible)
Toda capacidad debe **poder ejecutarse de forma determinista** para auditoría y pruebas, sin depender de efectos externos no reproducibles. El comportamiento verificable del sistema no puede requerir llamadas reales; la ejecución real es una configuración, no un requisito del gate.

### Art. 13 — Salud de capacidades (observable ≠ confiable)
Una capacidad puede estar **disponible** y aun así **responder mal**. La PCE debe poder marcar el estado de salud de cada capacidad —`SALUDABLE · DEGRADADA · NO_CONFIABLE`— y ese estado **gobierna automáticamente** la selección y el fallback (Art. 11). Disponibilidad no implica confiabilidad.

### Art. 14 — Constitución de Compatibilidad
**Ningún cambio de proveedor podrá modificar el dominio.** **Ninguna capacidad nueva podrá exigir cambios incompatibles en las capacidades existentes.** Nuevas versiones de un proveedor se absorben en su adaptador-frontera; el contrato (puerto) que ve el dominio permanece estable o evoluciona sólo por versión gobernada (Art. 7).

---

# TÍTULO II — APLICACIÓN EN M4 (revisable por bloque)

### II.1 — Visión de M4
Instanciar la PCE (Título I) y su **primera capacidad**: **generación de contenido con IA real, supervisada**. M4 cruza **una** frontera real —**generar**, no publicar/gastar/enviar—: solicitud gobernada → capacidad generativa real (detrás del puerto neutral `ProveedorGenerativo` ya existente en `@soec/contenido`) → validación semántica (A-3) → **borrador** versionado con **costo real medido** → **revisión y aprobación humana** → traza.

### II.2 — Alcance
**Dentro:** núcleo de la PCE (registro de capacidades, ciclo de vida Art. 3, salud Art. 13, versionado Art. 7) · secretos por capacidad (Art. 4) · adaptador(es) de capacidad generativa real detrás del puerto, `SIMULADA` por defecto · degradación/selección/fallback (Arts. 11, 13) · motor generativo supervisado · gobernanza económica (Art. 5) · observabilidad (Art. 6) · determinismo del gate (Art. 12) · sandbox/pruebas de conexión.
**Fuera (→ M5+):** publicar en canales, correo/WhatsApp, gasto publicitario, respuesta automática, `AUTONOMOUS_REAL`.

### II.3 — Flujo obligatorio de M4
```
Solicitud generativa gobernada (política A-3: afirmaciones/restricciones/integraciones/cifras permitidas)
→ ¿capacidad generativa EN_USO (Art. 3) y SALUDABLE (Art. 13) para esta org? ¿con presupuesto? (Art. 5)
   · no → degradación declarada (Art. 11): simulación / alternativa / abstención
→ costeo previo (Art. 5) → excede tope → ABSTENCIÓN gobernada (no se llama)
→ llamada real detrás del puerto (adaptador-frontera, credencial por referencia Art. 4)
→ validación estructural + SEMÁNTICA (A-3): inválido → no borrador aprobable; veredicto+categorías persistidos; reintento
→ Borrador versionado (naturaleza BORRADOR_IA_REAL; costo REAL; proveedor/modelo/tokens/versiones en traza Art. 6/7)
→ Revisión humana → Aprobación (gate canónico de M3, por recurso+versión)
→ Almacenamiento + trazabilidad (Art. 6, 10)
⛔ Fin de M4. NO publica · NO gasta · NO envía.
```

### II.4 — Decisiones de aplicación a ratificar
- **DA-1 — Estructura de la frontera de adaptadores (aplica Arts. 2, 14).** A) un paquete-frontera por proveedor · B) uno con subcarpetas · C) excepción de lint. **Recomiendo A** con **contrato común** factorizado; el test de arquitectura pasa de "SDK prohibido en todo el repo" a **"permitido sólo en la frontera declarada, verificado"** (fortalece la neutralidad).
- **DA-2 — Backend del SecretStore (aplica Art. 4).** A) por referencia (env en dev; puerto listo para Vault/KMS en prod) · B) tabla cifrada + KMS (SOEC custodia el valor) · C) sólo env por proceso. **Recomiendo A.**
- **DA-3 — Evidencia reproducible del gate (aplica Art. 12).** El comportamiento verificable no depende de llamadas reales. La reproducibilidad se logra por **evidencia reproducible** —el mecanismo es libre y no lo fija la constitución: `snapshots · simuladores · respuestas sintéticas · datasets · replay · grabaciones`—. **Recomiendo:** default determinista para todo el gate; adaptador real probado por contrato + evidencia reproducible; **ninguna llamada real en `pnpm verify`**; smoke real opt-in por flag.

*(Activación, costo y modo seguro NO son decisiones de M4: son constitucionales — Arts. 3, 5, 8.)*

### II.5 — Tramos de M4 (riesgo creciente; cada uno cierra con ADR + gates + commit)
**M4-A** Núcleo de la PCE (registro, ciclo de vida Art. 3, salud Art. 13, versionado Art. 7; neutral, sin SDKs) · **M4-B** Secretos por capacidad (Art. 4) · **M4-C** Adaptador(es) generativo(s) real(es) detrás del puerto (Art. 2), `SIMULADA` por defecto, con evidencia reproducible (DA-3) · **M4-D** Motor generativo supervisado (costeo Art. 5 → llamada → A-3 → borrador versionado → revisión → aprobación → traza; degradación/selección/fallback Arts. 11/13) · **M4-E** Observabilidad (Art. 6) + sandbox/pruebas de conexión. Referencia: SmileFlow con **borradores reales supervisados, sin publicación**.

### II.6 — Criterios de aceptación de M4
Sin capacidad `EN_USO` ⇒ idéntico a M3 (cero regresión) · con `EN_USO` ⇒ borrador real/medido/validado por A-3/aprobable, **nunca** publica/gasta/envía · ningún secreto en código/eventos/logs/API · dominio sin conocimiento de proveedor ni costo (Art. 2, verificado) · `AUTONOMOUS_REAL` rechazado + kill-switch a SIMULADA · tope de costo ⇒ abstención · degradación declarada y verificada (Art. 11) · salud gobierna fallback (Art. 13) · multi-tenant aislado (adversarial) · `pnpm verify` verde **sin llamadas reales** (Art. 12) + build web · neutralidad verificada por test · toda ejecución responde el cuestionario del Art. 6 desde PostgreSQL frío.

### II.7 — Deudas aceptadas de M4
Validador semántico heurístico (refuerzo con el propio proveedor = continuación) · cuotas/costos multi-instancia (Redis) diferidos · scoring de calidad del borrador más allá de A-3, posterior · deuda heredada de M3 (convergencia de calendarios, unificación aprobación↔estado-local).

---

# TÍTULO III — GOBERNANZA

- **Enmienda:** esta Directiva sólo puede modificarla la **Dirección Técnica**, con **versión** y **changelog explícitos**; todo cambio de arquitectura que la afecte pasa por un **ADR**.
- **Un ADR por artículo del Título I que se implemente** y por cada DA ratificada.
- **Tramos con checkpoint**: gates verdes (`verify` + `build`), commit temático, sin avanzar sin verificación.
- **No push / PR / merge** sin autorización humana explícita (igual que M1–M3).
- **Detenerse y elevar** ante cualquier decisión de arquitectura no prevista por el Título I.
- **Honestidad** de dictámenes; naturaleza del dato siempre visible; la activación real y las credenciales las hace el propietario.

---

## Changelog

- **v1** — Guía de M4 (Centro de Integraciones + IA supervisada).
- **v2** — Reestructura a constitución tecnológica: Título I permanente + Título II (aplicación M4); nombre PCE; Capacidad≠Activación; Constitución del Cambio; Observabilidad "poder responder"; SecretStore por referencia.
- **v2.1** — Añade Arts. 11 (degradación), 12 (determinismo), 13 (salud; observable≠confiable), 14 (compatibilidad); Art. 2 refuerza "el dominio no conoce proveedor ni costo"; principio rector destacado; DA-3 pasa de "grabaciones" a "evidencia reproducible"; regla de enmienda (Dirección Técnica + versión + changelog + ADR).
- **v2.1 (ratificada)** — Añade la sección **Jerarquía normativa** con la cláusula de prevalencia. **RATIFICADA por la Dirección Técnica como autoridad arquitectónica permanente de la PCE** (adopción formal en ADR-0020).

---

## Qué se ratifica

Al aprobar: (1) el **nombre** (PCE) y el **principio rector**; (2) el **Título I** como constitución permanente (Arts. 1–14); (3) la **aplicación en M4** (Título II) y las decisiones **DA-1/DA-2/DA-3**; (4) la **regla de enmienda** (Título III). Sólo entonces se persiste (p. ej. `docs/governance/DIRECTIVA-MAESTRA-PCE.md`) y se descongela `feat/macrobloque-4` para iniciar M4-A.

---
*Borrador v2.1 para ratificación. No gobierna hasta ser aprobado. No se persiste en el repo ni se descongela la rama hasta la aprobación de la Dirección Técnica.*
