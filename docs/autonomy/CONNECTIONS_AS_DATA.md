# SOEC · Las conexiones como dato (Autonomy Fase B)

**Fecha:** 2026-09-21 · **Afirmación que esta fase deja demostrada:** *después de crear una empresa desde SOEC, se le pueden conectar sus fuentes y habilitar sus capacidades operativas desde SOEC — sin escribir TypeScript, sin editar un registro, sin añadir variables de entorno por empresa y sin desplegar.*

Contexto: [BUSINESS_AS_DATA.md](BUSINESS_AS_DATA.md) (el negocio como dato) · [RUNTIME_FOUNDATION.md](RUNTIME_FOUNDATION.md) (runtime autónomo) · [../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md](../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md).

---

## 1. Inventario: las siete dependencias del registro

La Fase A dejó el negocio como dato pero declaró explícitamente lo que NO había migrado: fuentes, credenciales y experiencias habilitadas. Eran siete puntos de resolución que leían módulos TypeScript. Dónde viven ahora:

| # | Dependencia | Qué obtenía del módulo | Dónde vive ahora | Consumidor |
|---|---|---|---|---|
| 1 | `getBusiness` | identidad, estado, experiencias, pausa de seguridad | `business_profile` + `business_capability` + `business_governance`, proyectados | `plataforma-routes` (5 rutas), `acquisition-routes`, binding |
| 2 | `bindExperienciaReal` | negocio + experiencia habilitada + perfil | igual, vía proyección; con negativas semánticas nuevas | 34 rutas de experiencias REALES |
| 3 | `experienciasHabilitadas` | array literal por empresa | `business_capability` (una fila por capacidad) | binding, `/plataforma/negocio` |
| 4 | `getProfile` | política de evaluación | **sigue en el módulo** para las tres históricas; ausente ⇒ `PROFILE_INCOMPLETE` | autonomía de ads, director real, plan de acción |
| 5 | `buscarFuenteGrowth` | endpoint, ruta, allowlist, referencia de credencial | `business_connection` (`GROWTH_M2M`) | ingesta server-side, `/medicion/*` |
| 6 | `getRecursoGoogleAds` | customer id, login, campaña gobernada | `business_connection` (`GOOGLE_ADS`) | 8 módulos (campaña, autonomía, director, medición) |
| 7 | `construirIngestaGoogleAds` | fuente + recurso de Ads | igual, sobre la conexión persistida | refresco manual de `/medicion` |

El punto 4 es la deuda que esta fase **no** cierra y deja declarada: el objetivo, el criterio, los límites de autonomía y el contexto del director de SmileFlow siguen viviendo en su módulo. No es configuración de conexión: es política de evaluación, y tiene su propio trabajo pendiente. Una empresa nueva no la hereda de nadie — se le dice que falta.

## 2. Cómo se cambió la fuente sin tocar 34 rutas

El sistema ya tenía **una** puerta de resolución `organización → negocio / perfil / fuentes`: `crearResolutorDeNegocios(configs)`, una función pura sobre un conjunto de configuraciones. Esta fase no la reemplaza: **le cambia la fuente**.

```
PostgreSQL (perfil · conexiones · capacidades · gobierno)
      │  construirSnapshotDeNegocios()          ← proyección pura y testeable
      ▼
fijarNegociosDelRuntime(configs, procedencia)   ← plataforma/registro.ts
      ▼
getBusiness · getProfile · buscarFuenteGrowth · getRecursoGoogleAds · bindExperienciaReal
      ▼
las 34 rutas, la ingesta, el monitor de seguridad y el ciclo del director — sin un cambio
```

El snapshot se fija **antes de atender la primera petición** y se refresca cada 60 s, más un refresco inmediato tras cada cambio hecho desde la interfaz. Si la lectura de la base falla, **se conserva el snapshot vigente**: un fallo de lectura no puede dejar a las empresas sin configuración (eso apagaría la medición y la vigilancia de gasto).

## 3. Modelo persistido

`business_connection` (una por organización y proveedor) · `business_capability` (una por organización y capacidad) · `business_connection_ciphertext` (sólo ciphertext). Migración `apps/api/src/conexion/conexion-pg.ts` (`0001_connections_as_data`).

- **Proveedores**: `GOOGLE_ADS`, `META_ADS`, `GROWTH_M2M` operativos; `GA4`, `SEARCH_CONSOLE`, `MERCHANT_CENTER`, `WOOCOMMERCE`, `CRM` declarados, para que la próxima conexión sea una fila y no una migración.
- **Estados**: `NOT_CONNECTED`, `PENDING`, `CONNECTED`, `ERROR`, `DISABLED`. Significan cosas distintas y ninguno significa «cero»: una conexión en error tuvo credencial y dejó de funcionar; una no conectada nunca la tuvo; una apagada la apagó una persona.
- **Configuración**: pública y por proveedor (endpoint, ruta, allowlist de hosts, identificadores de cuenta y campaña). En esta columna no entra ningún secreto.

## 4. Secretos: cifrados, por tenant, sin una variable por empresa

Se reutiliza **el mecanismo que ya protege los tokens de Google Ads y Meta**: `EnvelopeSecretBackend` — AES-256-GCM con una data key aleatoria por secreto, envuelta por una master key que vive en un KMS real detrás de `KmsPort`. Lo único propio es la tabla de ciphertext.

- La conexión guarda una **referencia opaca** (`secretstore:<org>/<nombre>`); el valor sólo existe dentro de la caja opaca `SecretoResuelto.usar`.
- La resolución es **por tenant**: una organización no puede resolver la referencia de otra (probado).
- **Sin KMS configurado no se guarda ninguna credencial.** No hay modo degradado que la escriba en claro «mientras tanto»: la API responde `503 DEPOSITO_NO_DISPONIBLE` y lo dice en la interfaz.
- La lectura en runtime usa un almacén **compuesto**: `env:` (credenciales históricas) + `secretstore:` (depósito cifrado). Una referencia de esquema desconocido se rechaza, no se prueba con el primero que haya.

**Ninguna empresa nueva necesita una variable de entorno.** Las `SMILEFLOW_*` y `CP_ODONTOLOGIA_*` siguen siendo legado de las dos empresas históricas.

## 5. Capacidades: lo que antes era un array en código

| Capacidad | Qué habilita | Conexión que exige |
|---|---|---|
| `MEDICION_REAL` | experiencia de medición real | — |
| `DIRECTOR_REAL` | experiencia del director | — |
| `AUTONOMIA_ADS` | preparar y evaluar cambios de publicidad | `GOOGLE_ADS` |
| `PILOTO_DECISION` | experiencia histórica del piloto | — |
| `INGESTA_GROWTH` | que la ingesta server-side lea su sitio | `GROWTH_M2M` |
| `MONITOR_SEGURIDAD` | que el monitor de stop-loss lo **observe** | `GOOGLE_ADS` |
| `CICLO_DIRECTOR` | que el ciclo del director corra solo | — |

Dos separaciones deliberadas:

1. **Capacidad ≠ conexión.** Conectar una fuente no enciende nada; encender una capacidad no conecta nada. Si una capacidad está encendida y falta su conexión, la interfaz lo dice en lugar de fingir que funciona.
2. **Capacidad ≠ gobierno.** `MONITOR_SEGURIDAD` permite observar; **pausar** sigue exigiendo `business_governance.automatic_safety_pause`. Ninguna capacidad autoriza gasto ni mutaciones externas: eso lo decide el gobierno, que esta fase no toca.

## 6. Negativas que dicen la verdad

`bindExperienciaReal` era la puerta de 34 rutas y respondía «la organización no está registrada como negocio» —un detalle de implementación— a una empresa que existía y sólo le faltaba conectar algo. Ahora:

| Situación | Respuesta |
|---|---|
| no existe ningún negocio con esa clave | `404 ORGANIZATION_NOT_CONFIGURED` |
| existe, pero la capacidad no está habilitada | `403 CAPABILITY_NOT_ENABLED` (nombra la capacidad) |
| capacidad habilitada, falta la conexión que exige | `409 CONNECTION_REQUIRED` |
| todo habilitado, falta su política de evaluación | `409 PROFILE_INCOMPLETE` (dice qué falta) |
| experiencia fuera del vocabulario | `403 EXPERIENCE_BINDING_DENIED` (llamada mal formada) |

Y `/plataforma/negocio` responde **200** para una empresa creada desde la interfaz: negocio válido, fuentes vacías, capacidades apagadas. Antes era un 404.

### Apagar apaga

Una conexión `DISABLED` **sustituye** a la fuente del módulo histórico en lugar de dejarla al descubierto: si
apagar la conexión hiciera volver a valer la fuente del código, apagar no apagaría nada. Y una fuente GROWTH
declarada pero **sin lectura** (apagada, sin credencial) resuelve a «no hay ingesta» (`null`), no a una avería:
antes lanzaba, y un error ahí abortaba el tick de ingesta de todas las empresas. Una fuente **conectada** pero
mal declarada (sin allowlist, sin la credencial que dice exigir) sigue lanzando, porque eso sí es un defecto.

## 7. Descubrimiento de los bucles: ninguna organización en el código

| Bucle | Antes | Ahora |
|---|---|---|
| ingesta server-side | descubría de la base (Fase 0) | + exige `INGESTA_GROWTH` |
| monitor de seguridad | `'org-smileflow'` literal | organizaciones con `MONITOR_SEGURIDAD` |
| ciclo del director | `'org-smileflow'` literal | organizaciones con `CICLO_DIRECTOR` |
| scheduler de Google Ads | conexiones OAuth persistidas | igual (ya era dato) |
| scheduler de Meta | conexiones OAuth persistidas | igual (ya era dato) |

La cobertura de HOY es idéntica a la de ayer, porque la migración habilitó exactamente lo que cada empresa ya tenía. La diferencia es que ampliarla ya no es un deploy. Crear una empresa **no** enciende su director ni su monitor: nacen apagados.

**Compatibilidad acotada y medida.** Para las capacidades de LECTURA existe una puerta de respaldo: una empresa **migrada** sin ninguna fila de capacidades se sigue considerando elegible (si la migración no corriera, no puede apagarse la ingesta de quien hoy ingiere). Una empresa creada desde la interfaz **no** entra por esa puerta. Ninguna capacidad que produzca una mutación externa la usa.

## 8. Telemetría de la dependencia legado

`estadoDeCompatibilidadLegado()` dice, por organización, su procedencia (`PERSISTIDA`, `PERSISTIDA_CON_REGISTRO`, `REGISTRO`), **qué campos** sigue tomando del módulo histórico y **cuántas veces** se ha resuelto con él. Se expone por `GET /conexiones/procedencia`, acotado a la propia organización.

Para una empresa nueva: `PERSISTIDA`, cero campos, cero usos. Es la medida que convierte «no depende del registro» en algo comprobable en lugar de una afirmación de diseño.

## 9. Migración de las tres empresas históricas

`migrarConexionesDelRegistro` corre en cada arranque, es idempotente y **nunca sobrescribe** una fila existente.

- **No mueve secretos.** Conserva la referencia histórica (`env:SMILEFLOW_GROWTH_TOKEN`, `env:CP_ODONTOLOGIA_GROWTH_TOKEN`) tal cual. Re-cifrar un token en una migración automática es exactamente la operación que puede dejar a una empresa sin ingesta sin que nadie lo note; el traslado al depósito cifrado ocurre cuando una persona vuelve a guardar la conexión.
- **Sólo lo conectado es conexión.** El GA4 y el Google Ads «no configurados» de CP no se convierten en conexiones: no lo son.
- **Nada se enciende de más.** SmileFlow conserva sus cuatro experiencias, su ingesta, su monitor y su ciclo de director; CP conserva su ingesta y **no** adquiere pausa automática ni ciclo de director; C Y P sigue sin experiencias reales.
- Una empresa sin perfil persistido se **omite con su motivo** en lugar de tumbar el arranque.

## 10. Interfaz

`/negocios/conexiones` — «Conectar fuentes y permisos», accesible desde la preparación del negocio y como paso siguiente del alta (una empresa recién creada no tiene panel que mirar; tiene fuentes que conectar).

Pide la dirección del sitio y la clave de acceso; la clave se escribe una vez y no vuelve a mostrarse. Botones: guardar, **probar** (una lectura mínima, sin mover cursores ni escribir en el proveedor) y apagar-y-olvidar-la-clave. Debajo, los permisos con su explicación en lenguaje de negocio y el aviso «encendido, pero falta conectar X» cuando corresponde.

## 11. Superficie HTTP

| Ruta | Autoridad | Qué hace |
|---|---|---|
| `GET /conexiones` | gateway | estado de conexiones y capacidades (sin secretos) |
| `POST /conexiones/growth` | gateway + `business.manage` | guarda endpoint y, si viene, cifra la clave |
| `POST /conexiones/google-ads` | gateway + `business.manage` | declara cuenta y campaña gobernada |
| `POST /conexiones/:provider/probar` | gateway + `business.manage` | lectura de prueba; persiste el resultado |
| `POST /conexiones/:provider/deshabilitar` | gateway + `business.manage` | apaga y olvida la credencial |
| `PATCH /capacidades` | gateway + `business.manage` | enciende o apaga una capacidad |
| `GET /conexiones/procedencia` | gateway | telemetría legado de la propia organización |

La organización sale del contexto que produjo el gateway, nunca de la URL ni del cuerpo. Google y Meta conservan su propio flujo OAuth: aquí se **lee** su estado, no se duplica.

## 12. Qué queda por hacer

La política de evaluación (objetivo, criterio, límites de autonomía, contexto del director) sigue siendo código para las tres empresas históricas, y una empresa nueva todavía no la tiene: por eso su binding responde `PROFILE_INCOMPLETE`. Ésa es la siguiente pieza — y sigue sin haber onboarding inteligente, investigación, generación creativa ni creación de campañas.

Una empresa nueva ya se incorpora y se conecta sola. Todavía no se promociona sola.
