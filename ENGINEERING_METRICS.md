# ENGINEERING_METRICS

Medición del rendimiento de la ejecución bajo **SOEC Engineering Methodology v1.0 (congelada)**. El objetivo NO es refinar el proceso, sino **medir si funciona**. Se actualiza al cerrar cada hito. Los datos deben ser honestos (estimados marcados como tales; desconocidos como `s/d`).

> Estado de la metodología: `ENGINEERING_METHODOLOGY_V1_0_FROZEN`. No se modifica durante M4-D y M5. La v1.1 sólo se evalúa tras esos hitos, por evidencia de estas métricas.

## Indicadores por hito

| # | Hito | Estado | Commits | Tests agregados | Interrupciones al usuario | Bugs por AUTOauditoría | Bugs por auditoría EXTERNA (usuario) | Rework (ciclos H) | Tiempo→consolidación |
|---|------|--------|--------:|----------------:|--------------------------:|-----------------------:|-------------------------------------:|-------------------|----------------------|
| 1 | Fundación M4 (M4-A→M4-C-C) | Fusionada (`main`, tag `fundacion-m4`) | 15 | ~991 acumulados (suite global) | Alta (auditoría por tramo, por diseño de gobernanza) | varios (referencias opacas, esConsumible, huella) | **muchos**: F-CB-1, F-CB-2, C-1..C-7, F-CBH-1, F-CCC-1/2, PR-1 | **3** (M4-C-A→A-H, M4-C-B→B-H, M4-C-C→correcciones) | por tramo |
| 2 | M4-D — andamiaje neutral + frontera + activación event-sourced | **Consolidado** (`verify` global 1026 verde) | 9 | 155 (2 paquetes M4); **1026 global** | **1** (feedback metodológico) | **2** autoauditoría (presupuesto fail-open; gate de nivel diferido) + DRY/consolidación (fnv1a, errorAborto) + no-filtración por path completo | 0 externo | 0 | 1 ciclo |
| 3 | M5 — Motor Estratégico Comercial (núcleo canónico + afirmación estratégica + aditivos descriptivos + decisión Empresa raíz) | **Cerrado** (`verify` global 1058 verde) | 3 | 32 (motor-estrategico + aditivos crm); **1058 global** | **0** (0 en implementación; 1 auditoría de cobertura solicitada por el usuario + 1 decisión de arquitectura reservada — no fricción evitable) | **2** autoauditoría (explicación honesta de retiro; rama muerta) | **auditoría de COBERTURA del usuario** → 5 aditivos descriptivos (Mercado/Competidor/BuyerPersona/PropVal/KPI) + resolución Empresa raíz | 0 (aditivos, no reapertura por defecto) | 1 ciclo + cierre de cobertura |
| 4 | M6 — Motor Creativo Estratégico (contexto-puente M5 + obsolescencia, territorio, mensajes tipados, gate AUTORITATIVO, abstención 1.ª clase, brief/pieza ampliados, PIPELINE end-to-end, LecturaCreativa completa) | **Cerrado** (`verify` global 1093 verde) | 3 | 35 (motor-creativo 33 + estrategia-creativa 2); **1093 global** | **1 (necesaria)**: cierre prematuro del hito — se entregó núcleo + pendientes en vez de agotar; el usuario lo corrigió (`AUDITORIA_M6_REQUIERE_CIERRE_INTERNO`) → cerrado sin nueva detención | discovery-first (8+ paquetes M3); autoauditoría 24 escenarios; incidencia I-2 | corrección de alcance del usuario (cierre interno) | 1 (cierre interno tras dictamen) | 2 ciclos (núcleo → cierre) |

### Notas de honestidad
- **Fundación M4:** las "interrupciones" fueron mayormente **auditorías de gobernanza solicitadas por el usuario** (por tramo), no fragmentación artificial. El alto rework (los `-H`) es precisamente lo que la metodología v1.0 (autoauditoría adversarial + regla del 95%) busca **reducir**: muchas correcciones venían de escenarios adversariales ejecutables antes de detenerse.
- **M4-D neutral:** primer hito ejecutado ya con la metodología madura. Interrupciones ≈ 1 (el mismo usuario lo estimó: "hace unas semanas, 15; ahora, 1"). La autoauditoría (regla del 95%) detectó y corrigió el fail-open de presupuesto **antes** de cerrar → 0 rework externo hasta la fecha.
- **M5:** ejecutado sin interrupciones (0). El mayor valor del hito NO fue escribir código, sino **inspeccionar antes de construir**: el Bloque Maestro parecía greenfield, pero M2/M3 ya tenían 8 de los 11 modelos; construir un "motor estratégico" paralelo habría violado la regla SSOT del propio Bloque Maestro. La decisión de arquitectura (consolidar + construir solo el núcleo canónico de evaluabilidad que faltaba, en vez de duplicar) es el test del CTO aplicado. Autoauditoría corrigió 2 defectos (explicabilidad deshonesta en retiro; rama muerta) antes de cerrar.

## Incidencias de metodología (autorreportadas)

Registro honesto de detenciones/decisiones que NO cumplieron la metodología, para medir el desempeño (no para cambiar el proceso).

| # | Hito | Incidencia | Detección | Corrección |
|---|------|-----------|-----------|------------|
| I-1 | M4-D neutral | Se **difirió** el cableado del gate de nivel de activación clasificándolo como "dependiente de gobernanza/ratificación", cuando en realidad era cableable como **opción inyectada** (neutral, patrón del presupuesto) → una fila del test de independencia que respondía "No" se recomendó en vez de ejecutarse. | Auto (al aplicar con rigor la Directiva de Autonomía por Hito). | Implementado el gate `ACTIVACION` inyectado + tests en el mismo ciclo; sin rework externo. |
| I-2 | M6 | **Cierre prematuro del hito:** se entregó el núcleo + una lista de "pendientes aditivos" pidiendo autorización, cuando esos pendientes (brief/pieza ampliados, orquestación end-to-end, obsolescencia automática) eran **criterios LOCKED** del Bloque Maestro, no deuda opcional. Detenerse contradecía el hito ya autorizado. | Externa (usuario: `AUDITORIA_M6_REQUIERE_CIERRE_INTERNO`). | Se agotó M6 completo sobre la misma rama sin nueva detención: brief/pieza ampliados aditivamente, pipeline conectado, obsolescencia autoritativa, contratos M7 completos, 24 escenarios adversariales; `verify` 1093 verde. |

## Tendencia buscada (hipótesis a validar con M4-D y M5)
- ↓ Interrupciones por hito.
- ↓ Bugs encontrados por auditoría EXTERNA (↑ proporción encontrada por autoauditoría).
- ↓ Rework (ciclos `-H` posteriores a auditoría externa).
- Cobertura de regresión estable o creciente; sin regresiones.

## Definiciones
- **Interrupción:** detención que devuelve el control al usuario fuera de las 14 causas legítimas (estrategia/gobernanza/credenciales/SDK/datos/costo/irreversible/ambiental/pedido). Las detenciones por decisión estratégica **no** cuentan como fricción evitable.
- **Bug por autoauditoría:** defecto que Claude encontró y corrigió por sí mismo antes de cerrar el hito.
- **Bug por auditoría externa:** defecto que sólo apareció en la revisión del usuario (idealmente → 0).
- **Rework:** hitos/tramos que hubo que reabrir (`-H`) por hallazgos que podrían haberse anticipado.

## Método de actualización
Al cerrar cada hito, agregar una fila con datos objetivos (git log para commits, suites para tests, conteo real de detenciones). No estimar donde exista dato objetivo; marcar `s/d` lo desconocido. Revisión de la metodología: **sólo** al terminar M4-D y M5.
