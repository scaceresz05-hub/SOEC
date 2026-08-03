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

/** Versiones de esquema de evidencia de health soportadas. */
const HEALTH_EVIDENCIA_SOPORTADAS: ReadonlySet<string> = new Set(['1']);

/**
 * Valida ESTRICTAMENTE el resultado de un health check como ENTRADA HOSTIL (F-CB-2). Un resultado inválido
 * NO se degrada a saludable: el orquestador lo trata fail-closed (salud DESCONOCIDA → NO_DISPONIBLE).
 */
export function healthValido(r: ResultadoHealthCheck | null | undefined): r is ResultadoHealthCheck {
  if (!r || typeof r !== 'object') return false;
  if (r.estado !== 'SALUDABLE' && r.estado !== 'DEGRADADA' && r.estado !== 'NO_CONFIABLE') return false;
  if (typeof r.codigo !== 'string' || r.codigo.trim().length === 0 || r.codigo.length > 64) return false;
  if (typeof r.observadoEn !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.observadoEn) || Number.isNaN(Date.parse(r.observadoEn))) return false;
  if (typeof r.evidenciaVersion !== 'string' || !HEALTH_EVIDENCIA_SOPORTADAS.has(r.evidenciaVersion)) return false;
  return true;
}

/** Efecto de la salud sobre la ejecución (fail-safe). `DESCONOCIDA` nunca permite REAL. */
export function efectoSalud(salud: SaludRegistro, modoDeseado: 'SIMULADO' | 'REAL'): { permite: boolean; motivo: string } {
  if (salud === 'NO_CONFIABLE') return { permite: false, motivo: 'salud NO_CONFIABLE' };
  if (salud === 'DESCONOCIDA' && modoDeseado === 'REAL') return { permite: false, motivo: 'salud DESCONOCIDA: no se permite REAL (fail-safe)' };
  return { permite: true, motivo: '' };
}
