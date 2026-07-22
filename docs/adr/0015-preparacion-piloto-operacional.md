# ADR-0015 — Preparación del Piloto Operacional Controlado (F2-PILOT-01)

- **Estado:** ✅ **ACEPTADO.** Séptima vertical: lleva SOEC de «sistema completo probado con fixtures» a «listo para recibir una configuración piloto real, verificar que es segura y solicitar una única autorización final antes de activarla». Continúa ADR-0009…0014.
- **Fecha:** 2026-07-21 · **Bloque:** F2-PILOT-01.

## Contexto

Con el Centro de Control cerrado, faltaba **preparar la operación real** sin activarla. Este ADR fija la vertical genérica `@soec/piloto`: registrar una organización, conducir su onboarding, configurar perfil/entornos/conexiones/políticas/presupuesto/límites/pausa, evaluar **readiness**, ensayar el ciclo en entorno no productivo, verificar el **rollback**, producir un **expediente de activación** y **detenerse antes del primer efecto real**. Los conceptos pertenecen a organización/operación, **no a marketing**.

## Decisiones

### D-1. Vertical genérica de preparación; no pertenece a marketing *(Nivel A — §2, §3)*

`@soec/piloto` importa solo `@soec/contracts`, `@soec/event-store` y `@soec/control` (roles): **no importa** marketing/contenido/canales/medición (prueba arquitectónica). Marketing es el primer `departamentoPiloto`, pero el contrato no se cierra a él. **No** se introduce el puerto universal «Módulo de operación» (se difiere hasta un segundo departamento real).

### D-2. El modo real es INALCANZABLE en este bloque *(Nivel A — §8, §24)*

Entornos modelados: sintético · emulado · sandbox · real_desactivado · real_preparado · **real_habilitado**. `real_habilitado` está **contemplado por la arquitectura pero es imposible de alcanzar**: `realHabilitable()` retorna siempre `false`; solo sintético/emulado/sandbox son operables. Ninguna organización llega a `activa` en modo real; como máximo `lista_para_activación`.

### D-3. Onboarding versionado y reanudable; no se inventan datos *(Nivel A — §6)*

El agregado `org:<id>` conduce el onboarding por etapas (identidad…revisión), cada una con estado/datos/faltantes/responsable. Se distingue dato **real / sintético / pendiente / no aplicable**; la ausencia queda visible y **no se inventa**. Perfil operacional, presupuesto y conexiones previstas se declaran sobre el mismo agregado.

### D-4. Readiness DETERMINISTA por entorno; la ausencia no es fracaso *(Nivel A — §12–§14)*

El motor de readiness evalúa la preparación **por entorno** y produce chequeos estructurados (código/estado/severidad/faltante/bloqueo). Distingue **pendiente** de **bloqueado**. Los requisitos difieren por entorno: una **credencial fixture** verificada en sandbox **no basta** para un entorno real; una especificación visual basta para un ensayo emulado pero no para un canal visual real. El resultado nunca aprueba la **activación real** (`activacionRealPermitida: false` siempre): cuando todo lo sintético está completo concluye «apto para activación, pero activación real pendiente de decisión estratégica».

### D-5. Presupuesto de piloto con gasto real en cero *(Nivel A — §11)*

El presupuesto separa producción/distribución/publicidad/integración/contingencia con límites; `ejecutadoReal` es del tipo literal `0` (garantizado por tipo). El gasto sintético/emulado se distingue inequívocamente; ninguna cifra sintética se interpreta como dinero gastado.

### D-6. Ensayo integral, rollback y expediente versionado *(Nivel A — §15–§20)*

El **ensayo** recorre onboarding → readiness → política → plan → contenido → publicación EMULADA → métricas → optimización → pausa → **rollback** → reanudación → informe; cada ejecución es un ensayo distinto, idempotente por identidad. Escenarios A–H (exitoso, onboarding incompleto, credencial pendiente, activo faltante, presupuesto inválido, suspensión, rollback, repetición). El **expediente** (`exp:<id>`) versiona alcance, criterios de éxito/suspensión, plan de rollback, readiness y checklist; **nunca** alcanza `autorizado` para un entorno real.

### D-7. La ceremonia de activación permanece BLOQUEADA *(Nivel A — §24, §37)*

`intentarActivacion` **siempre** deniega, registra el intento y devuelve las autorizaciones estratégicas faltantes (modo real desactivado, autorización del propietario, credenciales reales verificadas, token de un solo uso, ventana). La API responde `409`. No existe endpoint capaz de activar producción real, gastar, usar credenciales reales, generar un token productivo ni saltar la autorización.

## Consecuencias

- SOEC puede **demostrar que una organización está preparada —o explicar exactamente por qué no— antes de permitir cualquier efecto real**. La plataforma queda lista para una activación que será una decisión explícita, pequeña, reversible y auditable.
- Se preservan intactos: propósito raíz, soberanía transformada, no-vinculación del conocimiento, y los guardarraíles de ningún efecto/gasto/credencial real y modo real desactivado.
- El siguiente paso ya **no es otro componente sintético**, sino la **decisión estratégica** de un piloto real (empresa/marca/objetivo/canal/cuenta/contenido/presupuesto/modo/nivel/aprobación/pausa/duración/indicadores/criterios de éxito y suspensión). Hasta esa autorización, todo efecto externo real continúa prohibido.

## Complemento — F2-PILOT-DEC-01: decisión del primer piloto real (SmileFlow Clinic) (2026-07-21)

La Autoridad Estratégica (propietario) **aprobó** el primer piloto real recomendado: **SmileFlow Clinic**, departamento marketing, canal **LinkedIn orgánico**, nivel de autonomía **2** (preparación autónoma con **aprobación por publicación**), **sin gasto publicitario ($0)**, **14 días**, con prohibiciones duras (datos de pacientes, promesas clínicas, comparaciones no demostrables). La aprobación autoriza **solo PREPARAR** el expediente en modo `real_preparado`; **no** autoriza publicar, gastar ni conectar cuentas.

- **D-8. La decisión se registra como expediente en `real_preparado`, con la publicación bloqueada.** `@soec/piloto` persiste la configuración aprobada (organización `smileflow-clinic`, perfil, presupuesto con `ejecutadoReal: 0`, conexión LinkedIn declarada **sin credencial** → `pendiente_credencial`). La **readiness real** resulta **BLOQUEADA** (falta credencial real verificada y cuenta real). La ceremonia de activación devuelve, como en todo el bloque, una **denegación** con lo que falta.
- **Frontera declarada (Claude no lo hace):** conectar la cuenta real de LinkedIn, introducir/verificar credenciales reales y publicar contenido público son **acciones del propietario**; SOEC no las ejecuta. La primera publicación pública real requiere una **autorización de publicación explícita posterior** más credenciales verificadas por el propietario y un token de activación de un solo uso.
- **Lo que el propietario debe aún proveer/autorizar** (registrado en el expediente): identidad legal de SmileFlow (nombre legal, país/moneda si difieren), cuenta empresarial real de LinkedIn, credencial real verificada (referencia, nunca token), mecanismo de atribución identificable (UTM + formulario con identificador de campaña), y la autorización de publicación explícita.

## Trazabilidad

ADR-0009…0014 (las verticales que el piloto integra y prepara) · Const. v1.7 Art. 2.1/2.4 · #16 (interfaz como realización, Nivel C). El piloto no revisa el propósito raíz (2.2) ni toca la capa congelada; F2-PILOT-01 **prepara** la operación real, pero **no la activa**. F2-PILOT-DEC-01 **registra la decisión** del primer piloto real; la activación permanece bloqueada hasta una autorización estratégica de publicación explícita.
