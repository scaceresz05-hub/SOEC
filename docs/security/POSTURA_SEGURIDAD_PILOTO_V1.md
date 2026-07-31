# Postura de seguridad de V1 (piloto)

Este documento declara explícitamente la postura de seguridad del runtime SOEC en su versión
piloto, tras la auditoría del bloque de Configuración de Programas por Negocio.

## Postura

Este runtime corresponde a un **entorno de demostración y piloto con datos sintéticos**.

- **No existe autenticación ni autorización multi-tenant en `/experience/*`.**
- El identificador de organización suministrado en la URL (`:org`) **no se valida** contra una
  identidad autenticada. El `EventStore` aísla los datos por `organization_id` (una organización
  no puede leer los streams de otra usando su propio contexto), pero **cualquiera que conozca un
  identificador de organización puede nombrarlo directamente en la URL** y operar sobre él.

## Por tanto, en esta versión

- no usar datos personales;
- no usar información comercial sensible;
- no registrar organizaciones reales;
- no exponer este runtime como SaaS multi-tenant;
- no habilitar ejecución productiva;
- no conectar canales reales.

## Antes de incorporar clientes reales

Debe implementarse, como **bloque transversal separado con su propio diseño y Pull Request**:

- autenticación,
- autorización,
- y resolución segura de la organización a nivel de aplicación (la organización debe derivarse de
  la identidad autenticada, no del parámetro de URL).

Esta limitación **no fue introducida por el bloque de Configuración de Programas**: es la postura
pre-existente de toda la capa `/experience/*` (acceso abierto, demostración sintética). El bloque
de programas la hereda y la hace visible en la UI (aviso permanente) y aquí.

## Alcance de la autonomía / PAUSA en V1

La autonomía y la PAUSA operan **a nivel de organización**. Las rutas que contienen `programaId`
(`/programas/:programaId/pausar` y `/reanudar`) conservan el contexto desde el cual se solicitó la
operación, pero **no proporcionan aislamiento de autonomía por programa**: pausar detiene la
ejecución autónoma de **todos** los programas de la organización. Las respuestas de estas rutas lo
declaran explícitamente con `alcance: "ORGANIZACION"`. La autonomía por programa queda registrada
como **evolución futura**, no como capacidad actual.
