# Depósito local de credenciales por organización

SOEC **nunca** busca credenciales por tu computador, ni lee el portapapeles, ni inspecciona el
navegador, ni las pide por chat. Las credenciales entran por un único lugar: un archivo local que
llenás vos, fuera del repositorio.

## Dónde

```
<raíz del repo>/.secrets/<organizationId>.env
```

Un archivo **por organización**. `.secrets/` está en `.gitignore`: nada de ese directorio se
versiona, se registra en logs ni se serializa en respuestas.

## Formato

Una línea por credencial, con el **nombre lógico** exacto. Sin comillas, sin espacios alrededor del
valor. `#` inicia un comentario.

```
nombre-logico=valor
```

## Distribuidora C Y P — WooCommerce (solo lectura)

Archivo: `.secrets/org-cyp.env` (ya creado, con los nombres puestos y los valores vacíos).

```
woocommerce-cyp-consumer-key=
woocommerce-cyp-consumer-secret=
```

Pegá cada valor después del `=` y guardá. No hace falta reiniciar nada.

## Cómo lo usa SOEC

La configuración de la organización declara **referencias opacas**, nunca valores:

```
file:org-cyp/woocommerce-cyp-consumer-key
file:org-cyp/woocommerce-cyp-consumer-secret
```

`SecretStoreArchivo` (`@soec/secretos`) las resuelve exigiendo **triple coincidencia** de
organización — la del `RequestContext`, la de la instancia del store y la de la propia referencia.
Cualquier discrepancia lanza `SecretoDeOtraOrganizacionError` **antes** de tocar el archivo.

El valor sólo existe dentro de `SecretoResuelto.usar(fn)`. Su `toString`, `toJSON` e `inspect` están
redactados, y `usar` rechaza devolver el propio secreto en claro.

## Garantías verificadas por prueba

`apps/api/test/deposito-secretos.test.ts` (16 pruebas):

- una organización no resuelve la credencial de otra, en ninguna de las dos direcciones;
- organización sin depósito ⇒ error explícito, **sin fallback** al entorno ni a otro tenant;
- nombre ausente o valor vacío ⇒ error; nunca una cadena vacía silenciosa;
- el valor no aparece en `toString`, `JSON.stringify`, `inspect`, mensajes de error ni *stack traces*;
- una referencia con forma de secreto se rechaza (no se puede camuflar un valor como referencia);
- el estado del depósito informa presencia con booleanos: sin valores, longitudes ni prefijos.

## Consultar el estado (sin revelar nada)

```bash
curl -H "x-organization-id: org-cyp" -H "x-actor-id: yo" -H "x-scope: events:read" http://localhost:3081/plataforma/credenciales
```

Devuelve qué credenciales exige cada fuente y cuáles ya están depositadas — nombres lógicos y
booleanos, nada más.

## Qué NO hacer

- No pegar credenciales en el chat, en un commit, en un issue ni en documentación.
- No reutilizar las credenciales de una organización para otra.
- No mover el archivo dentro de `apps/`, `packages/` ni ningún directorio versionado.
