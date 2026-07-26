# PRE-FLIGHT REPORT — Sprint 0

- **Sello:** 2026-07-25T23:31:17.834Z
- **API:** http://127.0.0.1:3081 · **WEB:** http://127.0.0.1:3080
- **Total:** 34 · ✔ 33 · ✖ 0 · ⚠ 1

## Resultado: **APTO PARA SPRINT 0** ✅

### Entorno

- ✔ API /health responde 200 — HTTP 200
- ✔ API catálogo devuelve 3 organizaciones — 3 organizaciones
- ✔ WEB raíz responde 200 — HTTP 200
- ✔ WEB /evaluacion responde 200 y renderiza — HTTP 200
- ✔ WEB /director-workspace responde 200 — HTTP 200
- ✔ WEB proxy /api/catalogo llega a la API — HTTP 200

### PostgreSQL

- ✔ Conexión a PostgreSQL (SELECT 1) — conectado
- ✔ Migraciones aplicadas (tabla events existe) — events
- ✔ Hay eventos persistidos (seed cargado) — 23 eventos

### Escenarios de demostración

- ✔ Caso A (clinica-brille) tiene evaluación GENERADA — GENERADA
- ✔ Caso A propone candidatos con confianza — 2 candidato(s)
- ✔ Caso A: trazabilidad abre (cadena no vacía) — cadena presente
- ✔ Caso A: transparencia abre (supuestos presentes) — 4 supuestos
- ✔ Caso B (clinica-nova) tiene evaluación GENERADA — GENERADA
- ✔ Caso B: faltantes visibles — 7 faltantes
- ✔ Caso B: cobertura parcial o abstención — 1/2
- ✔ Caso C (clinica-aurora) tiene evaluación GENERADA — GENERADA
- ✔ Caso C: ≥2 generaciones (regeneración) — 2 generaciones
- ✔ Caso C: ≥1 respuesta no normalizable — 1 no normalizable(s)

### Flujo completo (sandbox efímero, no toca A/B/C)

- ✔ Selección inválida es rechazada (400) — HTTP 400
- ✔ Iniciar evaluación → BORRADOR con id — BORRADOR
- ✔ Cuestionario gobernado presente (≥8 preguntas) — 8 preguntas
- ✔ Responder cerrada «sí» → RESPONDIDA — ok
- ✔ Normalización segura: «a veces» → NO_NORMALIZABLE — ok
- ✔ Generar comprensión → GENERADA con huella — c211c8e213d4
- ✔ Workspace propone candidato sobre la evaluación — OBJ-CD-01
- ✔ Aceptar → objetivo vigente — OBJ-CD-01
- ✔ Persistencia + recarga: el vigente persiste en lectura fresca — persistido
- ✔ Revocar → sin objetivo vigente — revocado
- ✔ Cerrar el sandbox efímero (no queda editable) — CERRADA

### Integridad de render

- ✔ Sin marcadores de error de Next en /evaluacion — HTML limpio
- ✔ Sin marcadores de error de Next en /director-workspace — HTML limpio
- ⚠ Consola del navegador / errores JS-React — requiere verificación en navegador (Nivel 1.b); no automatizable desde Node
- ✔ Logs de backend sin errores reales — limpios (ruido de HMR/warnings ignorado)

> Nivel 1 (técnico, automático) verificado. **Nivel 2 (observación humana)** — ¿la experiencia se entiende, el Director confía, alguna palabra confunde? — NO lo cubre este check: lo responden los usuarios reales.
> El sandbox efímero de la prueba de flujo queda como evaluación CERRADA «preflight-check» en `clinica-brille`; re-ejecuta el seed si quieres una lista impecable.
