/**
 * Experiencia «Evaluación» (F2-DISC-03 · endurecida para piloto F2-PILOT-00).
 *
 * Captura real del Director aguas arriba del Director Workspace. Selección GOBERNADA
 * (catálogo, sin texto libre), identidad explícita por evaluación (`evaluacionId`),
 * cuestionario derivado del conocimiento del rubro (no escrito en la UI), autoguardado
 * durable, ciclo de estados, y advertencia honesta al generar sin evidencia. El tiempo de
 * ocurrencia proviene de un reloj inyectado (real en producción, fijo en tests). No ejecuta
 * Diagnóstico/Estrategia ni efectos operativos.
 */
import { randomUUID } from 'node:crypto';
import {
  ActorId,
  type Attribution,
  type EventStore,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import { crearBibliotecaClinicaDental } from '@soec/rubros';
import {
  EvaluacionService,
  estadoDe,
  type EntradaRespuesta,
  type EvaluacionState,
  type TipoPregunta,
} from '@soec/evaluacion';
import { CATALOGO, validarSeleccion } from './catalogo';

const ATRIBUCION: Attribution = {
  source: 'evaluacion-captura',
  purpose: 'captura de respuestas del Director al cuestionario gobernado',
  assumptions: ['respuestas declaradas por el Director'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

interface PreguntaCuestionario {
  preguntaId: string;
  tipo: TipoPregunta;
  senalId?: string;
  senalNombre?: string;
}

export class EvaluacionExperience {
  private readonly rubro = crearBibliotecaClinicaDental();
  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock,
  ) {}

  private ctx(organizationId: string): RequestContext {
    const org = OrganizationId(organizationId);
    return {
      organizationId: org,
      actor: ActorId('director'),
      scope: { organizationId: org, permissions: ['events:append', 'events:read'] },
      correlationId: `eval-${organizationId}`,
    };
  }

  private svc(): EvaluacionService {
    return new EvaluacionService(this.store);
  }

  catalogo(): unknown {
    return { organizaciones: CATALOGO };
  }

  private cuestionario(): PreguntaCuestionario[] {
    const senalPorPregunta = new Map(this.rubro.senales().map((s) => [s.preguntaId, s]));
    return this.rubro.preguntasDiagnosticas().map((preguntaId) => {
      const s = senalPorPregunta.get(preguntaId);
      return s && typeof s.condicionActivacion.valor === 'boolean'
        ? {
            preguntaId,
            tipo: 'CERRADA_BOOLEAN' as TipoPregunta,
            senalId: s.id,
            senalNombre: s.nombre,
          }
        : { preguntaId, tipo: 'ABIERTA' as TipoPregunta };
    });
  }

  private dto(organizationId: string, departamentoId: string, st: EvaluacionState): unknown {
    const cuestionario = this.cuestionario();
    const preguntas = cuestionario.map((p) => {
      const r = st.respuestas[p.preguntaId] ?? null;
      return {
        preguntaId: p.preguntaId,
        tipo: p.tipo,
        senalId: p.senalId ?? null,
        senalNombre: p.senalNombre ?? null,
        estado: r?.estado ?? 'SIN_RESPONDER',
        entrada: r?.entrada ?? null,
        valorNormalizado: r?.valorNormalizado ?? null,
      };
    });
    const cuenta = (estado: string) => preguntas.filter((p) => p.estado === estado).length;
    const ult = st.generaciones[st.generaciones.length - 1] ?? null;
    const respondidas = cuenta('RESPONDIDA');
    const conContenido = respondidas + cuenta('CONTRADICTORIA');
    return {
      organizationId,
      departamento: departamentoId,
      evaluacionId: st.evaluacionId,
      titulo: st.titulo,
      estado: estadoDe(st),
      creadaEn: st.creadaEn,
      editable: !st.cerrada && !st.archivada,
      rubroId: this.rubro.rubroId(),
      rubroVersion: this.rubro.version().huellaCorta,
      preguntas,
      resumen: {
        total: preguntas.length,
        sinResponder: cuenta('SIN_RESPONDER'),
        respondidas,
        contradictorias: cuenta('CONTRADICTORIA'),
        noNormalizables: cuenta('NO_NORMALIZABLE'),
      },
      // Guardarraíl honesto: generar sin evidencia útil probablemente producirá una abstención.
      generacionSinEvidencia: conContenido === 0,
      generaciones: st.generaciones.length,
      tieneGeneracion: ult !== null,
      ultimaGeneracion: ult
        ? { generacionId: ult.generacionId, huella: ult.huella, en: ult.en }
        : null,
    };
  }

  async lista(organizationId: string, departamentoId: string): Promise<unknown> {
    validarSeleccion(organizationId, departamentoId);
    return {
      organizationId,
      departamento: departamentoId,
      evaluaciones: await this.svc().listar(this.ctx(organizationId), departamentoId),
    };
  }

  async iniciar(
    organizationId: string,
    departamentoId: string,
    titulo: string | null,
  ): Promise<unknown> {
    const dep = validarSeleccion(organizationId, departamentoId);
    const evaluacionId = randomUUID();
    const st = await this.svc().iniciar(
      this.ctx(organizationId),
      departamentoId,
      evaluacionId,
      dep.rubroId,
      titulo,
      ATRIBUCION,
      this.clock.now(),
    );
    return this.dto(organizationId, departamentoId, st);
  }

  async estado(
    organizationId: string,
    departamentoId: string,
    evaluacionId: string,
  ): Promise<unknown> {
    validarSeleccion(organizationId, departamentoId);
    const st = await this.svc().cargar(this.ctx(organizationId), departamentoId, evaluacionId);
    return this.dto(organizationId, departamentoId, st);
  }

  async responder(
    organizationId: string,
    departamentoId: string,
    evaluacionId: string,
    preguntaId: string,
    entrada: EntradaRespuesta,
  ): Promise<unknown> {
    validarSeleccion(organizationId, departamentoId);
    const pregunta = this.cuestionario().find((p) => p.preguntaId === preguntaId);
    if (!pregunta) throw new PreguntaFueraDelRubroError(preguntaId);
    const st = await this.svc().responder(
      this.ctx(organizationId),
      departamentoId,
      evaluacionId,
      { preguntaId, tipoPregunta: pregunta.tipo, entrada },
      ATRIBUCION,
      this.clock.now(),
    );
    return this.dto(organizationId, departamentoId, st);
  }

  async generar(
    organizationId: string,
    departamentoId: string,
    evaluacionId: string,
  ): Promise<unknown> {
    validarSeleccion(organizationId, departamentoId);
    const st = await this.svc().generar(
      this.ctx(organizationId),
      departamentoId,
      evaluacionId,
      randomUUID(),
      ATRIBUCION,
      this.clock.now(),
    );
    return this.dto(organizationId, departamentoId, st);
  }

  async cerrar(
    organizationId: string,
    departamentoId: string,
    evaluacionId: string,
  ): Promise<unknown> {
    validarSeleccion(organizationId, departamentoId);
    const st = await this.svc().cerrar(
      this.ctx(organizationId),
      departamentoId,
      evaluacionId,
      ATRIBUCION,
      this.clock.now(),
    );
    return this.dto(organizationId, departamentoId, st);
  }
}

export class PreguntaFueraDelRubroError extends Error {
  constructor(preguntaId: string) {
    super(`La pregunta no pertenece al cuestionario gobernado del rubro: ${preguntaId}`);
    this.name = 'PreguntaFueraDelRubroError';
  }
}
