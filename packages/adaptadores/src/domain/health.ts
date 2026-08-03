/**
 * @soec/adaptadores · dominio · HEALTH CHECKS OPERATIVOS (M4-C-B). Puerto neutral. En M4-C-B sólo hay
 * implementaciones sintéticas/grabadas/deterministas SIN RED. La salud AFECTA la ejecución (fail-safe):
 * SALUDABLE puede continuar; DEGRADADA aplica política explícita; NO_CONFIABLE bloquea; DESCONOCIDA es
 * fail-safe (nunca REAL). El instante se inyecta.
 */
import type { RequestContext } from '@soec/contracts';
import type { SaludRegistro } from './registro-adaptador';

export interface ContextoHealthCheck {
  readonly ctx: RequestContext;
  readonly adaptadorId: string;
  readonly capacidadId: string;
  readonly observadoEn: string;
}

export interface ResultadoHealthCheck {
  readonly estado: 'SALUDABLE' | 'DEGRADADA' | 'NO_CONFIABLE';
  readonly codigo: string;
  readonly observadoEn: string;
  readonly evidenciaVersion: string;
}

export interface HealthCheckAdaptador {
  readonly nombre: string;
  comprobar(input: ContextoHealthCheck): Promise<ResultadoHealthCheck>;
}

/** Health check SINTÉTICO determinista (sin red). Devuelve un estado fijo configurado. */
export class HealthCheckSintetico implements HealthCheckAdaptador {
  readonly nombre = 'sintetico';
  constructor(
    private readonly estado: ResultadoHealthCheck['estado'] = 'SALUDABLE',
    private readonly codigo = 'OK',
  ) {}
  async comprobar(input: ContextoHealthCheck): Promise<ResultadoHealthCheck> {
    return { estado: this.estado, codigo: this.codigo, observadoEn: input.observadoEn, evidenciaVersion: '1' };
  }
}

/** Efecto de la salud sobre la ejecución (fail-safe). `DESCONOCIDA` nunca permite REAL. */
export function efectoSalud(salud: SaludRegistro, modoDeseado: 'SIMULADO' | 'REAL'): { permite: boolean; motivo: string } {
  if (salud === 'NO_CONFIABLE') return { permite: false, motivo: 'salud NO_CONFIABLE' };
  if (salud === 'DESCONOCIDA' && modoDeseado === 'REAL') return { permite: false, motivo: 'salud DESCONOCIDA: no se permite REAL (fail-safe)' };
  return { permite: true, motivo: '' };
}
