# SOEC · Aceptación extremo a extremo del marketing autónomo (Autonomy Fase H)

**Fecha:** 2026-09-22 · **Lo que esta fase hace:** no añade motores. Comprueba que los que ya existen —negocio
como dato (A), conexiones (B), política de evaluación (C), onboarding (D), investigación y plan (E), ejecución
(F) y optimización (G)— **encajan entre sí en un recorrido completo**, y dice con precisión dónde no.

Las tres preguntas se responden **por separado**, y un PASS en una no vale para las otras:

| Nivel | Pregunta | Veredicto |
| --- | --- | --- |
| **A · Aceptación de producto** | ¿Una empresa nueva puede recorrerlo todo por las rutas reales, sin desarrollador? | **PASS** |
| **B · Canario externo en vivo** | ¿Se demostró con una cuenta externa real? | **BLOCKED_EXTERNAL** |
| **C · Preparación comercial de CP** | ¿Está CP Odontología lista para que SOEC lleve su marketing? | **NOT_READY** (con lista exacta) |

---

## 1. El recorrido completo, por las rutas reales

`apps/api/test/end-to-end-acceptance.pg.test.ts` · «Empresa QA Full Autonomy» nace con un registro, y desde ahí
recorre las 33 etapas **por HTTP**, contra PostgreSQL real, con los servicios y repositorios reales. Lo único
simulado es el mundo exterior (Google) y los proveedores de investigación, que son deterministas.

Alta → onboarding (7 pasos) → política de evaluación → conexión → capacidades (**lectura y escritura son
permisos distintos**) → modo operativo → gobierno → mandato → investigación → plan → material → medición →
preparar → autorizar → ejecutar → campaña **EN PAUSA** → reconciliación → activación → política de autonomía →
ciclo de optimización → evidencia → decisión → aprobación → aplicación → verificación → aprendizaje.

Dos exigencias que hacen que la prueba valga:

* **El proceso se reinicia cinco veces** en mitad del recorrido (`await app.close()` y se levanta de nuevo). Si
  algo viviera en memoria, el recorrido se rompería ahí. No se rompe: todo está en PostgreSQL.
* **Nada se concede solo.** Al terminar: `autonomousSpend = false`, la activación automática sigue prohibida,
  el gasto autorizado nunca se supera y no hubo ni una escritura externa que no estuviera aprobada.

## 2. Linaje: desde la última decisión hasta la primera respuesta

Segunda prueba del mismo archivo. Se toma la última acción aplicada y se reconstruye hacia atrás:

```
acción → decisión → ciclo → snapshot → campaña → petición de ejecución → plan → investigación → política → onboarding → perfil
```

Cada eslabón existe y apunta al anterior. Y se comprueba lo contrario: en once tablas **no hay una sola fila de
otra empresa**, y ningún aprendizaje quedó huérfano de su decisión.

## 3. Aislamiento entre empresas, con identificadores REALES

«Empresa QA Neighbor» intenta las 18 rutas usando los **identificadores verdaderos** de la otra empresa —el id
de su petición de ejecución, el de su acción pendiente, el de su plan—. Todas responden 403 o 404. Después:
cero filas creadas para el vecino, y la campaña de la primera empresa intacta. Adivinar un id no sirve de nada.

## 4. Matriz de fallos: cómo se rompe

`apps/api/test/acceptance-failure-matrix.pg.test.ts` · 15 fallos controlados. Para cada uno se comprueba si
cierra o sigue, si deja camino de vuelta, si duplica recursos y si lo que se muestra sirve para arreglarlo.

| Fallo | Comportamiento | Recuperación |
| --- | --- | --- |
| Google 403 (sin permiso) | fail-closed: no se crea acción de conversión | reintentable |
| Google 429 (cuota) | fail-closed, con el motivo | reintentable |
| Google 500 | fail-closed | reintentable |
| Timeout | fail-closed | reintentable |
| OAuth caducado | fail-closed | reconectar |
| Sitio del negocio caído | **fail-soft**: la investigación sigue y marca `WEBSITE_AUDIT: FAILED` | reinvestigar |
| Proveedor de demanda ausente | **fail-soft**: `UNAVAILABLE`, sin inventar volúmenes | reinvestigar |
| Consulta de territorios falla | **fail-soft**: `FAILED`, sin geografía inventada | reinvestigar |
| Investigación vieja | el plan y la ejecución se bloquean (`PLAN_CURRENT: ACTION_REQUIRED`) | reinvestigar |
| Plan viejo | ídem, antes de tocar la plataforma | replanificar |
| Medición degradada | hay decisiones de tráfico; **ninguna por conversiones** | arreglar la señal |
| Mandato vencido | ni se ejecuta ni se enciende (409) | renovar |
| Interruptor del despliegue cerrado | **ninguna** ruta escribe; el ciclo sigue observando | abrirlo |
| Creación rechazada por la plataforma | `FAILED`, sin recursos a medias | volver a preparar: **una sola** campaña |
| La plataforma acepta y no aplica | la verificación lo detecta: `DIVERGED` | queda registrado |
| Cambio hecho fuera de SOEC | se detecta y **se muestra**; no se sobrescribe | decisión humana |

## 5. Invariantes que ninguna ruta puede violar

Probados contra el sistema real, no contra una maqueta:

1. Ninguna campaña nace `ENABLED` —ni la campaña ni sus grupos—, y ninguna ruta escribe ese estado.
2. Completar el recorrido entero **no** concede autonomía: gasto autónomo `false`, activación automática `false`,
   máximo de cambio de presupuesto `0 %`.
3. Sin la capacidad de escritura no existe camino que llegue a la plataforma (ni medición, ni activación).
4. La medición no se marca verificada sin señal observada: sin eventos, no hay `VERIFIED`.
5. El presupuesto materializado por el período nunca supera el tope autorizado.
6. La única puerta de encendido vive en el servicio de optimización y exige sus ocho condiciones.

## 6. Aceptación de seguridad

* Sin sesión, ninguna superficie de negocio responde (401/403).
* Un miembro con rol de sólo lectura **ve** el director y **no puede** preparar, ejecutar, correr el ciclo ni
  activar: 403 en las cuatro, y la campaña sigue pausada.
* Ninguna respuesta de las superficies nuevas devuelve secretos, ni en forma de campo ni en forma de token.
* La ingesta del sitio conserva sus defensas: `http`, `localhost`, IP privada y texto que no es una dirección se
  rechazan antes de salir a la red.
* Los secretos de conexión se guardan cifrados (sobre con KMS); las rutas sólo dicen si están configurados.

## 7. Una sola fuente de verdad

Cuarta prueba del recorrido: para una empresa nueva, **quince tablas** de PostgreSQL tienen sus filas —perfil,
oferta, territorio, restricciones, gobierno, conexiones, capacidades, política, investigación, plan, ejecución,
conversiones, medición, mandato y optimización— y el registro histórico de TypeScript registra **cero usos** y
**cero campos** para ella. Una empresa nueva ya no necesita código.

## 8. Experiencia de uso y tamaños de pantalla

Medido sobre la interfaz **en producción**, con sesión real, en las cinco pantallas del recorrido (`/negocios`,
`investigacion`, `plan`, `campana`, `director`) y en los tres tamaños pedidos:

| Ancho | Desbordamiento horizontal | Observación |
| --- | --- | --- |
| 360 × 800 | ninguno en las 5 pantallas | la tira de pestañas se desplaza sola (`overflow-x: auto`) |
| 390 × 844 | ninguno en las 5 pantallas | ídem |
| 768 × 1024 | ninguno en las 5 pantallas | — |

*Método:* la ventana de Chrome no admitía redimensionado en este equipo, así que cada pantalla se cargó en un
marco del mismo origen con el tamaño exacto, que es lo que responden las media queries; se midió
`scrollWidth` contra `clientWidth` y se listaron los elementos que se salen.

**Hallazgo de usabilidad (no bloqueante):** hay botones y enlaces de menos de 32 px de alto —19 en la pantalla de
campaña, 9 en investigación y en director, 8 en plan, 4 en el panel—. Se leen bien, pero quedan por debajo del
objetivo táctil recomendado. Queda anotado, no corregido: esta fase no rediseña.

`PHYSICAL_DEVICE_QA = PENDING_EXTERNAL`. Un teléfono de verdad no se puede simular, y no se va a fingir que se
probó en uno.

## 9. Canario externo en vivo

`LIVE_CANARY = BLOCKED_EXTERNAL`. No existe una cuenta de anuncios externa **autorizada y segura** para crear
una campaña de prueba: SmileFlow tiene una campaña real pausada que no se va a ensuciar, CP no tiene cuenta de
Google Ads, y crear una cuenta nueva exige una autorización que nadie ha dado. `EXTERNAL_SPEND = 0`,
`EXTERNAL_WRITES = 0`: durante toda la fase no se escribió nada en ninguna plataforma externa.

Sí se confirmó, sólo con lecturas, que el mundo real sigue donde estaba: la campaña de SmileFlow
(`24194332264`) sigue **pausada**, con $7.760 de gasto, su monitor activo y su ciclo en modo sombra esperando
evidencia.

## 10. Preparación comercial de CP Odontología

Read model nuevo (`GET /aceptacion/preparacion`, sólo lectura, 18 ítems). Calculado sobre los datos **reales**
persistidos de CP el 2026-09-22, leídos por las rutas existentes. **No se rellenó ni un dato de CP para que el
informe se viera mejor.**

| Estado | Ítems |
| --- | --- |
| **READY** (7) | perfil · oferta · territorio · objetivo · acción de cliente · límites de comunicación · capacidad de medición |
| **MISSING** (3) | sitio web · política de evaluación (indicador, meta y evidencia mínima) · techo de inversión |
| **HUMAN_ACTION_REQUIRED** (6) | conexión de Google Ads · capacidad de escritura · modo operativo · gobierno de ejecución · mandato financiero · medición verificada (0 de 3 acciones con señal) |
| **SYSTEM_ACTION_REQUIRED** (2) | investigación y plan (la última investigación no pudo completarse) · campaña creada |

Hitos: **crear campaña: NO · encender campaña: NO · operar con autonomía: NO.**
Siguiente paso, y es de la empresa: **indicar la dirección del sitio web**. Sin sitio no hay dónde aterrice el
clic, y sin eso la investigación vuelve a fallar por donde falló.

## 11. Regresión de las empresas reales

* **SmileFlow** — campaña `24194332264` pausada, gasto $7.760, monitor cada 5 min conectado, modo `PILOT`,
  medición aún `ACTION_MISSING`. Igual que antes de esta fase.
* **CP Odontología** — modo `PILOT`, sin conexión de anuncios, sin campaña, sin mandato. Igual que antes.
* **Distribuidora C Y P** — **sí está persistida**: tiene `business_profile`, su conexión `WOOCOMMERCE`
  conectada y sus filas de capacidades (todas apagadas), y el runtime la proyecta desde la base con origen
  `PERSISTIDA_CON_REGISTRO`. No tiene política de evaluación, por decisión declarada desde la Fase C. No es
  visible para la cuenta actual porque no consta ninguna membresía de ese usuario en ella. Si existe una
  organización de identidad o una membresía de otra persona es **UNKNOWN** con las superficies de sólo
  lectura disponibles: ninguna las lista sin membresía y `business_profile` no tiene clave foránea a
  identidad. Esta fase no tocó ni sus datos ni su módulo.

  > Corrección: una versión anterior de este informe afirmaba que C Y P «no tiene organización persistida».
  > Era falso, y el error fue de método: se comprobó su existencia con `GET /negocios`, que lista **por
  > membresía**. Ausencia de membresía no es ausencia de organización.

Ninguna de las tres fue modificada. Las únicas empresas creadas fueron las de prueba, y sólo en la base de datos
de pruebas.

## 12. Defectos reales encontrados y corregidos

La aceptación encontró tres cosas que estaban mal de verdad. Se corrigieron **sólo** esas:

1. **La medición degradada era inalcanzable.** `estadoDeMedicion` daba por buena la verificación histórica
   aunque la instalación dijera «dejó de registrar». Como sólo se llega a `DEGRADED` **después** de verificar,
   el estado no podía observarse nunca: SOEC habría seguido optimizando contra una señal muerta. Ahora manda el
   presente, y el portero de evidencia bloquea de nuevo las decisiones por conversiones.
2. **El readiness afirmaba una falta que no existía.** Decía siempre «falta una autorización de presupuesto
   firmada por una persona», incluso con un mandato vigente, porque el dato ni se leía. Ahora se lee del Safe
   Action Plane.
3. **«No hay un indicador principal» con el indicador elegido.** Cuando la empresa elige su indicador pero
   todavía no conoce la meta, lo que falta es la meta. El mensaje ya lo dice así.

## 13. Lo que esta fase NO demuestra

No demuestra que SOEC funcione con una cuenta externa nueva (nivel B sigue bloqueado) · no demuestra nada en un
teléfono físico · no demuestra que la publicidad genere clientes: demuestra que el sistema puede llegar hasta
ahí sin un desarrollador y sin pasarse de lo autorizado. Y no toca Meta, donde la escritura sigue prohibida.

## 14. Qué queda demostrado por prueba

`end-to-end-acceptance.pg.test.ts` (5 casos sobre PostgreSQL real) · `acceptance-failure-matrix.pg.test.ts`
(26 casos) · `commercial-readiness.test.ts` (13 casos). Regresión completa al cerrar la fase:
**2.914 pruebas unitarias y 358 sobre PostgreSQL, todas en verde.**

## 15. Verificación en producción tras el despliegue

Despliegue `aa8c1176-e2fc-4349-aa79-39244df863e6` (2026-09-22 15:03 UTC), hecho por el propietario.

* `/health` responde `200` con esa versión · **un solo arranque**, sin reinicios, sin errores.
* Migraciones **idempotentes**: `migrados: []` en negocios, conexiones y políticas; `yaEstaban` con las tres
  empresas. Nada se volvió a crear ni a sobrescribir.
* Los bucles arrancaron: monitor de seguridad, ciclo del director, planificador de Google Ads e ingesta de CP.
* Después del despliegue: **0 respuestas 403**, **0 respuestas 429**, **0 escrituras externas**, **$0 de gasto**.

**La ruta nueva, en producción y con sesión real.** `GET /aceptacion/preparacion` responde desde los datos
persistidos de cada empresa, sin registro histórico de por medio. Aislamiento comprobado en vivo:

| Prueba | Resultado |
| --- | --- |
| sin sesión (con y sin cabeceras falsificadas) | `401` |
| empresa sin membresía (`org-cyp`) | `404` |
| empresa inexistente | `404` |
| cabecera `x-organization-id` falsificada hacia otra empresa | `200` **con los datos de la empresa validada**, no la falsificada |

**CP Odontología**, recalculada desde la ruta desplegada: **7 READY · 3 MISSING · 6 de acción humana ·
2 de acción del sistema**, idéntico al cálculo previo al despliegue. Sigue **NOT_READY** para crear, encender y
operar con autonomía, y el siguiente paso sigue siendo suyo: **indicar la dirección del sitio web**. No se le
rellenó ningún dato.

**SmileFlow**, tras el despliegue: campaña `24194332264` **PAUSADA**, gasto $7.760, 136 impresiones, 5 clics,
protección automática ACTIVA con su último chequeo hace un minuto y resultado `NOOP · ALREADY_PAUSED`, el ciclo
en modo sombra esperando evidencia y cero acciones aplicadas.

En su propio informe aparecen `PERFIL_DEL_NEGOCIO`, `OBJETIVO_COMERCIAL` y `TECHO_DE_INVERSION` como
**MISSING**: su fila persistida tiene `description`, `website` y `primaryObjective` en `null` desde la
migración, y hoy esos campos se los sigue prestando el módulo histórico al runtime. No es un defecto del read
model —el motor de readiness ya decía lo mismo antes de esta fase—, sino la deuda de datos que queda a la
vista cuando se lee sólo lo persistido.

### Los cuatro veredictos, separados

| Veredicto | Resultado |
| --- | --- |
| `SOFTWARE_E2E_ACCEPTANCE` | **PASS** |
| `LIVE_EXTERNAL_READ_ACCEPTANCE` | **PASS** (lecturas reales de Google Ads: `estado OK`, 0 · 403, 0 · 429) |
| `LIVE_EXTERNAL_WRITE_ACCEPTANCE` | **BLOCKED_EXTERNAL** (no existe cuenta de anuncios autorizada y segura para el canario; no se crea, y no se usan SmileFlow ni CP) |
| `CP_COMMERCIAL_READINESS` | **NOT_READY**, con su lista exacta |
