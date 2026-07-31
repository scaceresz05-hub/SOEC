/**
 * @soec/estrategia-creativa · aplicación · ORQUESTADOR end-to-end del Motor de Generación (Tramos
 * A/B/C/H). COMPONE los dominios existentes sin duplicarlos: puebla el `Programa` desde el cerebro
 * comercial, vincula campañas derivadas (sin fixtures), GENERA el cuerpo de contenido por el puerto
 * neutral `ProveedorGenerativo` (validando la salida, nunca confiando en ella), y ejecuta el ciclo
 * existente `CicloProgramaService` (aprobación gobernada → ejecución simulada → medición → aprendizaje
 * canónico). Todo SIMULADO, sin proveedores externos ni efectos reales. Idempotente y reconstruible.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import { CicloProgramaService, ProgramaService } from '@soec/programas';
import type { VistaPrograma } from '@soec/programas';
import { ProveedorGenerativoDeterminista, type ProveedorGenerativo, type SolicitudGenerativa, validarRespuesta } from '@soec/contenido';
import { EstrategiaCreativaService } from './estrategia-creativa-service';
import { EstrategiaCreativaArtefactoService } from './artefacto-creativo-service';
import { VariantesABService } from './variantes-ab-service';
import { CalendarioEditorialService } from './calendario-service';
import { AprobacionService } from './aprobacion-service';
import { derivarContenidoArtefacto, estrategiaCreativaId } from '../domain/artefacto-creativo';
import type { ParametrosCampania } from '../domain/conexion';
import type { BriefComercial, EstrategiaCreativa } from '../domain/estrategia-creativa';
import type { Programa } from '@soec/programas';

const DIA_MS = 86_400_000;

/** Versión de las piezas creadas por el orquestador: se emiten una vez (contenido inmutable en este flujo). */
const VERSION_PIEZA = 1;

export type ResultadoOrquestacion =
  | { readonly tipo: 'PROPUESTA'; readonly vista: VistaPrograma }
  | { readonly tipo: 'PENDIENTE_APROBACION'; readonly faltantes: readonly string[] }
  | { readonly tipo: 'ABSTENCION'; readonly faltantes: readonly string[] };

export type ResultadoPreparacion =
  | { readonly tipo: 'PREPARADO'; readonly piezas: readonly string[]; readonly yaEjecutado: boolean }
  | { readonly tipo: 'ABSTENCION'; readonly faltantes: readonly string[] };

export class OrquestadorProgramaGenerativo {
  private readonly estrategia: EstrategiaCreativaService;
  private readonly programas: ProgramaService;
  private readonly ciclo: CicloProgramaService;
  private readonly proveedor: ProveedorGenerativo;
  private readonly artefactos: EstrategiaCreativaArtefactoService;
  private readonly ab: VariantesABService;
  private readonly calendario: CalendarioEditorialService;
  private readonly aprobacion: AprobacionService;
  constructor(store: EventStore, opts?: { proveedor?: ProveedorGenerativo; estrategia?: EstrategiaCreativaService }) {
    this.estrategia = opts?.estrategia ?? new EstrategiaCreativaService(store);
    this.programas = new ProgramaService(store);
    this.ciclo = new CicloProgramaService(store);
    this.proveedor = opts?.proveedor ?? new ProveedorGenerativoDeterminista();
    this.artefactos = new EstrategiaCreativaArtefactoService(store);
    this.ab = new VariantesABService(store);
    this.calendario = new CalendarioEditorialService(store);
    this.aprobacion = new AprobacionService(store);
  }

  private piezasDe(prog: Programa): readonly string[] {
    return prog.campanias.flatMap((c) => c.contenidoIds);
  }

  /**
   * ATAJO de piloto (todo-en-uno): prepara el programa, lo aprueba con un actor humano SIMULADO y ejecuta
   * el ciclo. La aprobación de piloto está claramente separada (`aprobarComoPilotoHumano`) y registra al
   * actor del contexto; NUNCA ocurre dentro de `ejecutarSimulado`. Idempotente. ABSTIENE si no es evaluable.
   */
  async generarPrograma(ctx: RequestContext, programaId: string, params: ParametrosCampania, a: Attribution, o: string): Promise<ResultadoOrquestacion> {
    const prep = await this.prepararPrograma(ctx, programaId, params, a, o);
    if (prep.tipo === 'ABSTENCION') return prep;
    await this.aprobarComoPilotoHumano(ctx, prep.piezas, a, o);
    return this.ejecutarSimulado(ctx, programaId, a, o);
  }

  /**
   * ETAPA 1 (Tramo H) — PREPARA todo lo generable sin ejecutar ni publicar: puebla el programa, deriva la
   * estrategia creativa (artefactos versionados), campañas, contenido generado por el puerto neutral,
   * variantes A/B y calendario. Deja las piezas EN ESPERA de aprobación humana. Idempotente y reconstruible.
   */
  async prepararPrograma(ctx: RequestContext, programaId: string, params: ParametrosCampania, a: Attribution, o: string): Promise<ResultadoPreparacion> {
    const prog0 = await this.programas.cargar(ctx, programaId);
    if (prog0.existe && (prog0.estado === 'EN_EJECUCION' || prog0.estado === 'EVALUADO')) {
      return { tipo: 'PREPARADO', piezas: this.piezasDe(prog0), yaEjecutado: true };
    }

    const pob = await this.estrategia.poblarPrograma(ctx, programaId, params, a, o);
    if (pob.tipo === 'ABSTENCION') return pob;
    const con = await this.estrategia.derivarConexion(ctx, params);
    if (con.tipo === 'ABSTENCION') return con;
    const { brief, estrategia, hipotesis } = con.paquete;
    const canal = params.canales[0] ?? 'correo';
    const presupuestoPorCampania = Math.max(1, Math.floor(params.presupuestoTotal / Math.max(1, hipotesis.length)));
    const objetivoId = `obj-${programaId}`;
    const briefId = `brief-${programaId}`;

    // Tramo D: persistir un artefacto de estrategia creativa de 1.ª clase por hipótesis (versionado,
    // con afirmaciones ligadas a evidencia). El contenido registrará qué versión de estrategia usó.
    const { state, hips } = await this.estrategia.contextoComercial(ctx);
    const versionPorHipotesis = new Map<string, { id: string; version: number }>();
    for (const h of hipotesis) {
      const hipState = hips.find((x) => x.hipotesisId === h.id);
      if (!hipState) continue;
      const contenido = derivarContenidoArtefacto(state, brief, estrategia, hipState, { programaId, objetivoId, segmentoId: h.segmentoId, briefId, politicaVersion: 'creativa-v1' });
      const estId = estrategiaCreativaId(programaId, h.id);
      const art = await this.artefactos.establecer(ctx, estId, contenido, a, o);
      versionPorHipotesis.set(h.id, { id: estId, version: art.artefacto?.version ?? 1 });
    }

    await this.calendario.crear(ctx, programaId, 'UTC', a, o); // Tramo F: calendario editorial

    for (const h of hipotesis) {
      const idxH = hipotesis.indexOf(h);
      const prog = await this.programas.cargar(ctx, programaId);
      if (prog.campanias.some((c) => c.hipotesisId === h.id)) continue; // idempotente: ya vinculada
      const conCampania = await this.programas.vincularCampania(
        ctx,
        programaId,
        {
          nombre: `Campaña ${h.segmentoId}`,
          segmentoId: h.segmentoId,
          hipotesisId: h.id,
          publico: brief.audiencia,
          propuesta: estrategia.gancho,
          mensaje: brief.mensajePrincipal,
          canal,
          presupuestoSimulado: presupuestoPorCampania,
          duracionHipotetica: `${params.horizonteDias} días`,
        },
        a,
        o,
      );
      const campaignId = conCampania.campanias[conCampania.campanias.length - 1]!.campaignId;
      const ref = versionPorHipotesis.get(h.id);
      const estrategiaRef = ref ? `${ref.id}@v${ref.version}` : `estrategia:${programaId}`;
      const cuerpo = await this.generarCuerpo(ctx, brief, estrategia, params.idioma, estrategiaRef);
      if (cuerpo === null) return { tipo: 'ABSTENCION', faltantes: ['la generación de contenido no produjo una salida válida (rechazada por validación)'] };
      const conContenido = await this.programas.vincularContenido(
        ctx,
        programaId,
        campaignId,
        { canal, cuerpo, marcaId: `marca-${brief.empresa}`, productoServicio: brief.producto, llamadaAccion: estrategia.mensajesClave[0] ?? 'Solicita más información', idioma: params.idioma },
        a,
        o,
      );
      const refCamp = conContenido.campanias.find((c) => c.campaignId === campaignId);
      const piezaBaseId = refCamp?.contenidoIds[refCamp.contenidoIds.length - 1];
      if (piezaBaseId) {
        // Tramo E: dos variantes A/B que cambian UNA sola variable (gancho), constantes compartidas.
        const constantes = ['cta', 'oferta', 'audiencia'];
        await this.ab.agregarVariante(ctx, piezaBaseId, { varianteId: `${piezaBaseId}-A`, hipotesisQuePrueba: h.propuesta, elementoModificado: 'gancho', diferenciaControlada: `gancho A: ${estrategia.gancho}`, elementosConstantes: constantes, criterioExito: h.criterioContinuacion }, a, o);
        await this.ab.agregarVariante(ctx, piezaBaseId, { varianteId: `${piezaBaseId}-B`, hipotesisQuePrueba: h.propuesta, elementoModificado: 'gancho', diferenciaControlada: `gancho B: ${estrategia.mensajesClave[1] ?? estrategia.concepto}`, elementosConstantes: constantes, criterioExito: h.criterioContinuacion }, a, o);
        // Tramo F: una entrada de calendario por pieza, con fecha determinista según frecuencia.
        const fechaHora = new Date(Date.parse(o) + (idxH + 1) * Math.max(1, params.frecuenciaDias) * DIA_MS).toISOString();
        await this.calendario.agregarEntrada(ctx, programaId, { entradaId: `cal-${piezaBaseId}`, fechaHora, canal, piezaId: piezaBaseId, objetivo: params.objetivoMarketing, segmento: h.segmentoId }, a, o);
      }
    }

    const progFin = await this.programas.cargar(ctx, programaId);
    return { tipo: 'PREPARADO', piezas: this.piezasDe(progFin), yaEjecutado: false };
  }

  /**
   * ETAPA 2 (Tramo H) — EJECUTA el ciclo simulado (aprobación gobernada → ejecución simulada → medición →
   * aprendizaje) SOLO si cada pieza tiene aprobación humana vigente para su versión. Si falta alguna,
   * NO ejecuta y devuelve `PENDIENTE_APROBACION` con las piezas pendientes. Nunca se autoaprueba aquí.
   */
  async ejecutarSimulado(ctx: RequestContext, programaId: string, a: Attribution, o: string): Promise<ResultadoOrquestacion> {
    const prog = await this.programas.cargar(ctx, programaId);
    if (!prog.existe) return { tipo: 'ABSTENCION', faltantes: ['el programa no existe; prepararlo primero'] };
    if (prog.estado === 'EN_EJECUCION' || prog.estado === 'EVALUADO') {
      return { tipo: 'PROPUESTA', vista: await this.ciclo.ejecutarCiclo(ctx, programaId, a, o) };
    }
    const piezas = this.piezasDe(prog);
    if (piezas.length === 0) return { tipo: 'ABSTENCION', faltantes: ['no hay piezas generadas para ejecutar'] };
    const pendientes: string[] = [];
    for (const p of piezas) if (!(await this.aprobacion.estaAprobada(ctx, 'PIEZA', p, VERSION_PIEZA))) pendientes.push(p);
    if (pendientes.length > 0) return { tipo: 'PENDIENTE_APROBACION', faltantes: pendientes.map((p) => `pieza sin aprobación humana vigente: ${p}`) };
    return { tipo: 'PROPUESTA', vista: await this.ciclo.ejecutarCiclo(ctx, programaId, a, o) };
  }

  /**
   * PILOTO: firma como un director humano (actor tomado del contexto autenticado) todas las piezas dadas.
   * Está deliberadamente separado del flujo automático y jamás se llama desde `ejecutarSimulado`: existe
   * solo para el atajo `generarPrograma`. Cada decisión queda registrada y auditable con su actor.
   */
  private async aprobarComoPilotoHumano(ctx: RequestContext, piezas: readonly string[], a: Attribution, o: string): Promise<void> {
    for (const p of piezas) {
      await this.aprobacion.decidir(ctx, { resourceType: 'PIEZA', resourceId: p, resourceVersion: VERSION_PIEZA, decision: 'APROBADA', comment: 'aprobación de piloto (director humano simulado)', scope: 'PIEZA' }, a, o);
    }
  }

  /** Tramo C: genera el cuerpo por el puerto neutral y lo VALIDA; devuelve null si es inválido. */
  private async generarCuerpo(ctx: RequestContext, brief: BriefComercial, estrategia: EstrategiaCreativa, idioma: string, estrategiaRef: string): Promise<string | null> {
    const solicitud: SolicitudGenerativa = {
      tarea: 'pieza_fuente',
      contexto: {
        audiencia: brief.audiencia,
        problemaCliente: brief.problemaCliente,
        propuestaValor: brief.propuestaValor,
        productoServicio: brief.producto,
        mensajePrincipal: brief.mensajePrincipal,
        llamadaAccion: estrategia.mensajesClave[0] ?? 'Solicita más información',
      },
      esquemaSalida: ['cuerpo'],
      idioma,
      limiteCaracteres: 0,
      evitar: [],
      promptRef: 'prompt:pieza-comercial@v1',
      trazabilidad: `${estrategiaRef}|brief:${brief.empresa}:${brief.producto}`,
    };
    const r = await this.proveedor.generar(ctx, solicitud);
    const val = validarRespuesta(r, ['cuerpo'], 0);
    if (!val.valida || !r.salida) return null;
    const cuerpo = r.salida.campos['cuerpo'];
    return cuerpo && cuerpo.trim() ? cuerpo : null;
  }
}
