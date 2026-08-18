/**
 * apps/api · V2 PRE-REAL · TRANSPORTE de escritura Meta. Abstrae la red para que el adapter real sea
 * testeable SIN credenciales reales (Fake/Recorded transport). El transporte REAL hace HTTP a Graph con
 * timeout, appsecret_proof y sanitización; NUNCA loggea token/app secret/payload sensible completo.
 *
 * IMPORTANTE: instanciar el transporte real NO ejecuta ninguna request. El master switch vive en el adapter,
 * que es quien decide si llama al transporte. Aun así, este transporte no guarda credenciales en claro.
 */
import { createHmac } from 'node:crypto';

export interface TransportRequest {
  readonly method: 'POST';
  readonly path: string; // p.ej. "act_123/campaigns"
  readonly body: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
}

export interface TransportResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface MetaWriteTransport {
  readonly nombre: string;
  ejecutar(req: TransportRequest): Promise<TransportResponse>;
}

/** Proveedor de credenciales (token de acceso ya desencriptado). Inyectable; en tests es falso. */
export interface ProveedorCredencialEscritura {
  accessToken(): Promise<string>;
  appSecret(): Promise<string>;
}

/** Transporte FALSO/grabado para contract tests: respuestas deterministas por path, sin red ni secretos. */
export class FakeWriteTransport implements MetaWriteTransport {
  readonly nombre = 'fake';
  llamadas: TransportRequest[] = [];
  constructor(private readonly guion: (req: TransportRequest) => TransportResponse) {}
  async ejecutar(req: TransportRequest): Promise<TransportResponse> {
    this.llamadas.push(req);
    return this.guion(req);
  }
}

/** Guion por defecto: éxito con un id externo determinista derivado del path/body. */
export function guionExitoso(): (req: TransportRequest) => TransportResponse {
  let n = 0;
  return (req) => ({ status: 200, body: { id: `${req.path.replace(/[^a-z0-9]/gi, '_')}_${++n}` } });
}

/**
 * Transporte REAL contra Graph. Sólo lo usa el adapter real tras pasar todos los gates. Aplica timeout y
 * appsecret_proof; sanitiza el error (sin cuerpo crudo). No loggea secretos ni el payload completo.
 */
export class RealGraphWriteTransport implements MetaWriteTransport {
  readonly nombre = 'graph';
  constructor(
    private readonly cred: ProveedorCredencialEscritura,
    private readonly graphVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://graph.facebook.com',
  ) {}

  async ejecutar(req: TransportRequest): Promise<TransportResponse> {
    const token = await this.cred.accessToken();
    const secret = await this.cred.appSecret();
    const proof = createHmac('sha256', secret).update(token).digest('hex');
    const url = `${this.baseUrl}/${this.graphVersion}/${req.path}`;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.body)) params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    params.set('access_token', token);
    params.set('appsecret_proof', proof);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method: 'POST', body: params, signal: controller.signal });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, body: json };
    } catch {
      // No propagamos el error crudo (podría traer la URL con token). Señalamos NETWORK genérico.
      return { status: 0, body: { error: { code: 0, type: 'NETWORK' } } };
    } finally {
      clearTimeout(t);
    }
  }
}
