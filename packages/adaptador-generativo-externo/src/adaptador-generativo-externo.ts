/**
 * @soec/adaptador-generativo-externo · CARCASA de adaptador de FRONTERA (M4-C-B).
 *
 * Primer adaptador CONCRETO, pero estructuralmente DESACTIVADO: vive fuera del dominio, implementa el puerto
 * `AdaptadorExterno`, declara su contrato/versión y capacidades HONESTAMENTE, trae health check y salida
 * SINTÉTICOS (deterministas, sin red) y NO puede ejecutar REAL. NO importa ningún SDK, NO llama a la red,
 * NO lee `process.env`, NO resuelve secretos y NO nombra un proveedor comercial. El modo REAL sólo lo
 * habilitaría el sandbox con estado de frontera + capacidad consumible + credencial por referencia; esta
 * carcasa declara `soportaReal: false`, de modo que la gobernanza jamás la promueva a REAL.
 */
import type { RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador, SaludReporte, SolicitudAdaptador } from '@soec/adaptadores';

export interface DescriptorAdaptador {
  readonly adaptadorIdLogico: string;
  readonly capacidad: string;
  readonly contratoId: string;
  readonly contratoVersion: string;
  readonly implementacionVersion: string;
  readonly evidenciaSchemaVersion: string;
  /** Declaración HONESTA de capacidades (Art. 9). Esta carcasa no soporta ejecución REAL. */
  readonly soportaReal: boolean;
  readonly operacionesSoportadas: readonly string[];
}

export const DESCRIPTOR_GENERATIVO_EXTERNO: DescriptorAdaptador = {
  adaptadorIdLogico: 'generacion-externa-carcasa',
  capacidad: 'generacion-contenido',
  contratoId: 'generacion',
  contratoVersion: '1.0.0',
  implementacionVersion: '0.1.0',
  evidenciaSchemaVersion: '1',
  soportaReal: false, // carcasa desactivada: nunca REAL
  operacionesSoportadas: ['generar'],
};

export class AdaptadorGenerativoExternoDesactivado implements AdaptadorExterno {
  readonly nombre = DESCRIPTOR_GENERATIVO_EXTERNO.adaptadorIdLogico;
  readonly capacidad = DESCRIPTOR_GENERATIVO_EXTERNO.capacidad;
  readonly version = DESCRIPTOR_GENERATIVO_EXTERNO.implementacionVersion;

  descriptor(): DescriptorAdaptador {
    return DESCRIPTOR_GENERATIVO_EXTERNO;
  }

  /** Nunca soporta REAL: la gobernanza debe consultarlo antes de intentar promover el modo. */
  soportaReal(): boolean {
    return DESCRIPTOR_GENERATIVO_EXTERNO.soportaReal;
  }

  async salud(_ctx: RequestContext): Promise<SaludReporte> {
    // Health SINTÉTICO determinista (sin red): la carcasa se declara saludable como componente,
    // aunque no tenga proveedor detrás — el sandbox/gobernanza deciden si puede ejecutar.
    return { estado: 'SALUDABLE', detalle: 'carcasa-sintetica' };
  }

  async ejecutar(_ctx: RequestContext, solicitud: SolicitudAdaptador, signal?: AbortSignal): Promise<SalidaAdaptador> {
    if (signal?.aborted) {
      const clase = signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELADO';
      return { estado: 'ERROR', salida: null, error: { clase, mensaje: clase === 'TIMEOUT' ? 'se agotó el plazo' : 'ejecución cancelada', reintentable: clase === 'TIMEOUT' } };
    }
    if (!DESCRIPTOR_GENERATIVO_EXTERNO.operacionesSoportadas.includes(solicitud.peticion.operacion)) {
      return { estado: 'ERROR', salida: null, error: { clase: 'INVALIDO', mensaje: `operación no soportada: ${solicitud.peticion.operacion}`, reintentable: false } };
    }
    // Salida SINTÉTICA determinista (sin proveedor real). El sandbox fija identidad/modo/naturaleza.
    return { estado: 'OK', salida: { texto: `[SIMULADO] generación para ${solicitud.capacidadId}` }, error: null };
  }
}
