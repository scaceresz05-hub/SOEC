/**
 * @soec/adaptadores · M4-D (neutral) · SELLADO DE INSTANCIA (cierre de F-CCC-1). La instancia de adaptador
 * es entrada NO confiable y sus métodos/identidad son mutables (monkey-patch). `sellarAdaptador` captura
 * UNA sola vez la identidad (nombre/capacidad/version) y los métodos enlazados (salud/ejecutar/soportaReal),
 * devolviendo un adaptador CONGELADO cuyo comportamiento ya no cambia si el objeto original se manipula
 * después de sellarlo. Válido con cualquier proveedor futuro (independiente de D-1..D-7). Sin red/SDK/reloj.
 */
import type { RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador, SaludReporte, SolicitudAdaptador } from '../port/adaptador-externo';

export function sellarAdaptador(adaptador: AdaptadorExterno): AdaptadorExterno {
  const nombre = String(adaptador.nombre);
  const capacidad = String(adaptador.capacidad);
  const version = String(adaptador.version);
  const salud = adaptador.salud.bind(adaptador);
  const ejecutar = adaptador.ejecutar.bind(adaptador);
  const soportaRealFn = typeof adaptador.soportaReal === 'function' ? adaptador.soportaReal.bind(adaptador) : undefined;
  const soportaRealCapturado = soportaRealFn ? soportaRealFn() === true : false;

  const sellado: AdaptadorExterno = {
    nombre,
    capacidad,
    version,
    soportaReal: () => soportaRealCapturado,
    salud: (ctx: RequestContext, signal?: AbortSignal): Promise<SaludReporte> => salud(ctx, signal),
    ejecutar: (ctx: RequestContext, solicitud: SolicitudAdaptador, signal?: AbortSignal): Promise<SalidaAdaptador> => ejecutar(ctx, solicitud, signal),
  };
  return Object.freeze(sellado);
}
