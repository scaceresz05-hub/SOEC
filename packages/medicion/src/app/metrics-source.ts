/**
 * Fuente de métricas proveedor-independiente (F2-MET-01 §8). El dominio no llama a un
 * SDK: define un puerto reemplazable. La implementación emulada cruza una frontera HTTP
 * real hacia el proveedor emulado; la simulada no usa red (pruebas locales). Soporta
 * reanudación por cursor.
 */

export interface FilaProveedor {
  readonly externalId: string;
  readonly metrica: string;
  readonly valor: number;
  readonly unidad: string;
  readonly moneda: string | null;
  readonly periodo: string;
  readonly ocurridoEn: string;
  readonly proveedorSeq: number;
  readonly acumulativa: boolean;
  readonly estimada: boolean;
}
export interface ConversionProveedor {
  readonly id: string;
  readonly externalId: string | null;
  readonly campaignRef: string | null;
  readonly valor: number;
  readonly ocurridoEn: string;
}
export interface LoteMetricas {
  readonly filas: readonly FilaProveedor[];
  readonly cursor: string | null;
  readonly conversiones: readonly ConversionProveedor[];
}

export interface MetricsSource {
  readonly nombre: string;
  readonly modo: 'simulado' | 'sandbox';
  obtener(token: string, cuenta: string, cursor?: string): Promise<LoteMetricas>;
  obtenerDe(token: string, cuenta: string, externalRef: string): Promise<readonly FilaProveedor[]>;
}

/** Fuente EMULADA por HTTP: consulta la API de métricas del proveedor emulado (fetch). */
export class FuenteMetricasEmulada implements MetricsSource {
  readonly nombre = 'metricas-emulado-http';
  readonly modo = 'sandbox' as const;
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
  ) {}

  private async pedir(ruta: string, token: string, cuenta: string): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${ruta}`, { headers: { authorization: `Bearer ${token}`, 'x-emu-account': cuenta }, signal: ctrl.signal });
      return await res.json().catch(() => ({}));
    } finally {
      clearTimeout(timer);
    }
  }

  async obtener(token: string, cuenta: string, cursor?: string): Promise<LoteMetricas> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const b = (await this.pedir(`/v1/metrics${q}`, token, cuenta)) as { metrics?: FilaProveedor[]; cursor?: string; conversiones?: ConversionProveedor[] };
    return { filas: b.metrics ?? [], cursor: b.cursor ?? null, conversiones: b.conversiones ?? [] };
  }
  async obtenerDe(token: string, cuenta: string, externalRef: string): Promise<readonly FilaProveedor[]> {
    const b = (await this.pedir(`/v1/posts/${encodeURIComponent(externalRef)}/metrics`, token, cuenta)) as { metrics?: FilaProveedor[] };
    return b.metrics ?? [];
  }
}

/** Fuente SIMULADA (sin red): produce métricas deterministas para pruebas locales. */
export class FuenteMetricasSimulada implements MetricsSource {
  readonly nombre = 'metricas-simulado';
  readonly modo = 'simulado' as const;
  private readonly filas = new Map<string, FilaProveedor[]>();
  private readonly conversiones: ConversionProveedor[] = [];

  cargar(externalRef: string, filas: FilaProveedor[]): void {
    this.filas.set(externalRef, filas);
  }
  registrarConversion(c: ConversionProveedor): void {
    this.conversiones.push(c);
  }

  async obtener(): Promise<LoteMetricas> {
    return { filas: [...this.filas.values()].flat(), cursor: null, conversiones: this.conversiones };
  }
  async obtenerDe(_t: string, _c: string, externalRef: string): Promise<readonly FilaProveedor[]> {
    return this.filas.get(externalRef) ?? [];
  }
}
