/**
 * apps/api · CAPA DE COMPOSICIÓN · G2-A · EXECUTOR GOBERNADO (DRY-RUN, sin efecto externo).
 *
 * Toma una intención APROBADA y, ANTES de cualquier cosa, evalúa las puertas con estado REAL (kill switch, PAUSA,
 * autorización humana, confinamiento de tenant, evidencia/confianza) y el interruptor maestro AUTONOMOUS_REAL.
 * En G2-A el maestro es false ⇒ NUNCA ejecuta real: sólo DESCRIBE el mutate, SIMULA el read-back y, si no
 * coincide, SIMULA el rollback. FAIL-CLOSED: kill/PAUSA/no-autorización/mismatch impiden declarar "aplicado".
 * Si el rollback simulado también falla ⇒ activa PAUSA (modo seguro) + alerta.
 */
import {
  ActorId,
  OrganizationId,
  type Attribution,
  type EventStore,
  type RequestContext,
} from '@soec/contracts';
import { AutonomiaService } from '@soec/autonomia';
import { KillSwitchService } from '@soec/cia';
import { AUTONOMOUS_REAL } from '@soec/cia';
import {
  confinamientoDe,
  type ConfinamientoTenant,
  type OperacionMutate,
} from './capacidad-negativa';
import { GoogleAdsWriteAdapter } from './google-ads-write-adapter';
import { IntencionService, type EstadoIntencion } from './intencion-cambio';
import { AprobacionService } from './aprobacion-service';

export interface Gate {
  readonly nombre: string;
  readonly paso: boolean;
  readonly detalle: string;
}

/** Escenario del entorno simulado para read-back/rollback (en producción, ambos true por defecto). */
export interface EscenarioSimulado {
  readonly readBackCoincide: boolean;
  readonly rollbackExitoso: boolean;
}
const ESCENARIO_OK: EscenarioSimulado = { readBackCoincide: true, rollbackExitoso: true };

export interface ResultadoEjecucionG2A {
  readonly modo: 'DRY_RUN';
  readonly ejecutadoReal: false;
  readonly puedeEjecutarReal: boolean; // false en G2-A
  readonly gates: readonly Gate[];
  readonly bloqueos: readonly string[];
  readonly mutateDescrito: OperacionMutate | null;
  readonly readBack: {
    readonly aplicable: boolean;
    readonly verificado: boolean;
    readonly expected: string;
    readonly actual: string;
    readonly motivo: string;
  };
  readonly rollback: {
    readonly requerido: boolean;
    readonly descrito: OperacionMutate | null;
    readonly exitoso: boolean;
    readonly pausaActivada: boolean;
  };
  readonly estadoFinalIntencion: EstadoIntencion;
  readonly auditoria: readonly string[];
}

const ATRIB: Attribution = {
  source: 'executor-governado-g2a',
  purpose: 'ejecución gobernada en dry-run (sin efecto externo)',
  assumptions: ['AUTONOMOUS_REAL apagado; ningún mutate real; fail-closed'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

export class ExecutorGovernado {
  private readonly intenciones: IntencionService;
  private readonly aprobaciones: AprobacionService;
  private readonly autonomia: AutonomiaService;
  private readonly kill: KillSwitchService;

  constructor(private readonly store: EventStore) {
    this.intenciones = new IntencionService(store);
    this.aprobaciones = new AprobacionService(store);
    this.autonomia = new AutonomiaService(store);
    this.kill = new KillSwitchService(store);
  }

  /**
   * Ejecuta (en DRY-RUN) una intención. Lee el estado REAL de gobernanza. Nunca envía un mutate real.
   * `escenario` permite probar el read-back/rollback; en producción usar el default (OK).
   */
  async ejecutar(
    org: string,
    intencionId: string,
    ahora: string,
    escenario: EscenarioSimulado = ESCENARIO_OK,
  ): Promise<ResultadoEjecucionG2A> {
    const ctx = this.ctx(org);
    const auditoria: string[] = [];

    const stInt = await this.intenciones.cargar(ctx, intencionId);
    if (!stInt.existe || !stInt.intencion) throw new Error(`intención ${intencionId} no existe`);
    const intencion = stInt.intencion;

    // ── Confinamiento POR ORGANIZACIÓN (configuración registrada). FAIL-CLOSED: una organización sin
    //    perfil/cuenta de Ads no resuelve NADA (jamás la cuenta de otra) ⇒ todas las puertas cierran.
    let confinamiento: ConfinamientoTenant | null = null;
    try {
      confinamiento = confinamientoDe(org);
    } catch {
      confinamiento = null;
    }
    const write = new GoogleAdsWriteAdapter(confinamiento?.customerId ?? 'no-autorizado');

    // ── Estado REAL de gobernanza ──────────────────────────────────────────────
    const killState = await this.kill.cargar(ctx);
    const killActivo = killState.activos.includes('ORG');
    const autoState = await this.autonomia.cargar(ctx);
    const pausado = autoState.pausado;
    const aprob = await this.aprobaciones.estado(ctx, intencionId, ahora);
    const aprobada = aprob.estado === 'APROBADA';

    // ── Puertas (con estado real). El maestro AUTONOMOUS_REAL decide si podría ejecutarse de verdad. ──
    const gates: Gate[] = [
      {
        nombre: 'PERFIL_DE_NEGOCIO',
        paso: confinamiento !== null,
        detalle: `la organización ${org} debe tener perfil de negocio con cuenta externa registrada`,
      },
      {
        nombre: 'CAPACIDAD_HABILITADA',
        paso: write.soporta(intencion.actionType),
        detalle: 'sólo ADD_NEGATIVE_KEYWORD en G2-A',
      },
      {
        nombre: 'CONFINAMIENTO_TENANT',
        paso:
          confinamiento !== null &&
          intencion.org === org &&
          intencion.org === confinamiento.org &&
          intencion.customerId === confinamiento.customerId,
        detalle: `org/customerId deben coincidir con la configuración registrada de ${org}`,
      },
      {
        nombre: 'INTENCION_APROBADA',
        paso: intencion.status === 'APROBADA' || intencion.status === 'LISTA_PARA_EJECUTAR',
        detalle: 'la intención debe estar APROBADA',
      },
      {
        nombre: 'AUTORIZACION_HUMANA',
        paso: aprobada && !!aprob.authorizationRef,
        detalle: 'autorización humana vigente (no expirada, no auto-emitida)',
      },
      {
        nombre: 'KILL_SWITCH',
        paso: !killActivo,
        detalle: 'el kill switch de la organización debe estar inactivo',
      },
      {
        nombre: 'MODO_SEGURO',
        paso: !pausado,
        detalle: 'no debe estar activo el modo seguro (PAUSA)',
      },
      {
        nombre: 'EVIDENCIA_CONFIANZA',
        paso:
          intencion.evidence.suficiente &&
          intencion.confidence === 'alta' &&
          intencion.risk === 'bajo',
        detalle: 'evidencia suficiente, confianza alta, riesgo bajo',
      },
      {
        nombre: 'INTERRUPTOR_MAESTRO_REAL',
        paso: AUTONOMOUS_REAL,
        detalle: 'AUTONOMOUS_REAL debe estar abierto para ejecutar real (G2-A: cerrado ⇒ dry-run)',
      },
    ];
    const bloqueos = gates.filter((g) => !g.paso).map((g) => g.nombre);
    const puedeEjecutarReal = gates.every((g) => g.paso); // en G2-A: false (maestro cerrado)

    // ── FAIL-CLOSED: si una puerta DURA (distinta del maestro) falla, NO se procede ni al dry-run de ejecución. ──
    const durasFallidas = bloqueos.filter((b) => b !== 'INTERRUPTOR_MAESTRO_REAL');
    if (durasFallidas.length > 0) {
      auditoria.push(
        `bloqueado por: ${durasFallidas.join(', ')} — no se ejecuta ni se simula ejecución (fail-closed)`,
      );
      // Confinamiento/capacidad rotos ⇒ intención inválida ⇒ FALLIDA; kill/pausa/no-autorización ⇒ queda pendiente.
      let estadoFinal: EstadoIntencion = intencion.status;
      if (
        durasFallidas.includes('CONFINAMIENTO_TENANT') ||
        durasFallidas.includes('CAPACIDAD_HABILITADA') ||
        durasFallidas.includes('PERFIL_DE_NEGOCIO')
      ) {
        if (
          intencion.status !== 'FALLIDA' &&
          (intencion.status === 'APROBADA' || intencion.status === 'LISTA_PARA_EJECUTAR')
        ) {
          await this.intenciones.marcarFallida(ctx, intencionId, ATRIB, ahora);
          estadoFinal = 'FALLIDA';
        }
      }
      return this.resultado(
        gates,
        bloqueos,
        puedeEjecutarReal,
        null,
        {
          aplicable: false,
          verificado: false,
          expected: intencion.after,
          actual: '(no ejecutado)',
          motivo: 'ejecución bloqueada',
        },
        { requerido: false, descrito: null, exitoso: false, pausaActivada: false },
        estadoFinal,
        auditoria,
      );
    }

    // ── DRY-RUN (maestro cerrado): describir mutate + simular read-back + eventual rollback. Sin efecto externo. ──
    await this.intenciones.marcarLista(ctx, intencionId, ATRIB, ahora);
    const mutate = write.describirMutate({
      actionType: intencion.actionType,
      customerId: intencion.customerId,
      campaignId: intencion.campaignId,
      entityRef: intencion.entityRef,
    });
    auditoria.push(
      `DRY-RUN: se habría enviado → ${mutate.operacion} (NO enviado; AUTONOMOUS_REAL=false)`,
    );

    // Read-back SIMULADO: el Reader (searchStream) confirmaría el estado real. En G2-A se simula el resultado.
    if (escenario.readBackCoincide) {
      const st = await this.intenciones.marcarVerificada(ctx, intencionId, ATRIB, ahora);
      auditoria.push(
        'read-back simulado: el estado real coincide con la intención ⇒ VERIFICADA (dry-run)',
      );
      return this.resultado(
        gates,
        bloqueos,
        puedeEjecutarReal,
        mutate,
        {
          aplicable: true,
          verificado: true,
          expected: intencion.after,
          actual: intencion.after,
          motivo: 'coincide (simulado)',
        },
        { requerido: false, descrito: null, exitoso: false, pausaActivada: false },
        st.intencion!.status,
        auditoria,
      );
    }

    // READBACK_MISMATCH ⇒ ROLLBACK simulado.
    auditoria.push(
      'read-back simulado: MISMATCH (el estado real no coincide) ⇒ se dispara ROLLBACK',
    );
    const rollbackOp = write.describirRollback(
      intencion.customerId,
      `customers/${intencion.customerId}/campaignCriteria/<ref-creada>`,
    );
    if (escenario.rollbackExitoso) {
      const st = await this.intenciones.marcarRevertida(ctx, intencionId, ATRIB, ahora);
      auditoria.push(
        `rollback simulado OK: se habría eliminado la entidad creada ⇒ REVERTIDA (dry-run)`,
      );
      return this.resultado(
        gates,
        bloqueos,
        puedeEjecutarReal,
        mutate,
        {
          aplicable: true,
          verificado: false,
          expected: intencion.after,
          actual: '(distinto)',
          motivo: 'mismatch (simulado)',
        },
        { requerido: true, descrito: rollbackOp, exitoso: true, pausaActivada: false },
        st.intencion!.status,
        auditoria,
      );
    }

    // ROLLBACK FALLIDO ⇒ PAUSA (modo seguro) + alerta. Fail-safe.
    await this.autonomia.pausar(
      ctx,
      `rollback simulado falló para intención ${intencionId}; se activa modo seguro`,
      ATRIB,
      ahora,
    );
    const st = await this.intenciones.marcarFallida(ctx, intencionId, ATRIB, ahora);
    auditoria.push('rollback simulado FALLÓ ⇒ PAUSA activada + alerta (fail-safe)');
    return this.resultado(
      gates,
      bloqueos,
      puedeEjecutarReal,
      mutate,
      {
        aplicable: true,
        verificado: false,
        expected: intencion.after,
        actual: '(distinto)',
        motivo: 'mismatch (simulado)',
      },
      { requerido: true, descrito: rollbackOp, exitoso: false, pausaActivada: true },
      st.intencion!.status,
      auditoria,
    );
  }

  private resultado(
    gates: Gate[],
    bloqueos: string[],
    puedeEjecutarReal: boolean,
    mutateDescrito: OperacionMutate | null,
    readBack: ResultadoEjecucionG2A['readBack'],
    rollback: ResultadoEjecucionG2A['rollback'],
    estadoFinalIntencion: EstadoIntencion,
    auditoria: string[],
  ): ResultadoEjecucionG2A {
    return {
      modo: 'DRY_RUN',
      ejecutadoReal: false,
      puedeEjecutarReal,
      gates,
      bloqueos,
      mutateDescrito,
      readBack,
      rollback,
      estadoFinalIntencion,
      auditoria,
    };
  }

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return {
      organizationId: o,
      actor: ActorId('executor-g2a'),
      scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
      correlationId: `executor-g2a-${org}`,
    };
  }
}
