# ADR-0008 — Primera interfaz consumidora de capacidades (F1-UI-01)

- **Estado:** ✅ **ACEPTADO.** Realiza la prioridad estratégica de `docs/decisions/prioridad-primera-interfaz.md`. Interfaz = realización técnica (#16), Nivel C; no introduce arquitectura de dominio.
- **Fecha:** 2026-07-21 · **Bloque:** F1-UI-01.

## Contexto

La Autoridad Estratégica priorizó la primera experiencia de usuario con una capacidad real. El objetivo de diseño: *el usuario comprende mejor su empresa sin necesitar entender cómo está construida SOEC, y SOEC no decide por él.*

## Decisiones

### D-1. La web consume SOLO capacidades, por su API pública *(Nivel A del contrato, Nivel C de realización)*

- `apps/web` (Next.js 15 App Router, React 19) es **consumidora**: no importa paquetes de dominio, no accede a PostgreSQL, no reconstruye productos, no aplica reglas intelectuales ni calcula incertidumbre. La única ruta de datos es la **API pública de capacidades**. Los tipos de transporte son **locales** (DTOs), derivados de los contratos públicos sin importar implementaciones del backend.

### D-2. Route handlers proxy server-side *(Nivel C)*

- El navegador llama a route handlers de Next (misma-origin) que reenvían server-side a la API (`SOEC_API_URL`), evitando CORS y sin exponer la URL interna. Ninguna credencial ni lógica de dominio en el navegador.

### D-3. Capa de experiencia en la API *(Nivel C)*

- `apps/api` expone `/experiencia/comprender-estado/*` que ejecuta la **cadena real** (Capacidad → Operaciones → ECE → MED+MDM sintéticos persistidos) con un contexto sintético server-side (sin auth para el demo), ensamblando un DTO orientado a las cinco preguntas humanas. Idempotente por `executionId`; historial por stream índice; detalle recuperable.

### D-4. Organización por preguntas humanas, no por arquitectura *(regla de diseño)*

- La vista responde, en orden: qué ocurre · qué señales · en qué se basa · qué no se sabe/es contradictorio · qué revisar/decidir. La arquitectura (ECE/MED/MDM/operaciones) aparece por **trazabilidad progresiva** bajo expansión, nunca como navegación principal.

### D-5. Soberanía en la superficie *(Nivel A, heredado)*

- Sin botones de acción (aprobar/ejecutar/publicar/enviar/resolver): la interfaz **presenta**; la decisión y la acción son de la persona. La abstención y el error tienen experiencia propia (no un fallo genérico). `bindingDecision: false` visible en trazabilidad.

## Consecuencias

- Existe la primera experiencia de usuario completa sobre la cadena real. Efectos externos, conectores, auth y otras capacidades quedan reservados (nueva instanciación estratégica).
- **Límite de verificación declarado:** las capturas raster (screenshots) excedieron el timeout del entorno; la validación visual se realizó **conduciendo la app viva** (clicks + árbol de accesibilidad) sobre la cadena real en PostgreSQL — artefactos verificables. La abstención **total** no se dispara en el dominio sintético (el paso obligatorio `detectar` no se abstiene): su experiencia se valida por prueba de componente.

## Trazabilidad

`docs/decisions/prioridad-primera-interfaz.md` · #14 (capacidades) · #16 (realización, interfaz Nivel C) · #17 §4-§5. Ninguna cláusula modifica la Fundación ni introduce lógica de dominio en la web.
