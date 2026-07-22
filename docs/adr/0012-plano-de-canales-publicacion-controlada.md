# ADR-0012 — Plano de Canales y Publicación Controlada (F2-CHAN-01)

- **Estado:** ✅ **ACEPTADO.** Cuarta vertical del Departamento de Marketing Autónomo. Continúa ADR-0009 (autorización), ADR-0010 (planificador) y ADR-0011 (fábrica de contenido), sin abrir circuito de enmienda.
- **Fecha:** 2026-07-21 · **Bloque:** F2-CHAN-01.

## Contexto

F2-CONT-01 (ADR-0011) produce un **paquete publicable** versionado, pero SOEC no sabía llevarlo a un canal externo. Este ADR fija el **plano de canales** (`@soec/canales`): consume un paquete publicable, lo autoriza por el plano operacional, lo mapea al payload de un canal y ejecuta un **ciclo de publicación controlada** (preparar → enviar → verificar → reconciliar → auditar) contra un adaptador **reemplazable**, cruzando una **frontera de red real** hacia un proveedor **emulado**. Modo seguro: ningún efecto público real, ningún gasto, ninguna credencial real.

## Decisiones

### D-1. Tres modos visibles y persistidos; el modo real está DESACTIVADO *(Nivel A — §2)*

- `simulado` (sin red), `sandbox` (proveedor **emulado** por HTTP) y `real_desactivado` (contemplado por la arquitectura, **bloqueado por configuración, política y guardarraíl**). El modo se persiste en el agregado de publicación (no depende de una variable ambiental informal). No existe un modo `real` activable en este bloque: un efecto público real es **causal de parada**.

### D-2. La publicación NO salta la autorización; el efecto pasa por un adaptador reemplazable *(Nivel A — §4)*

- Antes de cualquier envío, el servicio evalúa la **autorización del plano operacional** (`evaluarAutorizacion`) contra la política vigente; una acción no autorizada queda **bloqueada**. El envío lo realiza un **`AdaptadorCanal`** proveedor-independiente (puertos `CanalPublisher/Verifier/Reconciler/Remover` + capacidades). Dos implementaciones: `AdaptadorCanalSimulado` (sin red) y `AdaptadorCanalEmulado` (fetch HTTP). El dominio jamás importa un SDK; el proveedor emulado está **aislado** (`@soec/canal-emulado`, sin dependencias `@soec/*`) y ningún archivo de dominio lo importa.

### D-3. Capacidades por canal; no todos los proveedores funcionan igual *(Nivel A — §4)*

- Un contrato de **capacidades** declara qué soporta cada canal (texto/imagen/video, borradores, programación, edición, eliminación, consulta, webhooks, límites, y si **exige un archivo real** para publicar con imagen). Un canal que exige imagen real (instagram, meta_ads) cuando solo existe una **especificación** (F2-CONT-01) queda **bloqueado** (`activo_real_faltante`), sin envío.

### D-4. Idempotencia externa: nunca publicar dos veces por una respuesta perdida *(Nivel A — §7)*

- Cada publicación tiene una **clave de idempotencia** derivada de organización + paquete + canal + cuenta + huella del payload. Se envía al proveedor (que la respeta); localmente, el servicio **no reenvía** si ya hay referencia externa, y ante un resultado **desconocido** (timeout/red) **reconcilia** (consulta al proveedor por la clave de idempotencia) en lugar de reenviar. El adaptador trata `504`/red como **DESCONOCIDO** (el objeto pudo crearse).

### D-5. Verificación y reconciliación; no basta con un 2xx *(Nivel A — §12, §13)*

- Una publicación no es exitosa solo porque el proveedor respondió `2xx`: se **verifica** el estado remoto. La **reconciliación** resuelve divergencias (sin rastro remoto → fallida reintentable; publicado → verificada; eliminado externamente → retirada; estado divergente → **requiere intervención**) produciendo un **hallazgo** con evidencia y resolución; **nunca sobrescribe contradicciones en silencio**.

### D-6. Estados explícitos; los webhooks no retroceden el estado *(Nivel A — §6, §14)*

- Máquina de estados de la publicación (preparada…verificada…reconciliando…retirada…). Los **webhooks** entrantes se validan por **firma HMAC**, se **deduplican** (idempotentes por id), se ignoran de forma segura si la referencia es desconocida, e **impiden replay y regresión**: un webhook antiguo/fuera de orden cuya transición no es válida no altera el estado.

### D-7. Credenciales por referencia; rate limiting con backoff determinista *(Nivel A — §8, §15)*

- Los eventos guardan una **referencia de credencial** (organización + canal + cuenta + credencialId), **nunca el token**; el proveedor de credenciales (fixture de desarrollo) lo resuelve en el borde, comprueba vigencia/revocación e impide uso cruzado entre organizaciones. **Ningún secreto es obligatorio.** El rate limiting respeta `Retry-After` y aplica **backoff con jitter DETERMINISTA** (reproducible en pruebas, sin azar). Errores clasificados por categoría y reintentabilidad; mensajes seguros, sin tokens ni datos personales.

## Consecuencias

- SOEC puede **entregar, verificar y reconciliar** una publicación a través de una frontera externa realista, sin duplicarla, sin saltar políticas y sin que el propietario copie o publique manualmente el contenido.
- Se preservan intactos: propósito raíz, soberanía transformada, no-vinculación del conocimiento, y el guardarraíl de **ningún efecto público real** (proveedor emulado/simulado; modo real desactivado).
- Cadena disponible: objetivo → plan → actividad → fábrica de contenido → **paquete publicable → autorización → adaptador → proveedor emulado → verificación → reconciliación**. Se habilita F2-MET-01 (medición/atribución). El **primer efecto externo real** sigue siendo causal de parada hasta definir empresa/plataforma/cuenta/contenido/presupuesto/nivel/pausa/ventana/criterios.

## Trazabilidad

ADR-0009 (autorización; única puerta al efecto) · ADR-0010 (plan/actividades) · ADR-0011 (paquete publicable, contrato de consumo) · Const. v1.7 Art. 2.1/2.4 · ADR-0002 (contratos de conformidad). El plano de canales no revisa el propósito raíz (2.2) ni toca la capa congelada.
