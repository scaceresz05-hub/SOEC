# ADR-0001 — Selección de Stack Tecnológico (Nivel C)

- **Estado:** ✅ **ACEPTADO.** El Propietario delegó la selección detallada en la implementación, dentro de los límites de la Orden de Inicio de Fase 1 (2026-07-19), que fijó el ecosistema y las restricciones. La selección concreta es **Nivel C reemplazable**; los contratos que debe satisfacer son **Nivel A** (ADR-0002).
- **Fecha:** 2026-07-19 · **Fase:** 1 — Base Técnica.

## Stack autorizado y su estratificación A/B/C

**Regla:** el ecosistema y los contratos son estructura; los productos y versiones son reemplazables. Ninguna versión de producto es arquitectura.

| Decisión | Elección | Nivel | Justificación / al cambiar |
|---|---|---|---|
| Ecosistema del núcleo | TypeScript estricto · Node.js 24 LTS · ESM | **B** | Continuidad con los productos existentes del Propietario; reduce fragmentación. Cambiarlo obliga a reescribir, pero no altera los contratos Nivel A |
| Monorepo | pnpm workspaces (Turborepo opcional) | **C** | Gestor reemplazable tras `package.json`/workspace |
| Backend | Fastify 5, con núcleo de dominio independiente de Fastify | **C** | El dominio no depende del framework; sustituible |
| Frontend | Next.js (App Router) + React | **C** | Interfaz reemplazable; sin reglas de dominio |
| Motor de persistencia | PostgreSQL (único primario) | **B** | Debe soportar los contratos de ADR-0002; cambiar de motor obliga a re-adaptar la persistencia, no el dominio |
| Acceso a datos | *a elegir por la implementación* (Prisma / Drizzle / SQL tipado) según cuál sirva mejor a ADR-0002 | **C** | El ORM **no** define el dominio; reemplazable tras el puerto de persistencia |
| Mensajería asincrónica | Outbox transaccional en PostgreSQL + workers tras puerto | **C** | Un broker futuro (Kafka/Rabbit) reemplaza el mecanismo sin tocar el núcleo |
| Caché | ninguna en el primer bloque | **C** | La corrección nunca depende de caché |
| Almacenamiento de objetos | puerto + filesystem/S3-compatible local | **C** | Proveedor real diferido |
| Sustrato de IA | **puerto `IntelligenceProvider` neutral** + adaptador simulado determinístico | **C** | *El más reemplazable de todos* (Const. 2.5); ningún SDK se llama desde dominio/aplicación/interfaz |
| Identidad/alcance | identidad abstracta + organización + alcance + rechazo por defecto | **A/C** | La exigencia de transportar contexto y aislar organizaciones es **Nivel A**; el proveedor de auth es Nivel C |
| Observabilidad | logging estructurado + correlación + causación | **B** | Estructura propia; plataforma externa diferida |
| Contenedores | Docker + Compose para dev/test; producto no acoplado a Docker | **C** | Reemplazable; no se despliega a producción aún |

**Estructura Nivel A que ninguna elección puede violar:** núcleo de dominio independiente de framework, ORM, motor de BD, IA y nube; persistencia append-only con historia/atribución/proyecciones (ADR-0002); transporte obligatorio de organización/identidad/alcance con rechazo por defecto; frontera de IA neutral. **Alternativas descartadas:** Python/Java/.NET/Go en el núcleo (rompen continuidad sin necesidad técnica demostrable); Kubernetes/microservicios/broker externo/Redis/múltiples BD en el primer bloque (infraestructura prematura; la simplicidad operacional es requisito).

## Contexto

La Fase 1 (Base Técnica) instancia las estructuras **Nivel A** del #16 con productos **Nivel C** tras sus fronteras estables. El #16 reserva la selección concreta de cada Nivel C a la autoridad competente, registrada y justificada contra la arquitectura. **Elegir el stack de un sistema pensado para veinte años es una decisión estratégica con consecuencias importantes** — precisamente los casos en que la Directiva de Fase 1 ordena detenerse.

## Ranuras Nivel C a decidir

| Ranura | Realiza (rol Nivel A) | Exigencia estructural que debe satisfacer |
|---|---|---|
| Lenguaje / runtime | Todo | Permitir realizar los contratos de ADR-0002 y ser mantenible |
| Almacén | Almacén de representaciones (#16) | Event-sourced, append-only, historia inmutable, atribución |
| Sustrato del órgano de operaciones intelectuales | #13 | **Reemplazable por diseño** (LLM / simbólico / híbrido); el más Nivel C de todos |
| Framework de composición | Compositor de capacidades (#14) | Componer operaciones hacia un propósito humano |
| Adaptadores de fuentes | Integrar→absorber (#10/#11) | Convertir sistemas externos en evidencia con procedencia |

## Criterios de decisión (derivados de la arquitectura, no de preferencia)

1. Cada elección debe **satisfacer la estructura Nivel A** correspondiente (ADR-0002).
2. Debe **preservar la reemplazabilidad**: ningún producto puede volverse Nivel A por comodidad (#16 inv. 2).
3. El **sustrato de IA** debe quedar tras una frontera que permita sustituirlo sin tocar la arquitectura (Independencia Tecnológica, Const. 2.5).

## Insumos que la decisión requiere y que la implementación no posee

No tomo esta decisión por fiat porque hacerlo sería **trasladar autoridad desde la implementación hacia la arquitectura** — lo que la gobernanza prohíbe. La decisión necesita insumos estratégicos que solo la Autoridad puede aportar:

- **equipo y competencias** disponibles (qué ecosistema domina quien va a construir y mantener);
- **destino de despliegue** (nube, on-premise, offline, híbrido);
- **restricciones de datos y soberanía** (dónde pueden residir los datos, marco regulatorio);
- **presupuesto** y tolerancia a dependencias de proveedor;
- **integraciones existentes** que la organización ya usa.

## Decisión

**Reservada.** Se eleva a la Autoridad Estratégica. La implementación de código de la Base Técnica queda en espera de esta decisión; **la especificación tech-neutral (ADR-0002) no depende de ella y avanza.**

## Consecuencias

- Bloquea: el código que realiza la Base Técnica.
- No bloquea: el contrato de conformidad (ADR-0002), verificable contra cualquier stack que se elija.
- Al decidirse: se registra cada ranura con su nivel (Nivel C), justificada contra ADR-0002, y su cambio futuro recorrerá el circuito #8→#6→#7→#5.

## Trazabilidad

#16 (Estratificación A/B/C, §6 reserva de selección) · Const. 2.5 (Independencia Tecnológica) · Directiva de Fase 1 (casos de parada #3, #4).
