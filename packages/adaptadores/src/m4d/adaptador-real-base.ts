/**
 * @soec/adaptadores · M4-D (neutral) · TEMPLATE de ADAPTADOR REAL (Ejes 2/5/6). Base ABSTRACTA que compone
 * toda la frontera de un futuro adaptador real SIN conocer proveedor alguno: aplica el esquema de egress
 * (default-deny + minimización), resuelve el secreto por REFERENCIA vía `SecretStore` (M4-B) y sólo lo expone
 * dentro de `usar(fn)`, y normaliza errores/cancelación. La ÚNICA parte específica del proveedor es el
 * método abstracto `invocar` (decisión D-1). Cuando se ratifique la directiva, un adaptador real concreto
 * sólo implementa `invocar`; todo lo demás ya está aquí, probado.
 *
 * `AdaptadorRealFake` demuestra el template de punta a punta con datos/secretos SINTÉTICOS, sin red/SDK y
 * con `soportaReal=false` (no puede promoverse a REAL). El secreto en claro vive sólo dentro de `invocar` y
 * jamás debe retornarse/registrarse (frontera privilegiada, ADR-0022).
 */
import type { RequestContext } from '@soec/contracts';
import type { SecretStore } from '@soec/secretos';
import type { AdaptadorExterno, SalidaAdaptador, SaludReporte, SolicitudAdaptador } from '../port/adaptador-externo';
import { errorNormalizado, normalizarError } from '../domain/errores-normalizados';
import { type EsquemaSalida, validarEgress } from './egress';

export interface DependenciasAdaptadorReal {
  readonly secretStore: SecretStore; // adaptador de frontera de secretos (fake en M4-D; productivo es D-4)
  readonly secretRef: string; // referencia opaca (nunca el valor)
  readonly esquemaEgress: EsquemaSalida; // lista blanca tipada por operación (config D-2/D-7)
}

export abstract class AdaptadorRealBase implements AdaptadorExterno {
  abstract readonly nombre: string;
  abstract readonly capacidad: string;
  abstract readonly version: string;

  constructor(protected readonly deps: DependenciasAdaptadorReal) {}

  /** Un adaptador real declara true; la promoción a REAL igual la gobiernan registro/descriptor/sandbox. */
  soportaReal(): boolean {
    return true;
  }

  async salud(): Promise<SaludReporte> {
    return { estado: 'SALUDABLE', detalle: 'adaptador-real-base' };
  }

  async ejecutar(ctx: RequestContext, solicitud: SolicitudAdaptador, signal?: AbortSignal): Promise<SalidaAdaptador> {
    if (signal?.aborted) {
      const clase = signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELADO';
      return { estado: 'ERROR', salida: null, error: errorNormalizado(clase, clase === 'TIMEOUT' ? 'se agotó el plazo' : 'ejecución cancelada') };
    }
    // 1) EGRESS: sólo salen los campos declarados y minimizados; lo no declarado no sale (default-deny).
    const egress = validarEgress(this.deps.esquemaEgress, solicitud.peticion.parametros);
    if (!egress.permitido) return { estado: 'ERROR', salida: null, error: errorNormalizado('INVALIDO', `egress rechazó campos: ${egress.motivo}`) };

    // 2) SECRETO por referencia: el valor sólo vive dentro de `usar(fn)` → `invocar`, jamás se retorna.
    try {
      const resuelto = await this.deps.secretStore.resolver(ctx, this.deps.secretRef);
      return await resuelto.usar((valor) => this.invocar(ctx, valor, egress.datos, signal));
    } catch (e) {
      return { estado: 'ERROR', salida: null, error: normalizarError(e, signal?.aborted ? signal.reason : undefined) };
    }
  }

  /**
   * ÚNICA parte específica del proveedor (D-1). Recibe el secreto EN CLARO y los datos ya minimizados. NO
   * debe retornar/registrar el secreto ni datos crudos del proveedor; devuelve salida funcional. En M4-D no
   * hay implementación real: sólo el fake sintético.
   */
  protected abstract invocar(ctx: RequestContext, secretoEnClaro: string, datosSalientes: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<SalidaAdaptador>;
}

/** Adaptador real FAKE (sintético, sin red/SDK/proveedor). Demuestra el template; no puede ejecutar REAL. */
export class AdaptadorRealFake extends AdaptadorRealBase {
  readonly nombre: string;
  readonly capacidad: string;
  readonly version: string;

  constructor(deps: DependenciasAdaptadorReal, opciones: { nombre?: string; capacidad?: string; version?: string } = {}) {
    super(deps);
    this.nombre = opciones.nombre ?? 'real-fake';
    this.capacidad = opciones.capacidad ?? 'capacidad-fake';
    this.version = opciones.version ?? '0.0.0';
  }

  override soportaReal(): boolean {
    return false; // fake: no puede promoverse a REAL
  }

  protected async invocar(_ctx: RequestContext, secretoEnClaro: string, datosSalientes: Readonly<Record<string, string>>): Promise<SalidaAdaptador> {
    // SINTÉTICO: usa el secreto sólo para comprobar presencia (nunca lo devuelve) y hace eco de los datos
    // ya minimizados. Sin red ni proveedor. La salida NO contiene el valor del secreto.
    return { estado: 'OK', salida: { credencialPresente: String(secretoEnClaro.length > 0), campos: Object.keys(datosSalientes).sort().join(',') }, error: null };
  }
}
