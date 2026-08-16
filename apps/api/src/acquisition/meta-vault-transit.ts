/**
 * apps/api · Adaptador PRODUCTIVO `KmsPort` sobre HashiCorp Vault **Transit** (cryptography-as-a-service).
 *
 * IMPORTANTE — Transit NO es un secret store: cifra/descifra, pero el dato cifrado lo persiste la app.
 * Por eso este adaptador NO almacena nada: implementa el `KmsPort` (wrap/unwrap de la DATA KEY) del diseño
 * envelope ya existente (`EnvelopeSecretBackend`), preservándolo sin reescribirlo:
 *
 *   token OAuth efímero → AES-256-GCM local con DATA KEY → ciphertext persistido tenant-scoped en SOEC
 *   DATA KEY → Transit encrypt (wrap) → `vault:vN:…` guardado como `wrappedDataKey`
 *   resolver: `wrappedDataKey` → Transit decrypt (unwrap) → DATA KEY → descifrado local → token → uso → descarte
 *
 * La MASTER KEY permanece SIEMPRE dentro de Vault (Transit nunca la exporta). El token OAuth JAMÁS viaja a
 * Vault: sólo la data key se envía a `encrypt`/`decrypt`. Se usan EXCLUSIVAMENTE las APIs oficiales de
 * Transit (`/v1/<mount>/encrypt|decrypt|rewrap/<key>`, `/v1/sys/health`). Cero criptografía casera.
 *
 * Seguridad (fail-closed): timeout, jamás loggea plaintext/token/ciphertext, no incluye plaintext en
 * excepciones, sanitizer central, distingue Vault-no-disponible de fallo-de-descifrado, rechaza respuestas
 * malformadas, valida el prefijo `vault:vN:` del ciphertext, y soporta rewrap CONTRACTUALMENTE (sin
 * ejecutarlo en el flujo). El transporte HTTP real y las credenciales son PUERTOS inyectados; en tests se
 * usa un fake fiel al contrato. `REAL_VAULT_PROVISIONED = NO` hasta provisionar HCP Vault Dedicated.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KmsPort, SaludBackend } from './meta-secret-backend';
import { redactarSecretos } from './meta-organic';

// ---------------------------------------------------------------------------
// Errores — jerarquía que DISTINGUE indisponibilidad de fallo de descifrado (fail-closed)
// ---------------------------------------------------------------------------

/** Base: sanitiza el mensaje con el sanitizer central (defensa en profundidad). Nunca lleva secretos. */
export class VaultTransitError extends Error {
  constructor(mensaje: string) {
    super(redactarSecretos(mensaje));
    this.name = new.target.name;
  }
}
/** Vault inalcanzable / 5xx / 429 / timeout / red. Estado operacional, potencialmente transitorio. */
export class VaultNoDisponibleError extends VaultTransitError {}
/** Vault respondió pero el DESCIFRADO falló (ciphertext inválido para esta key). Distinto de no-disponible. */
export class VaultDescifradoError extends VaultTransitError {}
/** 401/403: token/permiso de Vault inválido. Problema de credenciales/policy (fail-closed). */
export class VaultAutenticacionError extends VaultTransitError {}
/** Config faltante/incoherente (addr/mount/key/token) o 404 de mount/key. */
export class VaultConfiguracionError extends VaultTransitError {}
/** Respuesta con forma inesperada (sin `data.ciphertext`/`data.plaintext`, no-JSON, formato inválido). */
export class VaultRespuestaInvalidaError extends VaultTransitError {}

// ---------------------------------------------------------------------------
// Transporte HTTP (puerto) — el boundary de red. Productivo usa fetch; en tests, fake fiel al contrato.
// ---------------------------------------------------------------------------

export interface PeticionHttpVault {
  readonly metodo: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly cuerpo?: unknown; // se serializa a JSON; para encrypt/decrypt lleva base64 de la DATA KEY (no el token)
  readonly timeoutMs: number;
}

export interface RespuestaHttpVault {
  readonly status: number;
  readonly ok: boolean;
  readonly json: unknown; // body parseado o null
}

export interface TransporteVault {
  /** Real ⇒ true. El fake ⇒ false: así el `KmsPort` derivado NO es productivo (gate de producción). */
  readonly esProductivo: boolean;
  /** Ejecuta la petición aplicando timeout. Debe fallar-cerrado y NUNCA loggear headers/cuerpo. */
  enviar(req: PeticionHttpVault): Promise<RespuestaHttpVault>;
}

/**
 * Transporte productivo con `fetch` global (Node 20+) + `AbortController` para timeout. En caso de fallo de
 * red/timeout lanza `VaultNoDisponibleError` con mensaje genérico: nunca reexpone el cuerpo (lleva la data
 * key en base64) ni el token. No hace logging.
 */
export class TransporteHttpVault implements TransporteVault {
  readonly esProductivo = true;
  async enviar(req: PeticionHttpVault): Promise<RespuestaHttpVault> {
    const ac = new AbortController();
    const temporizador = setTimeout(() => ac.abort(), req.timeoutMs);
    try {
      const resp = await fetch(req.url, {
        method: req.metodo,
        headers: { ...req.headers },
        body: req.cuerpo === undefined ? undefined : JSON.stringify(req.cuerpo),
        signal: ac.signal,
      });
      const texto = await resp.text();
      let json: unknown = null;
      if (texto.length > 0) {
        try {
          json = JSON.parse(texto);
        } catch {
          json = null; // no-JSON ⇒ el adaptador lo tratará como respuesta inválida
        }
      }
      return { status: resp.status, ok: resp.ok, json };
    } catch {
      // Red / timeout / abort ⇒ indisponible. Mensaje genérico: sin URL/headers/cuerpo (evita fuga).
      throw new VaultNoDisponibleError('transporte Vault no disponible (red o timeout)');
    } finally {
      clearTimeout(temporizador);
    }
  }
}

// ---------------------------------------------------------------------------
// Autenticación del runtime contra Vault (puerto) — hoy token estático; mañana AppRole/JWT, sin cambiar API.
// ---------------------------------------------------------------------------

export interface VaultAuthProvider {
  readonly modo: string;
  /** Token de sesión de Vault. NO es el token Meta. Nunca se loggea. */
  obtenerToken(): Promise<string>;
}

/**
 * Provider de token estático (inyectado, NUNCA hardcodeado). El modelo de auth definitivo del runtime
 * (AppRole, JWT/OIDC, etc.) se decide en el provisioning real; este provider es sólo el punto de extensión.
 */
export class VaultTokenEstaticoAuth implements VaultAuthProvider {
  readonly modo = 'token-estatico';
  constructor(private readonly token: string) {
    if (!token) throw new VaultConfiguracionError('token de Vault vacío');
  }
  async obtenerToken(): Promise<string> {
    return this.token;
  }
}

// ---------------------------------------------------------------------------
// Configuración — toda desde afuera; NADA hardcodeado (FASE HCP)
// ---------------------------------------------------------------------------

export interface VaultTransitConfig {
  readonly addr: string; // VAULT_ADDR (https)
  readonly namespace?: string; // VAULT_NAMESPACE (HCP Vault Dedicated suele requerirlo, p. ej. "admin")
  readonly mount: string; // VAULT_TRANSIT_MOUNT (p. ej. "transit")
  readonly key: string; // VAULT_TRANSIT_KEY
  readonly timeoutMs: number;
}

export function validarConfigVault(c: VaultTransitConfig): void {
  const falta: string[] = [];
  if (!c.addr || !/^https?:\/\//.test(c.addr)) falta.push('VAULT_ADDR');
  if (!c.mount) falta.push('VAULT_TRANSIT_MOUNT');
  if (!c.key) falta.push('VAULT_TRANSIT_KEY');
  if (!(c.timeoutMs > 0)) falta.push('timeoutMs');
  if (falta.length > 0) throw new VaultConfiguracionError(`configuración de Vault incompleta: ${falta.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Formato del ciphertext de Transit + lectura segura de campos
// ---------------------------------------------------------------------------

/** Ciphertext de Transit: `vault:v<version>:<base64>` (Vault admite base64 estándar y url-safe). */
export const RE_VAULT_CIPHERTEXT = /^vault:v\d+:[A-Za-z0-9+/_-]+={0,2}$/;

function leerCampoString(json: unknown, ...ruta: readonly string[]): string | null {
  let cur: unknown = json;
  for (const clave of ruta) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[clave];
  }
  return typeof cur === 'string' ? cur : null;
}

const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function encodePath(seg: string): string {
  return encodeURIComponent(seg);
}

// ---------------------------------------------------------------------------
// Adaptador KmsPort sobre Transit
// ---------------------------------------------------------------------------

/** Capacidad opcional de rotación de clave (rewrap de Transit) — soportada por contrato, no ejecutada. */
export interface KmsRewrapCapable {
  reenvolverDataKey(wrapped: Buffer): Promise<Buffer>;
}

export class VaultTransitKmsPort implements KmsPort, KmsRewrapCapable {
  readonly nombre = 'vault-transit';
  /** Productivo sólo si el transporte lo es: el fake ⇒ false ⇒ bloqueado por el gate de producción. */
  readonly esProductivo: boolean;

  constructor(
    private readonly cfg: VaultTransitConfig,
    private readonly transporte: TransporteVault,
    private readonly auth: VaultAuthProvider,
  ) {
    validarConfigVault(cfg);
    this.esProductivo = transporte.esProductivo;
  }

  private base(): string {
    return `${this.cfg.addr}/v1/${this.cfg.mount}`;
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.auth.obtenerToken();
    const h: Record<string, string> = { 'X-Vault-Token': token, 'Content-Type': 'application/json' };
    if (this.cfg.namespace) h['X-Vault-Namespace'] = this.cfg.namespace;
    return h;
  }

  /** POST a Transit + mapeo de status → error tipado (distingue indisponible de fallo de descifrado). */
  private async post(url: string, cuerpo: unknown, op: 'wrap' | 'unwrap' | 'rewrap'): Promise<RespuestaHttpVault> {
    const resp = await this.transporte.enviar({ metodo: 'POST', url, headers: await this.headers(), cuerpo, timeoutMs: this.cfg.timeoutMs });
    if (resp.status >= 200 && resp.status < 300) return resp;
    if (resp.status === 401 || resp.status === 403) throw new VaultAutenticacionError(`autenticación/permiso de Vault rechazado (${resp.status})`);
    if (resp.status === 404) throw new VaultConfiguracionError(`mount/key de Transit no encontrado (${resp.status})`);
    if (resp.status === 400) {
      // 400 en decrypt/rewrap ⇒ el ciphertext no es válido para esta key: fallo de DESCIFRADO, no indisponibilidad.
      if (op !== 'wrap') throw new VaultDescifradoError(`Vault rechazó el descifrado (${resp.status})`);
      throw new VaultRespuestaInvalidaError(`solicitud inválida a Transit en ${op} (${resp.status})`);
    }
    if (resp.status === 429 || resp.status >= 500) throw new VaultNoDisponibleError(`Vault no disponible (${resp.status})`);
    throw new VaultRespuestaInvalidaError(`respuesta inesperada de Vault (${resp.status})`);
  }

  /** wrap = Transit `encrypt` de la data key. Devuelve los bytes del `vault:vN:…` (opaco para el backend). */
  async wrapDataKey(dataKey: Buffer): Promise<Buffer> {
    const url = `${this.base()}/encrypt/${encodePath(this.cfg.key)}`;
    const resp = await this.post(url, { plaintext: dataKey.toString('base64') }, 'wrap');
    const ct = leerCampoString(resp.json, 'data', 'ciphertext');
    if (ct === null || !RE_VAULT_CIPHERTEXT.test(ct)) throw new VaultRespuestaInvalidaError('respuesta de encrypt sin data.ciphertext válido');
    return Buffer.from(ct, 'utf8');
  }

  /** unwrap = Transit `decrypt`. Valida el prefijo `vault:vN:` ANTES de la red (fail-closed). */
  async unwrapDataKey(wrapped: Buffer): Promise<Buffer> {
    const ct = wrapped.toString('utf8');
    if (!RE_VAULT_CIPHERTEXT.test(ct)) throw new VaultRespuestaInvalidaError('ciphertext con formato Transit inválido');
    const url = `${this.base()}/decrypt/${encodePath(this.cfg.key)}`;
    const resp = await this.post(url, { ciphertext: ct }, 'unwrap');
    const pt = leerCampoString(resp.json, 'data', 'plaintext');
    if (pt === null || !RE_BASE64.test(pt)) throw new VaultRespuestaInvalidaError('respuesta de decrypt sin data.plaintext base64');
    return Buffer.from(pt, 'base64');
  }

  /**
   * Rotación de clave por rewrap de Transit: re-cifra el `wrappedDataKey` bajo la última versión de la key,
   * SIN exponer la data key. Soportado por contrato; NO se invoca en el flujo hasta autorizar la rotación.
   */
  async reenvolverDataKey(wrapped: Buffer): Promise<Buffer> {
    const ct = wrapped.toString('utf8');
    if (!RE_VAULT_CIPHERTEXT.test(ct)) throw new VaultRespuestaInvalidaError('ciphertext inválido para rewrap');
    const url = `${this.base()}/rewrap/${encodePath(this.cfg.key)}`;
    const resp = await this.post(url, { ciphertext: ct }, 'rewrap');
    const nuevo = leerCampoString(resp.json, 'data', 'ciphertext');
    if (nuevo === null || !RE_VAULT_CIPHERTEXT.test(nuevo)) throw new VaultRespuestaInvalidaError('respuesta de rewrap sin data.ciphertext válido');
    return Buffer.from(nuevo, 'utf8');
  }

  /** Readiness vía `/v1/sys/health`. Nunca lanza: mapea todo (incl. red caída) a un estado de salud. */
  async salud(): Promise<SaludBackend> {
    try {
      const resp = await this.transporte.enviar({ metodo: 'GET', url: `${this.cfg.addr}/v1/sys/health`, headers: await this.headers(), timeoutMs: this.cfg.timeoutMs });
      const s = resp.status;
      if (s >= 200 && s < 300) return 'AVAILABLE';
      if (s === 429 || s === 472 || s === 473) return 'AVAILABLE'; // standby / DR-perf standby: responde
      if (s === 501) return 'MISCONFIGURED'; // no inicializado
      return 'UNAVAILABLE'; // 503 sellado u otro
    } catch {
      return 'UNAVAILABLE';
    }
  }
}

// ---------------------------------------------------------------------------
// Fake transport — fiel al contrato HTTP de Transit. SÓLO test/dev. Master key en memoria (jamás producción).
// ---------------------------------------------------------------------------

export interface OpcionesFakeVault {
  /** Fuerza este status en operaciones de cripto (encrypt/decrypt/rewrap). */
  readonly forzarStatus?: number;
  /** Status devuelto por `/sys/health`. */
  readonly forzarSalud?: number;
  /** Responde 200 con body inválido (sin `data.ciphertext`/`plaintext`). */
  readonly forzarMalformado?: boolean;
  /** Simula indisponibilidad de red/timeout (lanza como el transporte real). */
  readonly forzarTimeout?: boolean;
  /** Exige `X-Vault-Namespace` (como HCP): 400 si falta. */
  readonly requiereNamespace?: boolean;
}

function leerCuerpoString(cuerpo: unknown, campo: string): string | null {
  if (cuerpo === null || typeof cuerpo !== 'object') return null;
  const v = (cuerpo as Record<string, unknown>)[campo];
  return typeof v === 'string' ? v : null;
}

export class FakeTransporteVault implements TransporteVault {
  readonly esProductivo = false;
  /** Peticiones capturadas para aserciones (headers/cuerpo). Útil para probar que el token Meta nunca viaja. */
  readonly peticiones: PeticionHttpVault[] = [];
  private readonly masterKey = randomBytes(32);

  constructor(private readonly opts: OpcionesFakeVault = {}) {}

  async enviar(req: PeticionHttpVault): Promise<RespuestaHttpVault> {
    this.peticiones.push(req);
    if (this.opts.forzarTimeout) throw new VaultNoDisponibleError('timeout simulado');

    if (req.url.endsWith('/sys/health')) {
      const s = this.opts.forzarSalud ?? 200;
      return { status: s, ok: s >= 200 && s < 300, json: { initialized: true, sealed: s === 503 } };
    }
    if (this.opts.requiereNamespace && !req.headers['X-Vault-Namespace']) {
      return { status: 400, ok: false, json: { errors: ['namespace required'] } };
    }
    if (this.opts.forzarStatus !== undefined && !(this.opts.forzarStatus >= 200 && this.opts.forzarStatus < 300)) {
      return { status: this.opts.forzarStatus, ok: false, json: { errors: ['forced status'] } };
    }
    if (this.opts.forzarMalformado) {
      return { status: 200, ok: true, json: { data: {} } };
    }

    if (req.url.includes('/encrypt/')) {
      const pt = leerCuerpoString(req.cuerpo, 'plaintext');
      if (pt === null) return { status: 400, ok: false, json: { errors: ['missing plaintext'] } };
      return { status: 200, ok: true, json: { data: { ciphertext: this.cifrar(pt, 1) } } };
    }
    if (req.url.includes('/decrypt/')) {
      const ct = leerCuerpoString(req.cuerpo, 'ciphertext');
      if (ct === null || !RE_VAULT_CIPHERTEXT.test(ct)) return { status: 400, ok: false, json: { errors: ['invalid ciphertext'] } };
      const pt = this.descifrar(ct);
      if (pt === null) return { status: 400, ok: false, json: { errors: ['decryption failed'] } };
      return { status: 200, ok: true, json: { data: { plaintext: pt } } };
    }
    if (req.url.includes('/rewrap/')) {
      const ct = leerCuerpoString(req.cuerpo, 'ciphertext');
      if (ct === null || !RE_VAULT_CIPHERTEXT.test(ct)) return { status: 400, ok: false, json: { errors: ['invalid ciphertext'] } };
      const pt = this.descifrar(ct);
      if (pt === null) return { status: 400, ok: false, json: { errors: ['decryption failed'] } };
      return { status: 200, ok: true, json: { data: { ciphertext: this.cifrar(pt, 2) } } };
    }
    return { status: 404, ok: false, json: { errors: ['unknown path'] } };
  }

  private cifrar(plaintextB64: string, version: number): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ct = Buffer.concat([c.update(Buffer.from(plaintextB64, 'utf8')), c.final()]);
    const blob = Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    return `vault:v${version}:${blob}`;
  }

  private descifrar(ciphertext: string): string | null {
    try {
      const blob = Buffer.from(ciphertext.replace(/^vault:v\d+:/, ''), 'base64');
      const iv = blob.subarray(0, 12);
      const tag = blob.subarray(12, 28);
      const ct = blob.subarray(28);
      const d = createDecipheriv('aes-256-gcm', this.masterKey, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
