# ADR-0020 — Adopción de la Directiva Maestra de la Plataforma de Capacidades Externas (PCE)

- **Estado:** Aceptado (ratificado por la Dirección Técnica).
- **Fecha:** 2026-08-01.
- **Contexto de bloque:** cierre de M3 (motor de generación, `main=a210b04`, tag `macrobloque-3`) e inicio de M4.

## Contexto

M4 introduce, por primera vez, la posibilidad de usar **proveedores externos reales** (comenzando por generación de contenido con IA). Esto trae riesgos irreversibles nuevos —credenciales reales, costo real, salida de datos a terceros— que no existían en M1–M3 (todo SIMULADO). Antes de escribir código se decidió redactar una **autoridad arquitectónica** que gobierne no sólo M4 sino todos los bloques posteriores que incorporen capacidades externas.

## Decisión

Se **adopta** la **Directiva Maestra de la Plataforma de Capacidades Externas (PCE)**, versión **v2.1**, persistida en `docs/governance/DIRECTIVA-MAESTRA-PCE.md`, como **autoridad arquitectónica permanente** de toda capacidad externa de SOEC (IA, correo, pagos, canales, CRM, almacenamiento, mensajería…).

Puntos clave:

- **Principio rector:** *el dominio conoce Capacidades, no Proveedores.*
- **Título I (permanente):** Arts. 1–14 (Constitución de Integraciones; separación absoluta dominio↔proveedor/costo; Capacidad ≠ Activación; secretos por capacidad; gobernanza económica; observabilidad como "poder responder"; Constitución del Cambio; soberanía humana/modo seguro; honestidad; multi-tenant; degradación gobernada; determinismo; salud —observable ≠ confiable—; compatibilidad).
- **Título II (revisable por bloque):** aplicación a M4 — primera capacidad = generación IA supervisada detrás del puerto neutral `ProveedorGenerativo`, con decisiones de aplicación **DA-1** (frontera de adaptadores: un paquete por proveedor + contrato común), **DA-2** (SecretStore por referencia), **DA-3** (evidencia reproducible; ninguna llamada real en el gate).
- **Título III (gobernanza):** jerarquía normativa con **cláusula de prevalencia**; enmienda sólo por la Dirección Técnica con **versión + changelog + ADR**.

## Consecuencias

- (+) Provee una constitución tecnológica estable que sobrevive al proveedor, al secret store y al lenguaje; M5+ sólo agregan "Aplicación a Mx" sin reescribir el Título I.
- (+) Fija invariantes duras antes de tocar riesgo real (secretos por referencia, costo que aborta, activación humana, `AUTONOMOUS_REAL` bloqueado).
- (−) Introduce estructura de gobernanza adicional (ADR por artículo/DA implementada; frontera de neutralidad verificada por test) que hay que mantener.

## Alcance de esta adopción

Este ADR sólo **adopta** la Directiva y **descongela** la rama `feat/macrobloque-4` para iniciar **M4-A** (Núcleo de la PCE). No implementa ninguna capacidad real ni conecta proveedores. `AUTONOMOUS_REAL` permanece bloqueado; sin publicación ni gasto real.

## Referencias

- `docs/governance/DIRECTIVA-MAESTRA-PCE.md` (autoridad).
- `docs/governance/CONSTITUCION_SOEC.md` (autoridad superior).
- ADR-0019 (motor de generación, base sobre la que M4 construye).
