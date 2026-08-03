# ADR-0027 — Andamiaje neutral de M4-D (independiente de D-1..D-7)

- **Estado:** Aceptado.
- **Fecha:** 2026-08-03.
- **Rama:** `feat/macrobloque-4d` (desde `main` = `ae30427`).
- **Relación:** prepara M4-D bajo el borrador de Directiva Maestra de M4-D v0.2 (aún NO ratificada), construyendo **sólo** infraestructura NEUTRAL que permanece válida cualquiera sea la resolución de las decisiones irreversibles D-1..D-7 (proveedor, datos salientes, presupuesto, secretos, piloto, contrato de datos, residencia).

## Contexto

Una Directiva bloquea únicamente el trabajo que depende de decisiones no ratificadas, no todo el trabajo relacionado. Aplicando el criterio "¿seguiría siendo válido si mañana cambia D-1..D-7?", existe infraestructura provider-agnóstica que puede construirse hoy para que, tras la ratificación, el trabajo restante sea mínimo (cambiar configuración / agregar un adaptador). **Nada de esto conecta proveedores, SDK, red, credenciales, datos reales ni costos, ni resuelve ninguna decisión estratégica.**

## Decisión

En `@soec/adaptadores/src/m4d/` (neutral, determinista, sin red/SDK/reloj/azar; verificado por el test de neutralidad):

- **Sellado de instancia — cierre de F-CCC-1** (`sellado.ts`): `sellarAdaptador(ad)` captura una sola vez identidad y métodos enlazados y devuelve un adaptador **congelado**; un monkey-patch posterior de la instancia original **no** altera el comportamiento autorizado. **Cableado en el orquestador**: la instancia se sella al entrar y el resto del flujo usa la copia sellada. Cierra la deuda F-CCC-1 con código + tests adversariales.
- **Política de salida de datos / egress** (`egress.ts`): `validarEgress(esquema, entrada)` — lista blanca **CERRADA y TIPADA por operación** con **default-deny**: sólo salen los campos declarados (transformados); lo no declarado (documentos completos, datos de otro tenant, etc.) se descarta; tipo inválido → rechazo. El esquema concreto por capacidad es D-2 (dato inyectado), no se decide aquí.
- **Minimización** (`minimizacion.ts`): transformaciones deterministas `IDENTIDAD/REDACTAR/TRUNCAR/SEUDONIMIZAR/OMITIR`. `SEUDONIMIZAR` es un seudónimo estable por clave inyectada (NO anonimización irreversible ni firma criptográfica — honestidad); sin clave → fail-closed (se omite). La política campo→transformación es D-7 (inyectada).
- **Presupuesto / topes** (`presupuesto.ts`): `evaluarPresupuesto` decide **ANTES de la llamada**; `estimarConservador` usa cota superior ante costo desconocido y, sin cota, marca `DESCONOCIDA` → rechazo (fail-safe a no-gasto). Los montos son D-3 (inyectados); aquí no hay ningún valor concreto.
- **Harness de no-filtración** (`auditoria-no-filtracion.ts`): `auditarNoFiltracion(sentinela, superficies)` reutilizable por los tests de cualquier adaptador para demostrar que un valor sensible no aparece en resultado/evidencia/logs/serialización/errores.
- **Ledger de consumo** (`consumo.ts`): `RegistroConsumo` acumula unidades lógicas por org+capacidad en una ventana (instantes inyectados, `Date.parse` puro), multi-tenant. Alimenta al presupuesto. En memoria (no distribuido: deuda posterior).
- **Niveles de activación** (`activacion.ts`): máquina `SIMULADO→SANDBOX→PILOTO→REAL` (un paso adelante; retroceso a SIMULADO siempre = kill-switch); `nivelPermiteReal`/`nivelPermiteModo`. El alcance del PILOTO es D-5 (inyectado); la máquina es neutral. **Cableada** en el orquestador como gate inyectado (`OpcionesOrquestacion.nivelActivacion`, opcional, patrón del presupuesto): REAL con nivel SIMULADO/SANDBOX → rechazo `ACTIVACION`; PILOTO/REAL lo permiten; ausente → sin gate (fundación). No cambia el esquema event-sourced fusionado (el nivel se inyecta).
- **Gate de presupuesto en el orquestador** (integración): `OpcionesOrquestacion.presupuesto` (opcional); sólo aplica a REAL y se evalúa ANTES de ejecutar (gate `PRESUPUESTO`→`LIMITE`). Los montos son D-3 (inyectados). En SIMULADO no aplica (sin costo).
- **Template de adaptador real** (`adaptador-real-base.ts`): `AdaptadorRealBase` (abstracta) compone egress (default-deny + minimización) + resolución del secreto por referencia vía `SecretStore` de M4-B (el valor sólo vive dentro de `usar(fn)`) + normalización de errores/cancelación; la **única** parte específica del proveedor es el método abstracto `invocar` (D-1). `AdaptadorRealFake` (sintético, `soportaReal=false`, sin red/SDK/secreto real) demuestra el template de punta a punta y prueba la no-filtración del secreto. **Esto reduce D-1 a implementar una sola función.** (De paso, `@soec/adaptadores` pasa a USAR realmente su dependencia `@soec/secretos` → cierra la observación PR-1.)

## Consecuencias

- (+) F-CCC-1 queda **cerrado y verificado** (deja de ser deuda pre-SDK).
- (+) Los mecanismos de egress/minimización/presupuesto/no-filtración existen y están probados; tras ratificar la directiva, sólo restará inyectar la configuración concreta (D-2/D-3/D-7) y agregar el adaptador real (D-1), cada uno con su ADR.
- (−) Son mecanismos sin política concreta: no hacen nada "real" hasta que las decisiones D-x se ratifiquen y se inyecten. Ninguna compone todavía el flujo del orquestador salvo el sellado (F-CCC-1); la integración de egress/presupuesto en la ejecución se define al ratificar la directiva.

## Alcance respetado

No resuelve D-1..D-7. No conecta proveedores, SDK, red, credenciales, datos reales ni costos. `AUTONOMOUS_REAL` permanece bloqueado; `verify` no hace llamadas reales; el smoke real sigue bloqueado.
