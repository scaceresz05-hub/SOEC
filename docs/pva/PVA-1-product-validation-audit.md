# PVA-1 — Product Validation Audit

Estado: cerrado · Fecha: 2026-08-04 · Rama: `feat/macrobloque-4d`

**Naturaleza del bloque.** PVA-1 NO es desarrollo. No construye funcionalidades, no agrega IA, no
integra proveedores. Es una auditoría de validación: actuar como **QA de producto**, intentar **romper**
la experiencia, recorrer cada pantalla preguntando «¿por qué existe?», intentar **eliminar** pantallas, y
**corregir** (no reportar) la fricción hallada. Sólo se escribió código para correcciones que aparecieron.

**Promesa a demostrar.** No «tiene muchos módulos», sino: **«yo le doy un objetivo y SOEC hace el resto»**.

**Método.** Se arrancó el producto real (`apps/web` sobre la cadena M5→M9 sembrada, SIMULADO) y se recorrió
cada superficie leyendo el texto efectivamente renderizado (no el código). Cada hallazgo se corrigió en el
mismo bloque y se re-verificó en runtime.

---

## Resultado de los 10 escenarios

| # | Escenario | Veredicto inicial | Qué se corrigió |
|---|---|---|---|
| 1 | Dentista, nunca usó marketing, ¿entiende en <10 min? | **Falla** — jerga (CTR, KPI, «hipótesis», «experimento», «iteración», «gancho») | Traducción total a lenguaje llano en las 6 superficies (ver §Corrección A) |
| 2 | Pyme que no sabe qué es CTR/ICP/campaña | **Falla** — misma jerga | Igual que #1; ninguna sigla ni término técnico sobrevive en texto visible |
| 3 | «Sólo quiero revisar, ¿SOEC trabaja solo?» | **Pasa** | HOME abre con «Mientras no estabas avancé en tus objetivos…»: el trabajo hecho es lo primero |
| 4 | Vuelvo de vacaciones, ¿trabajó o sólo muestra gráficos? | **Pasa (y refuerza)** | El producto NO tiene un solo gráfico: todo es trabajo narrado («Publiqué… Aprendí… Medí…»). Se eliminó la pantalla Actividad por redundante (§Corrección E) |
| 5 | Nunca apruebo nada, ¿se queda detenido? | **Falla** — no explicaba qué pasa si no decides | Bandeja ahora dice: «Puedo esperar sin bloquear el resto de tu trabajo; y si quieres que actúe solo en casos así, súbeme la autonomía» (§Corrección B) |
| 6 | Apruebo todo, ¿pregunta cosas innecesarias? | **Pasa** | Única interrupción = propuesta M9 real. Un clic (Aprobar) aplica y prepara el siguiente paso; sin confirmaciones redundantes |
| 7 | Tengo tres objetivos, ¿cómo decide prioridades? | **Falla parcial** — no lo explicaba | Objetivos ahora explica, con honestidad: «avanzo cada uno según la evidencia; primero el que ya está listo para decidir; si dos compiten por el presupuesto, te lo traigo como decisión — no elijo a tus espaldas» (§Corrección C) |
| 8 | Sin presupuesto, ¿qué hace? | **Pasa** | Onboarding lo declara: «Lo respeto siempre; si algo no cabe, me abstengo». En el motor, coste>presupuesto ⇒ RECHAZA_POR_POLITICA (se abstiene) |
| 9 | Presupuesto infinito, ¿qué hace? | **Pasa** | Autonomía garantiza: «cualquier acción con efecto real seguirá exigiendo tu ratificación». No gasta por tener margen: exige evidencia y aprobación |
| 10 | SOEC se equivocó, ¿cómo lo explica? | **Falla parcial** — no demostraba honestidad ante el error | El Centro de Explicaciones incorpora la fila **«Si no funciona»**: «Te lo digo con la misma claridad, vuelvo a la versión anterior y te explico qué aprendí del error» (§Corrección D) |

**Síntesis:** 5 pasaron sin cambios; 5 fallaban (2 por jerga, 3 por vacíos de explicación) y **quedaron corregidas**.
La causa raíz dominante era una sola: **el producto hablaba el idioma de sus motores, no el del usuario.**

---

## Correcciones aplicadas (no reportadas)

**A · Erradicación de jerga (escenarios 1, 2).** La promesa se rompía en la primera línea: un dentista no
sabe qué es un CTR. Se corrigió en dos capas, sin tocar los motores:
- *Texto del seed* (`lib/soec/motor.ts`, contenido simulado de autoría propia): «repetir el experimento
  ganador» → «repetir lo que funcionó»; «mejor CTR» → «que más personas hagan clic»; explicación de la
  propuesta reescrita en llano.
- *Texto que el motor emite con el id técnico `ctr`* (evaluación M8): se añadió un traductor de vista
  `llano()` en `lib/soec/consultas.ts` que convierte CTR→«clics», KPI→«medida», ICP→«público objetivo»,
  hipótesis→«idea», experimento→«prueba», iteración→«paso». **El motor no se modifica**; sólo lo que ve una
  persona. Además, la fila «Por qué» dejó de volcar enums (`resultado SUPERADO; hipótesis RESPALDADA…`) y
  ahora lidera con la explicación humana de la propuesta; la evidencia se expresa como «la medición superó
  la meta: hicieron clic más personas de las esperadas».
- Metas de objetivos: «meta CTR 5,0%» → «Meta: que 5 de cada 100 que lo vean hagan clic»; «6,0% observado»
  → «Vas por delante: 6 de cada 100 (tu meta eran 5)».
- *Verificación:* barrido automático de las 6 superficies — cero ocurrencias de CTR/KPI/ICP/hipótesis/
  experimento/iteración/gancho ni de enums (SUPERADO/RESPALDADA/RECOMENDACION) en texto visible.

**B · Qué pasa si no apruebas (escenario 5).** La Bandeja aclara que no decidir no bloquea a SOEC y ofrece
la salida real: subir la autonomía para que actúe dentro de las políticas. Enlace directo a Autonomía.

**C · Prioridad entre objetivos (escenario 7).** Objetivos explica el criterio real y honesto (evidencia-
primero) y promete que un conflicto de presupuesto se convierte en decisión, no en una elección a espaldas
del usuario. No se fabricó un «motor de priorización» inexistente: se describe el comportamiento que ya rige.

**D · Honestidad ante el error (escenario 10).** Nueva fila «Si no funciona» en cada explicación: reconoce el
error, revierte a la versión anterior y explica el aprendizaje. Refuerza la nota ya presente: «una
correlación no es causalidad y una mejora simulada no es evidencia de mejora real».

**E · Eliminación de pantalla (regla «intenta eliminar, no agregar»).** La pantalla **Actividad** (`/timeline`)
duplicaba «Lo que hice por ti» de HOME: los mismos hechos, distinto encabezado. Existía «porque los software
suelen tener un registro de actividad» — exactamente el criterio que obliga a eliminar. **Se eliminó**
(borrada la página, la consulta `timeline()` y el enlace de navegación; `/timeline` redirige a `/`). HOME ya
responde el escenario 4. Superficies 7 → 6. También se redirigieron dos rutas de módulo aún alcanzables por
URL (`/organizaciones`, `/select-organization`).

---

## Auditoría de pantallas — «¿por qué existe?»

| Pantalla | ¿Requiere una decisión humana / entrega trabajo hecho? | Veredicto |
|---|---|---|
| Inicio (HOME) | Es el parte diario: qué hice, qué necesito, cómo van los objetivos. No pide nada. | **Se queda** — es el producto |
| Decisiones | Sólo decisiones humanas (Principio de Excepción). | **Se queda** |
| Por qué (Explicaciones) | Rinde cuentas de cada recomendación. | **Se queda** |
| Objetivos | La entrada de la promesa: «le doy un objetivo». | **Se queda** (config) |
| Autonomía | Fija cuánto se delega (los «límites»). | **Se queda** (config) |
| Poner en marcha (Onboarding) | Sólo lo no descubrible; primera vez. | **Se queda** (config) |
| **Actividad (Timeline)** | Duplicaba HOME; existía «porque los software la tienen». | **ELIMINADA** |

Ninguna pantalla superviviente obliga a trabajo rutinario: son de solo-lectura (Inicio, Por qué, Objetivos)
o de decisión/límite humano (Decisiones, Autonomía, Onboarding).

---

## Criterio de cierre PVA-1

> Una persona que nunca ha utilizado un software de marketing puede abrir SOEC, definir un objetivo, un
> presupuesto y sus límites, y comprender en menos de diez minutos qué está haciendo el sistema, qué
> resultados obtuvo y qué decisiones requieren su intervención, sin necesidad de capacitación.

**Cumplido.** Tras las correcciones: (1) no queda vocabulario de marketing en ninguna superficie; (2) las
cinco fallas están cerradas y re-verificadas en runtime; (3) el producto responde las cuatro preguntas del
usuario —qué hace, qué resultó, qué necesita, cómo va— en lenguaje de Director, sin gráficos ni módulos; (4)
se eliminó una pantalla en vez de agregarla. Gate global verde (202 archivos / 1379 tests); `tsc` y `next
build` verdes; barrido de jerga en cero.

**Límites que PVA-1 respeta.** Todo SIMULADO; `AUTONOMOUS_REAL` bloqueado; sin proveedores, red, gasto ni
publicación. Los identificadores técnicos internos (`ctr`, ids de evento) permanecen intactos en los motores;
sólo se tradujo la capa que ve el usuario.

## Después de PVA-1 (no iniciado aquí)

La siguiente gran etapa es el **Centro de Integraciones Autónomas** (Meta/Google Ads/Analytics/Search
Console/LinkedIn/TikTok/WhatsApp/email/CRM/sitio/modelos/pasarelas). Condición intransable, coherente con la
visión: **las integraciones no cambian el comportamiento del producto**. Los proveedores son adaptadores
reemplazables detrás de M4-D (patrón del ADR-003), no nuevos flujos de usuario. El usuario nunca «entra al
módulo Meta Ads»: sigue hablando con SOEC y recibiendo resultados, decisiones y explicaciones. Requiere
ratificación humana del modo REAL antes de comenzar.
