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
import { derivarContenidoArtefacto, estrategiaCreativaId } from '../domain/artefacto-creativo';
import type { ParametrosCampania } from '../domain/conexion';
import type { BriefComercial, EstrategiaCreativa } from '../domain/estrategia-creativa';

export type ResultadoOrquestacion =
  | { readonly tipo: 'PROPUESTA'; readonly vista: VistaPrograma }
  | { readonly tipo: 'ABSTENCION'; readonly faltantes: readonly string[] };

export class OrquestadorProgramaGenerativo {
  private readonly estrategia: EstrategiaCreativaService;
  private readonly programas: ProgramaService;
  private readonly ciclo: CicloProgramaService;
  private readonly proveedor: ProveedorGenerativo;
  private readonly artefactos: EstrategiaCreativaArtefactoService;
  constructor(store: EventStore, opts?: { proveedor?: ProveedorGenerativo; estrategia?: EstrategiaCreativaService }) {
    this.estrategia = opts?.estrategia ?? new EstrategiaCreativaService(store);
    this.programas = new ProgramaService(store);
    this.ciclo = new CicloProgramaService(store);
    this.proveedor = opts?.proveedor ?? new ProveedorGenerativoDeterminista();
    this.artefactos = new EstrategiaCreativaArtefactoService(store);
  }

  /**
   * Corre el flujo completo desde el conocimiento comercial hasta el aprendizaje, sobre datos reales.
   * ABSTIENE (sin ejecutar nada) si el conocimiento no es evaluable. Idempotente: re-ejecutar no
   * duplica campañas/contenidos y reconstruye la vista si el ciclo ya corrió.
   */
  async generarPrograma(ctx: RequestContext, programaId: string, params: ParametrosCampania, a: Attribution, o: string): Promise<ResultadoOrquestacion> {
    // Idempotencia: si el ciclo ya corrió, reconstruir la vista sin re-escribir.
    const prog0 = await this.programas.cargar(ctx, programaId);
    if (prog0.existe && (prog0.estado === 'EN_EJECUCION' || prog0.estado === 'EVALUADO')) {
      return { tipo: 'PROPUESTA', vista: await this.ciclo.ejecutarCiclo(ctx, programaId, a, o) };
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

    for (const h of hipotesis) {
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
      await this.programas.vincularContenido(
        ctx,
        programaId,
        campaignId,
        { canal, cuerpo, marcaId: `marca-${brief.empresa}`, productoServicio: brief.producto, llamadaAccion: estrategia.mensajesClave[0] ?? 'Solicita más información', idioma: params.idioma },
        a,
        o,
      );
    }

    const vista = await this.ciclo.ejecutarCiclo(ctx, programaId, a, o);
    return { tipo: 'PROPUESTA', vista };
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
