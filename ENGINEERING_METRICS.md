# ENGINEERING_METRICS

Medición del rendimiento de la ejecución bajo **SOEC Engineering Methodology v1.0 (congelada)**. El objetivo NO es refinar el proceso, sino **medir si funciona**. Se actualiza al cerrar cada hito. Los datos deben ser honestos (estimados marcados como tales; desconocidos como `s/d`).

> Estado de la metodología: `ENGINEERING_METHODOLOGY_V1_0_FROZEN`. No se modifica durante M4-D y M5. La v1.1 sólo se evalúa tras esos hitos, por evidencia de estas métricas.

## Indicadores por hito

| # | Hito | Estado | Commits | Tests agregados | Interrupciones al usuario | Bugs por AUTOauditoría | Bugs por auditoría EXTERNA (usuario) | Rework (ciclos H) | Tiempo→consolidación |
|---|------|--------|--------:|----------------:|--------------------------:|-----------------------:|-------------------------------------:|-------------------|----------------------|
| 1 | Fundación M4 (M4-A→M4-C-C) | Fusionada (`main`, tag `fundacion-m4`) | 15 | ~991 acumulados (suite global) | Alta (auditoría por tramo, por diseño de gobernanza) | varios (referencias opacas, esConsumible, huella) | **muchos**: F-CB-1, F-CB-2, C-1..C-7, F-CBH-1, F-CCC-1/2, PR-1 | **3** (M4-C-A→A-H, M4-C-B→B-H, M4-C-C→correcciones) | por tramo |
| 2 | M4-D — andamiaje neutral + frontera | Técnicamente consolidado; pend. revalidación PG | 7 | 152 (2 paquetes M4) | **1** (feedback metodológico) | **2** autoauditoría (presupuesto fail-open; gate de nivel diferido) + DRY/consolidación (fnv1a, errorAborto) + no-filtración por path completo | 0 externo | 0 | 1 ciclo |

### Notas de honestidad
- **Fundación M4:** las "interrupciones" fueron mayormente **auditorías de gobernanza solicitadas por el usuario** (por tramo), no fragmentación artificial. El alto rework (los `-H`) es precisamente lo que la metodología v1.0 (autoauditoría adversarial + regla del 95%) busca **reducir**: muchas correcciones venían de escenarios adversariales ejecutables antes de detenerse.
- **M4-D neutral:** primer hito ejecutado ya con la metodología madura. Interrupciones ≈ 1 (el mismo usuario lo estimó: "hace unas semanas, 15; ahora, 1"). La autoauditoría (regla del 95%) detectó y corrigió el fail-open de presupuesto **antes** de cerrar → 0 rework externo hasta la fecha.

## Incidencias de metodología (autorreportadas)

Registro honesto de detenciones/decisiones que NO cumplieron la metodología, para medir el desempeño (no para cambiar el proceso).

| # | Hito | Incidencia | Detección | Corrección |
|---|------|-----------|-----------|------------|
| I-1 | M4-D neutral | Se **difirió** el cableado del gate de nivel de activación clasificándolo como "dependiente de gobernanza/ratificación", cuando en realidad era cableable como **opción inyectada** (neutral, patrón del presupuesto) → una fila del test de independencia que respondía "No" se recomendó en vez de ejecutarse. | Auto (al aplicar con rigor la Directiva de Autonomía por Hito). | Implementado el gate `ACTIVACION` inyectado + tests en el mismo ciclo; sin rework externo. |

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
