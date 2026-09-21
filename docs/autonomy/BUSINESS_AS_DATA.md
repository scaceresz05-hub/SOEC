# SOEC · El negocio como dato (Autonomy Fase A)

**Fecha:** 2026-09-21 · **Afirmación que esta fase deja demostrada:** *para incorporar una empresa nueva a SOEC ya no hace falta escribir TypeScript, editar un registro ni desplegar una versión.* Crearla sigue requiriendo a una persona —es su decisión—, pero incorporarla técnicamente, no.

Contexto: [SOEC_AUTONOMY_GAP_AUDIT.md](../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md) · [RUNTIME_FOUNDATION.md](RUNTIME_FOUNDATION.md).

---

## 1. Inventario: dónde vivía cada cosa

| Atributo | Antes | Ahora | Clase |
|---|---|---|---|
| identidad (organizationId, businessKey) | módulo TS por empresa | `business_profile` | BUSINESS_DATA |
| nombre, razón social, tipo, mercado | módulo TS | `business_profile` | BUSINESS_DATA |
| objetivo comercial | módulo TS | `business_profile.primary_objective` + `business_objective` | BUSINESS_DATA |
| especialidad y líneas declaradas | módulo TS (`especialidad`, `categoriasDeclaradas`) | `business_offering` | BUSINESS_DATA |
| territorio comercial | módulo TS (`alcanceComercial`) | `business_geo_scope` (ámbito `BUSINESS`) | BUSINESS_DATA |
| territorio ejecutable en una plataforma | módulo TS aparte (`org-cp-odontologia-google-ads.ts`) | `business_geo_scope` (ámbito `ADVERTISING`) | BUSINESS_DATA |
| restricciones y datos pendientes | módulo TS (`datosHumanosPendientes`) | `business_restriction` | BUSINESS_DATA |
| pausa automática de seguridad | módulo TS (`politicaSeguridad`) | `business_governance` | RUNTIME_STATE |
| membresías y roles | PostgreSQL (identidad) | igual | BUSINESS_DATA |
| modo operativo | PostgreSQL (identidad) | igual | RUNTIME_STATE |
| tokens OAuth de Google/Meta | PostgreSQL cifrado con KMS | **igual, intacto** | SECRET |
| token del puente Growth | variable de entorno / depósito | **igual, intacto** | SECRET |
| fuentes de datos y experiencias habilitadas | módulo TS | módulo TS (legado declarado) | LEGACY |
| métricas, cursores, snapshots | event store | igual | DERIVED_DATA |

**Frontera de secretos:** en las tablas del negocio no entra ningún secreto. El perfil puede referirse a una conexión por su identificador; nunca guarda su valor.

## 2. Esquema

`business_profile` (una fila por empresa) · `business_objective` · `business_offering` · `business_geo_scope` · `business_restriction` · `business_governance` · `business_audit`. Migración `apps/api/src/negocio/negocio-pg.ts` (`0001_business_as_data`).

- **Oferta** (`business_offering`): sirve a un producto físico, a un servicio profesional y a un SaaS — `slug`, `name`, `category`, `status`, `landingUrl`, `priority`, `geographicScope`, `advertisingEligibility` y `restrictions`. Nada de «implantes» ni «software dental» escrito en código.
- **Geografía** (`business_geo_scope`): `BUSINESS`, `ADVERTISING` y `EXCLUSION` son ámbitos distintos, porque **el alcance comercial no es el alcance ejecutable**. CP es el caso que lo prueba: 9 comunas de negocio, 6 ejecutables en Google Ads.
- **Restricciones** (`business_restriction`): `FACT`, `RESTRICTION`, `APPROVED_CLAIM` y `PROHIBITED_CLAIM` separan el hecho de la prohibición y del claim aprobado. Ahí caben «no Fonasa», «precio no confirmado» o «este claim requiere aprobación».

## 3. Ciclo de vida e identidad

Estados: `DRAFT → CONFIGURING → READY → ACTIVE → SUSPENDED`. Una empresa nueva nace en `DRAFT`; las migradas entran como `ACTIVE` porque ya operan.

- `organization_id` es la **clave de tenant** (el slug que ya usa todo el sistema) y no cambia nunca.
- `business_key` es un identificador **opaco** (UUID) e independiente del nombre y del slug visible.
- El **nombre comercial sí puede cambiar** sin tocar ninguno de los dos.
- El slug se deriva del nombre + un sufijo aleatorio: dos empresas con el mismo nombre no colisionan y el identificador no se adivina desde el nombre. La autorización nunca depende del slug: depende de la membresía.

## 4. Alta: una transacción

`POST /negocios` ejecuta en **una** transacción: organización + membresía OWNER + perfil + postura de gobierno + auditoría. Si algo falla, no queda nada a medias (probado: una entrada inválida deja cero organizaciones).

**Postura segura por defecto**, sin excepciones: `externalMutations`, `autonomousSpend`, `automaticSafetyPause` y `campaignExecution` en `false`. Crear una empresa no puede producir gasto ni tocar ninguna plataforma.

## 5. API

| Ruta | Autoridad | Qué hace |
|---|---|---|
| `POST /negocios` | sesión | crea la empresa (transacción completa) |
| `GET /negocios` | sesión | lista **sólo** las empresas del usuario, por membresía |
| `GET /negocios/:org` | gateway (sesión + membresía) | lee el negocio completo |
| `PATCH /negocios/:org` | gateway + `business.manage` | edita el perfil; la identidad no se toca |

Crear y listar dependen sólo de la sesión porque al dar de alta la primera empresa todavía no hay organización activa. Leer y editar van dentro del gateway: la organización de la URL nunca es autoridad.

## 6. Descubrimiento en runtime

`crearDescubridorDeNegocios(pool)` devuelve las organizaciones con perfil persistido. La ingesta server-side ya no recorre un array en código: pregunta a la base, así que una empresa creada desde la interfaz entra en el siguiente tick sin desplegar.

La pausa automática de seguridad la decide ahora `business_governance`, con el registro histórico como respaldo mientras dure la migración (y si la base falla, quien estaba protegido sigue protegido).

**Compatibilidad declarada:** el descubridor devuelve la unión de lo persistido y el registro TypeScript. Existe por seguridad durante la transición —si una migración no corrió, la empresa histórica sigue siendo descubierta—, no por diseño. Una empresa nueva no depende del registro en ningún punto.

## 7. Migración de SmileFlow y CP

`migrarNegociosDelRegistro` corre en cada arranque, es idempotente y **nunca sobrescribe** un perfil existente: lo que el usuario edite manda. Conserva identidad (`organizationId`), tipo, objetivo, territorio, oferta declarada y restricciones. SmileFlow conserva su pausa automática; CP no la tenía y sigue sin tenerla. No se crean organizaciones nuevas, no se regeneran identificadores y no se toca ninguna campaña.

Lo que **no** migra todavía, y por qué: fuentes de datos, credenciales y experiencias habilitadas siguen en el registro. Es configuración operativa con secretos asociados, con su propio trabajo pendiente. Está documentado como legado y sólo afecta a las dos empresas históricas.

## 8. Interfaz

`/negocios/nueva` — «+ Nueva empresa», accesible desde la home. Pide lo que un dueño sabe responder: nombre, tipo de negocio, país, moneda, zona horaria, sitio y, si quiere, a qué se dedica y qué quiere conseguir. **No** pide customer id de Google Ads, identificadores de Meta, CPC, etiquetas de conversión, tokens, MCC ni UTM: eso pertenece a conectar las cuentas, después.

Al guardar: la empresa queda creada, el usuario es OWNER, la empresa pasa a ser la activa y su panel se abre.

## 9. Sin variables de entorno por empresa

Una empresa nueva no necesita ninguna variable nueva. Las conexiones futuras serán persistentes y por tenant, como ya lo son las de Google Ads y Meta (OAuth cifrado en PostgreSQL). Las variables `SMILEFLOW_*` y `CP_ODONTOLOGIA_*` son **legado** de las dos empresas históricas y se mantienen sólo por compatibilidad.

## 10. Auditoría

`business_audit` registra `BUSINESS_CREATED`, `BUSINESS_UPDATED` y `BUSINESS_STATUS_CHANGED` con actor, organización, campos cambiados y timestamp. Sin secretos (hay un test que lo comprueba).

## 11. Qué sigue

Esta fase deja el negocio como dato. Todavía **no** hay onboarding inteligente, investigación, generación creativa ni creación de campañas: una empresa nueva se incorpora sola, pero aún no se promociona sola.
