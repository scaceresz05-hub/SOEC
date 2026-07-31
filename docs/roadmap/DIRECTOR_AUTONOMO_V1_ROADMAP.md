# Roadmap — Director de Marketing Autónomo V1 (entorno controlado)

> Subordinado a la Constitución, la Auditoría y la Arquitectura objetivo. Meta del V1: un ciclo
> vertical **demostrable** (objetivo → … → aprendizaje → nueva decisión) en entorno **controlado
> (simulado)**, sin efectos externos reales. Cada bloque: *discovery → completar/conectar → pruebas
> → commit temático → validación*. **Reutilizar antes que construir.**

## Bloques (orden de ejecución)
| # | Bloque | Acción | Reutiliza | Construye | Commit |
|---|---|---|---|---|---|
| A | Conocimiento de negocio | SSOT de instancia (Organización/Marca/Producto/**Público**/**Competidor**/Evidencia/Política/Presupuesto/Indicador) con `id/organizacionId/origen/confianza/trazabilidad` | event-store, patrón de dominio, separación multiempresa | paquete `@soec/negocio` (o similar) | `feat(knowledge): establish governed business knowledge model` |
| B | Modelo de decisión | Extender decisión a la forma de marketing (contexto/**hipótesis**/alternativas/justificación/resultado) + estados del ciclo | `@soec/decision` (base), `@soec/estrategia`, evaluabilidad | entidad Hipótesis; estados nuevos | `feat(decisions): implement evidence-based marketing decisions` |
| C | Campaña | Campaña **derivada de una decisión** (no aislada) | `@soec/marketing` planner | vínculo decisión↔campaña + reglas de pausa/autonomía | `feat(campaigns): connect decisions to campaign planning` |
| D | Contenido | Contenido **gobernado por campaña** (marca/público/objetivo/hipótesis/evidencia/versión) | `@soec/contenido` (fábrica) | vínculos de contexto; sin generación IA | `feat(content): add campaign-governed content workflow` |
| E | Ejecución simulada | Adaptador simulado confiable, etiquetado `SIMULATED` | `@soec/canales` + `canal-emulado` | frontera de efectos + estados de ejecución | `feat(execution): add auditable simulated channel execution` |
| F | Medición | Conectar resultados/atribución al ciclo; etiquetar métrica importada/calculada/estimada/simulada | `@soec/medicion` | cableado a decisión/campaña | `feat(measurement): connect outcomes and attribution` |
| G | Aprendizaje | Experimento auditable (hipótesis/variante/resultado/conclusión) — **no** texto libre de IA | medición | paquete/entidad Experimento + Aprendizaje | `feat(learning): persist experiment-based learning` |
| H | Modo seguro | Gate de ejecución + niveles de autonomía + detención automática | `@soec/control` (pausa), evaluabilidad, anomalías | motor de autonomía + safe-mode automático | `feat(safety): enforce evaluability and automatic pause` |
| I | Director Workspace | Exponer el **ciclo completo** (objetivo→…→aprendizaje) priorizando decisión/evidencia/acción siguiente/riesgo/aprobaciones/resultados | Workspace F2-DISC-02/03 | vistas del ciclo de operación | `feat(workspace): expose autonomous director operating cycle` |
| J | Piloto SmileFlow (simulado) | Caso end-to-end: objetivo→diagnóstico→hipótesis→decisión→campaña→contenido→aprobación→ejecución simulada→métricas→evaluación→aprendizaje→siguiente; se detiene ante PAUSA/límite | todo lo anterior | pruebas de piloto | `test(pilot): validate SmileFlow end-to-end simulated campaign` |

## Pruebas obligatorias por dimensión (no se debilitan)
- **Separación:** campaña de SmileFlow no usa contexto de SSR Control; sin cruce de métricas/usuarios entre empresas.
- **Gobierno:** acción sin aprobación no se ejecuta; PAUSA detiene todo; SOEC no eleva su autonomía; presupuesto excedido bloquea.
- **Evaluabilidad:** falta de evidencia → `NO_EVALUABLE`; hipótesis no se guarda como hecho; estimación etiquetada como estimación.
- **Explicabilidad:** cada decisión con evidencia; cada campaña con justificación; cada resultado trazable hasta la decisión inicial.
- **Ciclo completo:** objetivo→…→nueva recomendación encadenado.
- **Modo seguro:** riesgo alto / datos contradictorios / sin autorización / pausa / límite de presupuesto → detienen.

## Validación por bloque y final
Por bloque: `typecheck` + tests relacionadas + `git status`. Final: suite completa + tests nuevos +
`build` + `pre-flight` + validación en navegador + piloto + working tree limpio. Comandos reales del
repo (descubrir en `package.json`): `pnpm typecheck · lint · test · -C apps/web build · sprint0:preflight`.

## Decisiones que requieren al usuario (detenerse — no resolver por iniciativa propia)
1. **Primer canal productivo** (Meta/Google/LinkedIn/…). 2. **Primer presupuesto real**.
3. **Credenciales** de cuentas. 4. **Marca piloto definitiva** (hoy: SmileFlow, solo para simulación).
5. **Nivel de autonomía inicial** por empresa/canal. Ninguna se activa sin autorización expresa.

## Estado tras el V1 (clasificación objetivo)
**Director de Marketing Autónomo V1 — funcional en entorno controlado y listo para comenzar
integraciones externas progresivas.** No se declara el objetivo global terminado.
