/**
 * Helpers: servicio sobre EventStore en memoria, contexto autorizado/no autorizado, y
 * una PROPUESTA real derivada del motor de Estrategia (para congelar como instantánea).
 */
import { InMemoryEventStore } from '@soec/event-store';
import {
  ActorId,
  OrganizationId,
  type Attribution,
  type EventStore,
  type RequestContext,
} from '@soec/contracts';
import { crearBibliotecaClinicaDental } from '@soec/rubros';
import { proponerEstrategia } from '@soec/estrategia';
import type { CandidatoEstrategia } from '@soec/estrategia';
import type { ComprensionEvaluable } from '@soec/diagnostico';
import { DecisionService, type PropuestaSnapshot } from '../src/index';

export const now = '2026-07-23T12:00:00.000Z';
export const attr: Attribution = {
  source: 'gobierno',
  purpose: 'registrar decisión institucional',
  assumptions: ['sintético'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

export function ctxFor(org: string, autorizado = true): RequestContext {
  const organizationId = OrganizationId(org);
  const permissions = autorizado
    ? ['events:append', 'events:read', 'decisiones:decidir']
    : ['events:append', 'events:read'];
  return {
    organizationId,
    actor: ActorId('director'),
    scope: { organizationId, permissions },
    correlationId: `c-${org}`,
  };
}

export function montar(store: EventStore = new InMemoryEventStore()) {
  return { store, svc: new DecisionService(store) };
}

/** PROPUESTA real (activando POCAS_SOLICITUDES) + su primer candidato. */
export function propuestaReal(): { snapshot: PropuestaSnapshot; candidato: CandidatoEstrategia } {
  const rubro = crearBibliotecaClinicaDental();
  const s = rubro.senales().find((x) => x.nombre === 'POCAS_SOLICITUDES')!;
  const comprension: ComprensionEvaluable = {
    diagnosticoId: 'dx',
    rubroId: 'clinica-dental',
    hechos: [
      {
        preguntaId: s.preguntaId,
        afirmacionId: 'af',
        evidenciaIds: ['ev'],
        enunciado: 'sí',
        valor: true,
      },
    ],
    faltantes: [],
    contradicciones: [],
    abstenido: false,
    comprension: {
      nombre: 'Comprender el estado',
      incertidumbre: 'media',
      contradiccionesAbiertas: [],
      faltante: [],
      productoCompuesto: [],
    },
    operaciones: [],
  };
  const resultado = proponerEstrategia(comprension, rubro);
  if (resultado.tipo !== 'PROPUESTA') throw new Error('esperaba PROPUESTA');
  return {
    snapshot: {
      comprension,
      resultado,
      rubroId: 'clinica-dental',
      rubroHuella: rubro.version().huellaCompleta,
    },
    candidato: resultado.candidatos[0]!,
  };
}
