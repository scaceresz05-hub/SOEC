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
import type { TipoRecurso } from '../domain/aprobacion';
import { ValidacionContenidoService } from './validacion-contenido-service';
import { derivarContenidoArtefacto, estrategiaCreativaId } from '../domain/artefacto-creativo';
import { type ParametrosCampania, SEGMENTO_NO_DETERMINADO } from '../domain/conexion';
import type { BriefComercial, EstrategiaCreativa } from '../domain/estrategia-creativa';
import type { Programa } from '@soec/programas';

const DIA_MS = 86_400_000;

/** Piezas generadas por campaña (formatos distintos del mismo mensaje). */
const PIEZAS_POR_CAMPANIA = 2;
const FORMATOS = ['correo', 'anuncio_corto', 'publicacion_educativa'] as const;

/** Recurso que exige aprobación humana antes de ejecutar, ligado a su versión REAL (B-4/B-5). */
export interface RecursoAprobable {
  readonly tipo: TipoRecurso;
  readonly resourceId: string;
  readonly version: number;
}

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
  private readonly validacion: ValidacionContenidoService;
  constructor(store: EventStore, opts?: { proveedor?: ProveedorGenerativo; estrategia?: EstrategiaCreativaService }) {
    this.estrategia = opts?.estrategia ?? new EstrategiaCreativaService(store);
    this.programas = new ProgramaService(store);
    this.ciclo = new CicloProgramaService(store);
    this.proveedor = opts?.proveedor ?? new ProveedorGenerativoDeterminista();
    this.artefactos = new EstrategiaCreativaArtefactoService(store);
    this.ab = new VariantesABService(store);
    this.calendario = new CalendarioEditorialService(store);
    this.aprobacion = new AprobacionService(store);
    this.validacion = new ValidacionContenidoService(store);
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
    await this.aprobarComoPilotoHumano(ctx, programaId, a, o);
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
    const { brief, estrategia } = con.paquete;
    // A-2: sólo se opera sobre hipótesis con segmento DETERMINADO (cada campaña apunta a SU segmento real).
    // Las no determinadas no generan campaña segmentada (no se inventa asociación).
    const hipotesis = con.paquete.hipotesis.filter((h) => h.segmentoId !== SEGMENTO_NO_DETERMINADO);
    if (hipotesis.length === 0) return { tipo: 'ABSTENCION', faltantes: ['ninguna hipótesis tiene un segmento/ICP asociado; asócielas antes de generar'] };
    const canal = params.canales[0] ?? 'correo';
    const presupuestoPorCampania = Math.max(1, Math.floor(params.presupuestoTotal / Math.max(1, hipotesis.length)));
    const objetivoId = `obj-${programaId}`;
    const briefId = `brief-${programaId}`;

    // Tramo D: persistir un artefacto de estrategia creativa de 1.ª clase por hipótesis (versionado,
    // con afirmaciones ligadas a evidencia). El contenido registrará qué versión de estrategia usó.
    const { state, hips } = await this.estrategia.contextoComercial(ctx);
    const versionPorHipotesis = new Map<string, { id: string; version: number; afirmacionesPermitidas: readonly string[]; restricciones: readonly string[]; pruebaSocialPermitida: boolean }>();
    for (const h of hipotesis) {
      const hipState = hips.find((x) => x.hipotesisId === h.id);
      if (!hipState) continue;
      const contenido = derivarContenidoArtefacto(state, brief, estrategia, hipState, { programaId, objetivoId, segmentoId: h.segmentoId, briefId, politicaVersion: 'creativa-v1' });
      const estId = estrategiaCreativaId(programaId, h.id);
      const art = await this.artefactos.establecer(ctx, estId, contenido, a, o);
      versionPorHipotesis.set(h.id, { id: estId, version: art.artefacto?.version ?? 1, afirmacionesPermitidas: contenido.afirmacionesPermitidas, restricciones: contenido.restricciones, pruebaSocialPermitida: contenido.pruebaSocialPermitida });
    }

    await this.calendario.crear(ctx, programaId, 'UTC', a, o); // Tramo F: calendario editorial

    for (const h of hipotesis) {
      const idxH = hipotesis.indexOf(h);
      const prog = await this.programas.cargar(ctx, programaId);
      // Idempotencia de grano fino (Tramo I): reusar la campaña si ya existe (no volver a vincular), pero
      // NUNCA saltar las sub-etapas — un fallo parcial pudo dejar la campaña sin contenido/variantes/agenda.
      let campania = prog.campanias.find((c) => c.hipotesisId === h.id);
      if (!campania) {
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
        campania = conCampania.campanias[conCampania.campanias.length - 1]!;
      }
      const campaignId = campania.campaignId;
      // Generar PIEZAS_POR_CAMPANIA piezas por el puerto neutral (idempotente: sólo se completan las que
      // falten, reusando las ya persistidas ante un reintento tras un fallo parcial).
      const ref = versionPorHipotesis.get(h.id);
      const estrategiaRef = ref ? `${ref.id}@v${ref.version}` : `estrategia:${programaId}`;
      const politica = { afirmacionesPermitidas: ref?.afirmacionesPermitidas ?? [], restricciones: ref?.restricciones ?? [], pruebaSocialPermitida: ref?.pruebaSocialPermitida ?? false };
      let piezas = [...campania.contenidoIds];
      for (let f = piezas.length; f < PIEZAS_POR_CAMPANIA; f++) {
        const formato = FORMATOS[f] ?? `f${f}`;
        const cuerpo = await this.generarCuerpo(ctx, brief, estrategia, params.idioma, `${estrategiaRef}|formato:${formato}`, politica, { referencia: `${ref?.id ?? programaId}:${formato}`, politicaVersion: 'creativa-v1' }, a, o, FORMATOS[f]);
        if (cuerpo === null) return { tipo: 'ABSTENCION', faltantes: [`la generación de contenido para "${h.id}" no pasó la validación comercial (afirmación no respaldada o restricción); ver registro de validación`] };
        const conContenido = await this.programas.vincularContenido(
          ctx,
          programaId,
          campaignId,
          { canal, cuerpo, marcaId: `marca-${brief.empresa}`, productoServicio: brief.producto, llamadaAccion: estrategia.mensajesClave[0] ?? 'Solicita más información', idioma: params.idioma },
          a,
          o,
        );
        piezas = [...(conContenido.campanias.find((c) => c.campaignId === campaignId)?.contenidoIds ?? piezas)];
      }
      const piezaBaseId = piezas[0];
      if (piezaBaseId) {
        // Tramo E: dos variantes A/B sobre la pieza base que cambian UNA sola variable (gancho).
        const constantes = ['cta', 'oferta', 'audiencia'];
        await this.ab.agregarVariante(ctx, piezaBaseId, { varianteId: `${piezaBaseId}-A`, hipotesisQuePrueba: h.propuesta, elementoModificado: 'gancho', diferenciaControlada: `gancho A: ${estrategia.gancho}`, elementosConstantes: constantes, criterioExito: h.criterioContinuacion }, a, o);
        await this.ab.agregarVariante(ctx, piezaBaseId, { varianteId: `${piezaBaseId}-B`, hipotesisQuePrueba: h.propuesta, elementoModificado: 'gancho', diferenciaControlada: `gancho B: ${estrategia.mensajesClave[1] ?? estrategia.concepto}`, elementosConstantes: constantes, criterioExito: h.criterioContinuacion }, a, o);
        // Tramo F: una entrada de calendario por pieza, con fecha determinista según frecuencia.
        for (let i = 0; i < piezas.length; i++) {
          const pieza = piezas[i]!;
          const fechaHora = new Date(Date.parse(o) + ((idxH * PIEZAS_POR_CAMPANIA + i) + 1) * Math.max(1, params.frecuenciaDias) * DIA_MS).toISOString();
          await this.calendario.agregarEntrada(ctx, programaId, { entradaId: `cal-${pieza}`, fechaHora, canal, piezaId: pieza, objetivo: params.objetivoMarketing, segmento: h.segmentoId }, a, o);
        }
      }
    }

    const progFin = await this.programas.cargar(ctx, programaId);
    return { tipo: 'PREPARADO', piezas: this.piezasDe(progFin), yaEjecutado: false };
  }

  /**
   * B-5: versión de aprobación de una pieza = versión REAL del artefacto de estrategia de su hipótesis
   * (ya no una constante). Si el artefacto cambia (por un cambio real de conocimiento/estrategia, B-1),
   * su versión sube y las aprobaciones ligadas a la versión anterior dejan de valer.
   */
  private async versionArtefacto(ctx: RequestContext, programaId: string, hipotesisId: string): Promise<number> {
    const art = await this.artefactos.cargar(ctx, estrategiaCreativaId(programaId, hipotesisId));
    return art.artefacto?.version ?? 1;
  }

  /**
   * B-4/B-5: TODOS los recursos que exigen aprobación humana antes de ejecutar (piezas, variantes A/B y
   * entradas de calendario), cada uno ligado a la versión REAL del artefacto de su hipótesis. Es la lista
   * canónica que consulta el gate y que aprueba el piloto/humano. Público para que la API/UI la usen.
   */
  async recursosParaAprobar(ctx: RequestContext, programaId: string): Promise<readonly RecursoAprobable[]> {
    const prog = await this.programas.cargar(ctx, programaId);
    if (!prog.existe) return [];
    const recursos: RecursoAprobable[] = [];
    const versionPorCampania = new Map<string, number>();
    for (const camp of prog.campanias) {
      const v = await this.versionArtefacto(ctx, programaId, camp.hipotesisId);
      versionPorCampania.set(camp.campaignId, v);
      for (const pieza of camp.contenidoIds) {
        recursos.push({ tipo: 'PIEZA', resourceId: pieza, version: v });
        const ab = await this.ab.cargar(ctx, pieza);
        for (const variante of ab.variantes) recursos.push({ tipo: 'VARIANTE', resourceId: variante.varianteId, version: v });
      }
    }
    const cal = await this.calendario.cargar(ctx, programaId);
    for (const e of cal.entradas) {
      const camp = prog.campanias.find((c) => c.contenidoIds.includes(e.piezaId));
      const v = camp ? (versionPorCampania.get(camp.campaignId) ?? 1) : 1;
      recursos.push({ tipo: 'ENTRADA_CALENDARIO', resourceId: e.entradaId, version: v });
    }
    return recursos;
  }

  /**
   * ETAPA 2 (Tramo H) — EJECUTA el ciclo simulado SOLO si TODOS los recursos (piezas, variantes y entradas
   * de calendario) tienen aprobación humana vigente para su versión REAL. Si falta alguna, NO ejecuta y
   * devuelve `PENDIENTE_APROBACION`. Nunca se autoaprueba aquí.
   */
  async ejecutarSimulado(ctx: RequestContext, programaId: string, a: Attribution, o: string): Promise<ResultadoOrquestacion> {
    const prog = await this.programas.cargar(ctx, programaId);
    if (!prog.existe) return { tipo: 'ABSTENCION', faltantes: ['el programa no existe; prepararlo primero'] };
    if (prog.estado === 'EN_EJECUCION' || prog.estado === 'EVALUADO') {
      return { tipo: 'PROPUESTA', vista: await this.ciclo.ejecutarCiclo(ctx, programaId, a, o) };
    }
    if (this.piezasDe(prog).length === 0) return { tipo: 'ABSTENCION', faltantes: ['no hay piezas generadas para ejecutar'] };
    const recursos = await this.recursosParaAprobar(ctx, programaId);
    const pendientes: string[] = [];
    for (const r of recursos) if (!(await this.aprobacion.estaAprobada(ctx, r.tipo, r.resourceId, r.version))) pendientes.push(`${r.tipo} ${r.resourceId} (v${r.version})`);
    if (pendientes.length > 0) return { tipo: 'PENDIENTE_APROBACION', faltantes: pendientes.map((p) => `recurso sin aprobación humana vigente: ${p}`) };
    return { tipo: 'PROPUESTA', vista: await this.ciclo.ejecutarCiclo(ctx, programaId, a, o) };
  }

  /**
   * PILOTO: firma como un director humano (actor del contexto) TODOS los recursos aprobables del programa,
   * en su versión real. Deliberadamente separado del flujo automático y jamás llamado desde
   * `ejecutarSimulado`: existe solo para el atajo `generarPrograma`. Cada decisión queda auditable.
   */
  private async aprobarComoPilotoHumano(ctx: RequestContext, programaId: string, a: Attribution, o: string): Promise<void> {
    for (const r of await this.recursosParaAprobar(ctx, programaId)) {
      await this.aprobacion.decidir(ctx, { resourceType: r.tipo, resourceId: r.resourceId, resourceVersion: r.version, decision: 'APROBADA', comment: 'aprobación de piloto (director humano simulado)', scope: r.tipo }, a, o);
    }
  }

  /**
   * Tramo C + A-3: genera el cuerpo por el puerto neutral, lo valida ESTRUCTURAL y SEMÁNTICAMENTE (contra
   * afirmaciones permitidas/restricciones/prueba social) y registra el veredicto. Devuelve null si es
   * inválido — nunca "confía" en la salida del proveedor: sólo pasa contenido sin afirmaciones no
   * respaldadas. Pasa las restricciones al proveedor como `evitar` (defensa en profundidad).
   */
  private async generarCuerpo(
    ctx: RequestContext,
    brief: BriefComercial,
    estrategia: EstrategiaCreativa,
    idioma: string,
    estrategiaRef: string,
    politica: { afirmacionesPermitidas: readonly string[]; restricciones: readonly string[]; pruebaSocialPermitida: boolean },
    meta: { referencia: string; politicaVersion: string },
    a: Attribution,
    o: string,
    formato?: string,
  ): Promise<string | null> {
    const mensajePrincipal = formato ? `${brief.mensajePrincipal} [formato: ${formato}]` : brief.mensajePrincipal;
    const promptRef = 'prompt:pieza-comercial@v1';
    const solicitud: SolicitudGenerativa = {
      tarea: 'pieza_fuente',
      contexto: {
        audiencia: brief.audiencia,
        problemaCliente: brief.problemaCliente,
        propuestaValor: brief.propuestaValor,
        productoServicio: brief.producto,
        mensajePrincipal,
        llamadaAccion: estrategia.mensajesClave[0] ?? 'Solicita más información',
      },
      esquemaSalida: ['cuerpo'],
      idioma,
      limiteCaracteres: 0,
      evitar: [...politica.restricciones], // A-3: ya no es [] — las restricciones reales van al proveedor
      promptRef,
      trazabilidad: `${estrategiaRef}|brief:${brief.empresa}:${brief.producto}`,
    };
    const r = await this.proveedor.generar(ctx, solicitud);
    const val = validarRespuesta(r, ['cuerpo'], 0);
    if (!val.valida || !r.salida) return null;
    const cuerpo = r.salida.campos['cuerpo'];
    if (!cuerpo || !cuerpo.trim()) return null;
    // A-3: validación SEMÁNTICA comercial + registro auditable del veredicto.
    const veredicto = await this.validacion.validarYRegistrar(
      ctx,
      { cuerpo, afirmacionesPermitidas: politica.afirmacionesPermitidas, restricciones: politica.restricciones, pruebaSocialPermitida: politica.pruebaSocialPermitida },
      { referencia: meta.referencia, promptRef, estrategiaRef, politicaVersion: meta.politicaVersion },
      a,
      o,
    );
    return veredicto.resultado === 'VALIDO' ? cuerpo : null; // INVALIDO/REQUIERE_REVISION → no publica
  }
}
