# ADR-0034 — CIA · Centro de Integraciones Autónomas (preparación cerrada)

Estado: aceptado · Fecha: 2026-08-04 · Rama: `feat/macrobloque-4d`

## Decisión de etapa

Se autoriza construir el **Centro de Integraciones Autónomas (CIA)** en **preparación cerrada**: la
infraestructura neutral para que el Director de Marketing autónomo pueda **actuar sobre el mundo**, sin
habilitar aún proveedores, credenciales, dinero ni efectos reales.

```
CIA: AUTORIZADO_SOLO_EN_PREPARACION_CERRADA
     MODO_REAL_NO_AUTORIZADO
```

La puerta al modo REAL permanece cerrada hasta que existan las **cuatro puertas**: (1) validación externa
suficiente (PVA-1 registro B); (2) Directiva M4-D ratificada; (3) decisiones D-1…D-7; (4) aprobación expresa
del primer piloto real.

## Hallazgo que gobierna el diseño: la infraestructura ya existe

La inspección del repo (discovery-first, antes de escribir código) mostró que la **infraestructura de
integración ya está construida** bajo la familia PCE / M4, realizando el patrón del ADR-003:

| Necesidad de integración | Ya existe en |
|---|---|
| Registro y ciclo de vida gobernado de **capacidades externas** (Capacidad ≠ Activación; nace SIMULADA; kill-switch; degradación; salud fail-safe; `proveedorRef`/`secretRef` opacas; sustitución de proveedor) | `@soec/plataforma-capacidades` (M4-A) |
| Secretos **por referencia** (el dominio nunca ve el valor) | `@soec/secretos` (M4-B) |
| Contrato **neutral** de adaptador + sandbox autoritativo, errores normalizados, salud, presupuesto, egress, minimización, evidencia reproducible; `AUTONOMOUS_REAL` bloqueado | `@soec/adaptadores` (M4-C · M4-C-A-H) |
| Plano de canales **proveedor-independiente**, adaptador **reemplazable**, publicación controlada, modos simulado/sandbox, real desactivado | `@soec/canales`, `@soec/canal-emulado` |

**Conclusión:** CIA **NO** reconstruye infraestructura — eso sería duplicar y violar la mínima complejidad.
CIA aporta la **capa de PRODUCTO** que faltaba sobre la PCE.

## Qué es CIA (capa de producto sobre la PCE) — paquete `@soec/cia`

El principio rector, obligatorio: **el usuario autoriza capacidades, no herramientas; SOEC decide qué
herramienta usar detrás de la frontera; conectar una integración no crea módulos ni cambia la experiencia.**

Ejemplo de la frontera:

> El usuario NO ve «Configurar campaña en Meta Ads».
> El usuario ve «Autorizar a SOEC para **captar clientes con publicidad**, con un límite de $300.000/mes».

Construido y probado en este bloque (todo SIMULADO, event-sourced, multi-tenant, determinista):

- **Catálogo de capacidades de marketing** (`dominio/catalogo`): resultados autorizables, en lenguaje de
  negocio; los proveedores candidatos son **referencias opacas** que nunca se muestran. Test: ningún texto de
  usuario nombra una herramienta comercial.
- **Autorización de capacidad** (`dominio/autorizacion` + `app/autorizaciones-service`): acto humano que
  autoriza un resultado con **límite** y **nivel de autonomía** (alineado con M4-D). Idempotente, aislado por
  organización. Test: la autorización registra un resultado y **jamás** un proveedor; no puede autoautorizarse.
- **Kill-switch** (`dominio/kill-switch` + servicio): por organización y por capacidad; **prevalece** sobre
  autorizaciones y planes, incluso puesto después de planificar. Test: frena el plan y la ejecución.
- **Planificador de acciones externas** (`dominio/plan` + `app/planificador-service`): elige el proveedor
  **detrás de la frontera** (`elegirProveedor`), respeta kill-switch, límite y autonomía, y en preparación
  cerrada sólo ejecuta **simulado** (`assertSimulado`; REAL lanza). Nivel `EJECUTAR_AUTOMATICO` con margen →
  ejecuta al instante; en otro caso → queda pendiente en la bandeja. Revalida la frontera al ejecutar.
- **Bandeja única de autorizaciones**: los planes pendientes se leen como decisiones (una persona), no como
  operaciones.
- **Presupuesto y límites por capacidad**: consumo **simulado** acumulado; exceder el límite no se ejecuta
  solo. Test: excede_limite → pendiente; consumo reduce el disponible.
- **Contratos de lectura capability-framed** (`app/lectura-integraciones-service`) para **HOME · Decisiones ·
  Por qué**, con **garantía dura de no fuga de proveedor** (`verificarSinFugaDeProveedor`). La `auditoria()`
  —y sólo ella— nombra el proveedor, para rendición de cuentas.
- **Evidencia y auditoría**: cada ejecución simulada deja evidencia reproducible ligada al plan.
- **Guardarraíles** (`dominio/guardarrailes`): `AUTONOMOUS_REAL = false`; `assertSimulado`; frontera de
  neutralidad. Test: planificar en REAL lanza `ModoRealBloqueadoError`.

### Invariantes probados (16 tests, `packages/cia/test/cia.test.ts`)
1. Catálogo neutral (ningún nombre comercial en texto de usuario).
2. El usuario autoriza capacidades, no herramientas (la autorización nunca contiene un proveedor).
3. Autorizar exige acto humano; rechaza capacidades fuera del catálogo; idempotente y multi-tenant.
4. **No fuga de proveedor** en HOME/Por qué; la auditoría sí lo expone.
5. **Sustituir el proveedor no cambia la experiencia** (vista de usuario idéntica; auditoría distinta).
6. Kill-switch prevalece (antes y después de planificar).
7. El límite frena de verdad (excede → pendiente; consumo acumula).
8. El nivel de autonomía decide aprobación vs. automático.
9. Modo REAL bloqueado (AUTONOMOUS_REAL=false; REAL lanza).
10. Reconstrucción por eventos (cold replay).

## Mapa de los 17 puntos del encargo

| Punto | Estado |
|---|---|
| Catálogo de capacidades externas | **CIA** (marketing) + `plataforma-capacidades` (gobernanza) |
| Contratos comunes de conectores | **Ya existe**: `@soec/adaptadores` (puerto neutral) |
| Registro event-sourced de integraciones | **CIA** (autorizaciones/planes) + `plataforma-capacidades` |
| Estados de conexión y salud | **Ya existe**: `EstadoCapacidad`/`SaludCapacidad` (M4-A) |
| Permisos y niveles de autonomía | **CIA** (nivel por capacidad) reusando `@soec/autonomia` (M4-D) |
| Onboarding de integraciones sin credenciales reales | **CIA** (autorizar capacidad) + secretos por referencia (M4-B) |
| Simuladores (Meta/Google/Analytics/CRM/email/sitio) | **CIA** (proveedores opacos simulados) — nombres comerciales NO se modelan en producto |
| Planificador de acciones externas | **CIA** (`planificador-service`) |
| Bandeja única de autorizaciones | **CIA** (planes pendientes como decisiones) |
| Presupuesto y límites por integración | **CIA** (límite/consumo) + `adaptadores/m4d/presupuesto` |
| Evidencias, auditoría y rendición | **CIA** (evidencia por plan) + `adaptadores/domain/evidencia` |
| Kill-switch global/org/capacidad | **CIA** (org/capacidad) + modo global (`AUTONOMOUS_REAL`) |
| Contratos de lectura HOME/Decisiones/Explicaciones | **CIA** (`lectura-integraciones-service`) |
| Pruebas de sustitución de proveedor | **CIA** (test) + `reemplazar` (M4-A) |
| Pruebas de que conectar no crea módulos ni cambia UX | **CIA** (no-fuga + sustitución sin cambio de vista) |
| Smoke tests exclusivamente simulados | **CIA** (16 tests, sin red) + `adaptadores/canales` |
| Fuera de toda red real | **Garantizado**: sin dependencias de red; `assertSimulado`; AUTONOMOUS_REAL=false |

## Prohibiciones (vigentes)

```
NO SDK comercial · NO API externa · NO OAuth real · NO credenciales · NO secretos productivos
NO gasto · NO publicación · NO envío · NO métricas reales · NO AUTONOMOUS_REAL
```

## Honestidad de alcance (registro A vs. B, ADR-002)

**A · Verificable (cerrado en este bloque):** el paquete `@soec/cia` existe, compila (tsc), pasa lint y sus 16
invariantes de producto; el gate global queda verde (203 archivos / 1395 tests). Los invariantes clave
—capacidad-no-herramienta, no-fuga-de-proveedor, sustitución-sin-cambio-de-UX, kill-switch, límite, modo REAL
bloqueado— están demostrados por test.

**B · No hecho en este bloque (deliberado, próximas sub-fases):**
- **Composición con la PCE real**: hoy los proveedores del planificador son *stand-ins* simulados en `@soec/cia`.
  El cableado que hace que un `proveedorRef` resuelva a un adaptador de `@soec/adaptadores`/`@soec/canales` tras
  una capacidad `@soec/plataforma-capacidades` es la siguiente sub-fase de ingeniería (sigue todo simulado).
- **Wiring en `apps/web`**: la experiencia de autorizar capacidades y la bandeja no están aún en la UI; los
  contratos de lectura existen y están listos para consumirse como HOME/Decisiones/Por qué (sin crear módulos).
- **Modo REAL**: fuera de alcance por definición; espera las cuatro puertas.

## Orden hacia el modo REAL (referencia)

1. CIA neutral y simulado (**este bloque**) + validación externa de PVA-1 (paralela).
2. Correcciones de experiencia observadas.
3. Ratificación de M4-D y D-1…D-7.
4. Selección de **una sola** capacidad para piloto.
5. Primer adaptador real, **desactivado por defecto**.
6. Sandbox real opt-in.
7. Piloto limitado.
8. Rendición de cuentas.
9. Escalamiento gradual de autonomía.

## Adenda — CIA en preparación cerrada COMPLETA (bloques 1–11)

Tras el registro inicial (frontera de producto + invariantes), se agotó el macrobloque CIA en preparación
cerrada, en ejecución continua. Todo SIMULADO; `AUTONOMOUS_REAL` bloqueado.

- **B1 · Composición CIA↔PCE/M4**: la ejecución simulada rutea por el `OrquestadorAdaptadores` REAL (sandbox
  autoritativo, breaker, salud, evidencia) con la PCE como autoridad de consumibilidad (`esConsumible`) y de
  degradación (5 políticas → lenguaje de producto). Los proveedores son adaptadores fake canónicos detrás de
  la frontera. Se eliminó el motor de proveedores paralelo.
- **B2 · Ciclo de vida de la autorización**: FSM event-sourced BORRADOR→PENDIENTE→AUTORIZADA⇄PAUSADA +
  REVOCADA/EXPIRADA/REEMPLAZADA/ELIMINADA; una modificación MATERIAL invalida la aprobación anterior.
- **B3 · Ciclo de vida del plan**: PROPUESTO→PENDIENTE_APROBACION→AUTORIZADO→PROGRAMADO→EN_EJECUCION→
  COMPLETADO_SIMULADO + ABSTENIDO/FALLIDO/CANCELADO/OBSOLETO. Idempotencia por `claveLogica`+huella
  (converge / conflicto); cancelación/obsolescencia descartan respuestas tardías.
- **B4 · Presupuesto**: reserva event-sourced (RESERVADA→CONFIRMADA|LIBERADA|EXPIRADA|CANCELADA);
  `disponible = límite − confirmado − reservado_pendiente`; ciclo estimar→validar→reservar→ejecutar→
  confirmar|liberar; concurrencia e idempotencia.
- **B5 · Autonomía ejecutable**: los 4 niveles gobiernan; riesgo alto reservado al humano aun en automático;
  subir la autonomía no elude kill-switch/presupuesto.
- **B7 · Persistencia PostgreSQL + API**: `PgEventStore` real; `apps/api/src/cia-routes.ts`
  (`registerCiaRoutes`) sobre `deps.store`. Probado: crear→reiniciar→replay desde PostgreSQL (servicios y
  HTTP vía Fastify inject); multi-tenant; kill/consumo/sustitución persistidos.
- **B6 · Web**: `apps/web/lib/cia-client.ts`/`cia-types.ts` (consume `/api/cia/*`) + `CapacidadesCIA` en
  Autonomía. Capability-framed; degrada con gracia; nunca muestra proveedores.
- **B8 · Contrato de producto**: `LecturaCIAProducto` — instantánea única, congelada en profundidad, sin
  fuga; auditoría técnica separada.
- **B10 · Reconciliación**: matriz de clases con REPARADA/NO_REQUIERE_ACCION/NO_REPARABLE/
  REQUIERE_INTERVENCION; repara reservas huérfanas; dos reconciliadores convergen.
- **B9 · Matriz adversarial**: 40 escenarios; el de comprensión humana marcado NO_EVALUABLE_POR_CODIGO /
  PENDIENTE_VALIDACION_EXTERNA (no aprobado).
- **B11 · Validación**: `pnpm verify` verde (214 archivos / 1453 tests + 1 skip); `apps/web` typecheck +
  build verdes; PostgreSQL healthy; replay tras reinicio; scans de secreto/proveedor/red en cero;
  `AUTONOMOUS_REAL=false`. Árbol limpio salvo drafts de gobernanza.

**Deuda reservada EXCLUSIVAMENTE a modo REAL y validación externa** (las 4 puertas): SDK/API/OAuth/
credenciales reales, gasto/publicación/envío reales, métricas reales, y la validación de comprensión con
usuarios ajenos (PVA-1 registro B). Nada de eso se toca en preparación cerrada.
