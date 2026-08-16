# SOEC — Backend productivo de secretos sobre AWS KMS

Backend **productivo elegido** para el almacenamiento de secretos de SOEC (p. ej. el token OAuth de Meta).
**Sin valores secretos en este documento.** No declarar `READY` hasta correr el smoke real contra AWS.

## Decisión

- **AWS KMS = backend productivo.** HCP Vault Transit (`meta-vault-transit.ts`) **se conserva** como adapter
  alternativo/legacy, pero **no** es el backend elegido para este despliegue.
- **`EnvelopeSecretBackend` no se reescribe.** AWS KMS entra como un `KmsPort` más (`AwsKmsPort`), igual que
  Vault. El diseño envelope es idéntico.

## Diseño envelope (invariante)

```
token OAuth efímero → AES-256-GCM local con DATA KEY (32 bytes) → ciphertext persistido tenant-scoped en SOEC
DATA KEY → AWS KMS Encrypt → CiphertextBlob → guardado como wrappedDataKey
resolver: wrappedDataKey → AWS KMS Decrypt → DATA KEY → descifrado local → token → uso → descarte
```

**EL TOKEN META JAMÁS VIAJA A AWS KMS** — sólo la data key de 32 bytes. Verificado por código y test
(`aws-kms` matriz G/H). `EncryptionContext` fijo `{app:soec, purpose:envelope-data-key}` (AAD autenticada) en
Encrypt y Decrypt; `KeyId` explícito también en Decrypt (sin decrypt implícito). Cripto oficial de AWS
(`@aws-sdk/client-kms`) — sin SigV4 manual, sin HTTP manual, sin cripto propia.

## Implementación (repo)

| Pieza | Archivo |
|-------|---------|
| Adapter `KmsPort` | `apps/api/src/acquisition/aws-kms.ts` (`AwsKmsPort`, config, errores tipados, `clasificarErrorKms`) |
| Boundary SDK | `apps/api/src/acquisition/aws-kms-sdk.ts` (`ClienteKmsSdk`; único punto que importa `@aws-sdk/client-kms`) |
| Fake (test/dev) | `apps/api/src/acquisition/aws-kms-fake.ts` (`FakeClienteKms`, `ClienteKmsProductivoSimulado`) |
| Smoke | `apps/api/src/acquisition/kms-smoke.cli.ts` → `pnpm -C apps/api kms:smoke` |
| Tests | `apps/api/test/acquisition-aws-kms.test.ts` (matriz adversarial A–V) |

`wrapDataKey`→Encrypt · `unwrapDataKey`→Decrypt · `salud`→DescribeKey · `reenvolverDataKey`→ReEncrypt
(por contrato, **no** en el hot path ni exigido en la policy inicial).

## Variables de runtime

> CONFIG = no secreta · SECRET = provista por el mecanismo seguro del runtime (Railway). Nunca se commitea.

| Variable | Clase | Nota |
|----------|-------|------|
| `AWS_REGION` | CONFIG | región de la CMK |
| `SOEC_KMS_KEY_ID` | CONFIG | `alias/soec-production-secrets` o key ARN/ID |
| `SOEC_KMS_TIMEOUT_MS` | CONFIG | opcional, default 5000 |
| `SOEC_KMS_MAX_ATTEMPTS` | CONFIG | opcional, default 3 |
| `AWS_ACCESS_KEY_ID` | SECRET | credencial de runtime; la resuelve la cadena oficial del SDK |
| `AWS_SECRET_ACCESS_KEY` | SECRET | idem |

El adapter **no** lee credenciales por argumento: el SDK las resuelve por su cadena oficial. Fail-closed si
falta `AWS_REGION`/`SOEC_KMS_KEY_ID`/credenciales → el smoke reporta `CONFIGURATION` (exit 2), sin intentar
conexión.

## IAM mínimo (least privilege)

El camino productivo normal requiere **sólo** estas acciones, sobre **una** key exacta:

```
kms:Encrypt
kms:Decrypt
kms:DescribeKey
```

**No** requiere `kms:*`, `AdministratorAccess`, `PowerUserAccess`, `Resource "*"`, `kms:CreateKey`,
`kms:GenerateDataKey`, `kms:ScheduleKeyDeletion` ni `kms:CreateGrant`. `kms:ReEncrypt` existe por contrato
(rotación futura) pero **no** forma parte del smoke ni del hot path, y **no** debe concederse aún.

Política sugerida (dos statements — `DescribeKey` separado por si se condiciona `EncryptionContext`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "SoecEnvelope", "Effect": "Allow", "Action": ["kms:Encrypt", "kms:Decrypt"],
      "Resource": "arn:aws:kms:<region>:<account>:key/<key-id>",
      "Condition": { "StringEquals": {
        "kms:EncryptionContext:app": "soec",
        "kms:EncryptionContext:purpose": "envelope-data-key" } } },
    { "Sid": "SoecDescribe", "Effect": "Allow", "Action": ["kms:DescribeKey"],
      "Resource": "arn:aws:kms:<region>:<account>:key/<key-id>" }
  ]
}
```

## Aislamiento

- Una **CMK exclusiva de SOEC** (alias `alias/soec-production-secrets`). **No** compartir con SSR Control ni
  SmileFlow. Credenciales/IAM propios de SOEC.

## Provisioning futuro (fuera de este bloque — Claude Chrome / consola AWS)

1. Crear la **CMK** (symmetric, ENCRYPT_DECRYPT) exclusiva de SOEC + alias `alias/soec-production-secrets`.
2. Crear un **IAM user/role** con la policy mínima de arriba; generar access key.
3. Cargar en Railway → `soec-api` → production: `AWS_REGION`, `SOEC_KMS_KEY_ID`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY` (por el mecanismo seguro).
4. Correr **dentro del runtime**: `pnpm -C apps/api kms:smoke` (una vez). Salida estéril; exit 0 = READY.

## Estado

`PRODUCTION_SECRET_BACKEND = IMPLEMENTED_NOT_VERIFIED` — implementado y probado con fake + secretos
sintéticos; **no** verificado contra AWS real. `READY` sólo tras el smoke real (store/encrypt → resolve/decrypt
→ compare → delete) con una CMK y credenciales reales. Sin llamadas AWS reales en este bloque.
