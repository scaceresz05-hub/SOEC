'use server';
import { revalidatePath } from 'next/cache';
import { getSoec, POL_OSC, AHORA } from '../../lib/soec/motor';

const A = { source: 'web', purpose: 'decision', assumptions: ['humano'], claimType: 'observational' as const, regime: 'empirical' as const, uncertainty: 'baja' as const };
const HUMANO = { actorHumano: 'humano-1', decisionId: 'dec-web', justificacion: 'decisión desde la bandeja' };
const O = new Date('2026-09-10T00:00:00.000Z').toISOString();

/** Aprobar = aprobación HUMANA canónica (M9) + aplicación simulada (crea la nueva versión del plan). */
export async function aprobar(propuestaId: string) {
  const s = await getSoec();
  await s.propuestas.aprobar(s.ctx, propuestaId, HUMANO, A, O);
  await s.propuestas.aplicarSimulado(s.ctx, propuestaId, POL_OSC, AHORA, A, O);
  revalidatePath('/'); revalidatePath('/decisiones'); revalidatePath('/timeline');
}

export async function rechazar(propuestaId: string) {
  const s = await getSoec();
  await s.propuestas.rechazar(s.ctx, propuestaId, HUMANO, A, O);
  revalidatePath('/'); revalidatePath('/decisiones'); revalidatePath('/timeline');
}
