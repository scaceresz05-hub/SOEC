/**
 * Adaptador de canal SIMULADO (dry-run). NO produce ningún efecto externo real:
 * no publica, no gasta, no envía. Devuelve un identificador externo determinístico
 * (idempotente por idempotencyKey) y registra el efecto simulado. Sirve para
 * demostrar la vertical operativa de forma segura y reversible.
 */
import { createHash } from 'node:crypto';
import type { AccionPropuesta, Efecto } from '../../domain/action';
import type { CanalAdapter } from '../../domain/channel';

export class AdaptadorSimulado implements CanalAdapter {
  readonly nombre = 'simulado';
  readonly version = '1.0.0';

  soporta(_canal: string): boolean {
    return true; // el sandbox simulado soporta cualquier canal declarado
  }

  async publicar(accion: AccionPropuesta, idempotencyKey: string): Promise<Efecto> {
    // Determinístico → idempotente: la misma clave produce el mismo externalId.
    const externalId = 'sim-' + createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16);
    return {
      externalId,
      ok: true,
      detalle: `publicación simulada en '${accion.canal}' (tipo ${accion.tipo}); ningún efecto real`,
      simulado: true,
    };
  }

  async revertir(externalId: string): Promise<Efecto> {
    return { externalId, ok: true, detalle: 'reversión simulada; ningún efecto real', simulado: true };
  }
}
