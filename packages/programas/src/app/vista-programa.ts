/**
 * Read-model del Programa: reconstruye desde el EventStore (sin escribir) el programa completo
 * con sus campañas, contenidos, ejecuciones simuladas y resultados, componiendo la información de
 * los agregados A–J por sus ids (no por ids fijos). Cada resultado declara su naturaleza; el ROI
 * es SIMULADO (nunca REAL) reutilizando `evaluarResultadoCampania` de `@soec/medicion`.
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import { AutonomiaService } from '@soec/autonomia';
import { CampaniaService } from '@soec/campanias';
import { ContenidoGobernadoService } from '@soec/contenido-gobernado';
import { AdaptadorSimuladoDeterminista, EjecucionService } from '@soec/ejecucion-simulada';
import { evaluarResultadoCampania, type ClasificacionRoi } from '@soec/medicion';
import { AprendizajeService } from '@soec/aprendizaje';
import { reconstruirPrograma, type EstadoPrograma, presupuestoComprometido } from '../domain/programa';

export type Naturaleza = 'REAL' | 'SIMULADO' | 'ESTIMADO' | 'DESCONOCIDO';

export interface ContenidoVista {
  readonly contenidoId: string;
  readonly estado: string;
  readonly canal: string;
}
export interface EjecucionVista {
  readonly requestId: string;
  readonly resultado: string;
  readonly naturaleza: Naturaleza; // SIEMPRE SIMULADO
}
export interface CampaniaVista {
  readonly campaignId: string;
  readonly nombreSegmento: string;
  readonly publico: string;
  readonly estadoCampania: string;
  readonly presupuestoSimulado: number;
  readonly contenidos: readonly ContenidoVista[];
  readonly ejecuciones: readonly EjecucionVista[];
  readonly roi: { readonly valor: number | null; readonly clasificacion: ClasificacionRoi; readonly naturaleza: Naturaleza };
}
export interface VistaPrograma {
  readonly organizacionActiva: string;
  readonly programaId: string;
  readonly nombre: string;
  readonly objetivoPrincipal: string;
  readonly estadoPrograma: EstadoPrograma;
  readonly modoSeguro: boolean;
  readonly nivelAutonomia: number;
  readonly modoEjecucion: 'PILOT';
  readonly presupuesto: { readonly totalSimulado: number; readonly comprometidoSimulado: number; readonly moneda: string };
  readonly segmentos: readonly { readonly id: string; readonly nombre: string; readonly prioridad: number }[];
  readonly hipotesis: readonly { readonly id: string; readonly mensaje: string; readonly estado: string }[];
  readonly campanias: readonly CampaniaVista[];
  readonly aprendizajes: readonly { readonly conclusion: string; readonly reutilizable: boolean }[];
  readonly avisos: readonly string[];
  readonly proximaRecomendacion: string;
}

function naturalezaRoi(c: ClasificacionRoi): Naturaleza {
  switch (c) {
    case 'REAL':
      return 'REAL';
    case 'SIMULADO':
      return 'SIMULADO';
    case 'ESTIMADO':
      return 'ESTIMADO';
    default:
      return 'DESCONOCIDO';
  }
}

/** Mide el resultado SIMULADO de una campaña ya ejecutada (gasto e ingresos simulados). */
function medirSimulado(org: string, campaignId: string, presupuesto: number) {
  return evaluarResultadoCampania({
    organizacionId: org,
    campaignRef: campaignId,
    ventana: 'periodo-simulado',
    gasto: { valor: presupuesto, procedencia: 'SIMULADA' },
    ingresos: { valor: Math.round(presupuesto * 2.6), procedencia: 'SIMULADA' },
    conversiones: [{ id: `${campaignId}-v1`, externalRef: null, campaignRef: campaignId, valor: Math.round(presupuesto * 2.6), ocurridoEn: '2026-08-15T00:00:00.000Z' }],
    periodoCompleto: true,
  });
}

export async function reconstruirVistaPrograma(store: EventStore, ctx: RequestContext, programaId: string): Promise<VistaPrograma | null> {
  const org = String(ctx.organizationId);
  const programa = reconstruirPrograma(org, programaId, await store.readStream(ctx, `programa:${org}:${programaId}`));
  if (!programa.existe) return null;

  const campanias = new CampaniaService(store);
  const contenidos = new ContenidoGobernadoService(store);
  const ejecuciones = new EjecucionService(store, new AdaptadorSimuladoDeterminista());
  const autonomiaEstado = await new AutonomiaService(store).cargar(ctx);

  const campaniasVista: CampaniaVista[] = [];
  let algunaEjecutada = false;
  for (const ref of programa.campanias) {
    const campania = await campanias.cargar(ctx, ref.campaignId);
    const contenidosVista: ContenidoVista[] = [];
    let publicacionesSimuladas = 0;
    const ejecucionesVista: EjecucionVista[] = [];
    for (const contenidoId of ref.contenidoIds) {
      const cont = await contenidos.cargar(ctx, contenidoId);
      contenidosVista.push({ contenidoId, estado: cont.estado, canal: cont.canal });
      const ejec = await ejecuciones.cargar(ctx, contenidoId);
      publicacionesSimuladas += ejec.publicacionesSimuladas;
      for (const r of ejec.registros) ejecucionesVista.push({ requestId: r.requestId, resultado: r.resultado, naturaleza: 'SIMULADO' });
    }
    if (publicacionesSimuladas > 0) algunaEjecutada = true;
    const resultado = publicacionesSimuladas > 0 ? medirSimulado(org, ref.campaignId, ref.presupuestoSimulado) : null;
    campaniasVista.push({
      campaignId: ref.campaignId,
      nombreSegmento: programa.segmentos.find((s) => s.id === ref.segmentoId)?.nombre ?? ref.segmentoId,
      publico: campania.publico,
      estadoCampania: campania.estado,
      presupuestoSimulado: ref.presupuestoSimulado,
      contenidos: contenidosVista,
      ejecuciones: ejecucionesVista,
      roi: resultado
        ? { valor: resultado.roiEstimado, clasificacion: resultado.clasificacion, naturaleza: naturalezaRoi(resultado.clasificacion) }
        : { valor: null, clasificacion: 'NO_EVALUABLE', naturaleza: 'DESCONOCIDO' },
    });
  }

  // Aprendizajes del programa (por convención `apr:<programaId>`); si no existe, lista vacía.
  const aprendizaje = await new AprendizajeService(store).cargar(ctx, `apr-${programaId}`);
  const aprendizajes = aprendizaje.existe && aprendizaje.conclusion ? [{ conclusion: aprendizaje.conclusion.enunciado, reutilizable: aprendizaje.reutilizable !== null }] : [];

  const avisos = [
    'No se ejecutan campañas reales.',
    'No se realiza gasto real.',
    'Todos los resultados de esta versión son simulados.',
  ];

  return {
    organizacionActiva: org,
    programaId,
    nombre: programa.nombre,
    objetivoPrincipal: programa.objetivoPrincipal,
    estadoPrograma: programa.estado,
    modoSeguro: autonomiaEstado.pausado,
    nivelAutonomia: autonomiaEstado.nivel,
    modoEjecucion: 'PILOT',
    presupuesto: { totalSimulado: programa.presupuestoTotalSimulado, comprometidoSimulado: presupuestoComprometido(programa), moneda: programa.moneda },
    segmentos: programa.segmentos.map((s) => ({ id: s.id, nombre: s.nombre, prioridad: s.prioridad })),
    hipotesis: programa.hipotesis.map((h) => ({ id: h.id, mensaje: h.mensaje, estado: h.estado })),
    campanias: campaniasVista,
    aprendizajes,
    avisos,
    proximaRecomendacion: proximaRecomendacion(programa.estado, autonomiaEstado.pausado, programa.campanias.length, algunaEjecutada),
  };
}

function proximaRecomendacion(estado: EstadoPrograma, pausado: boolean, nCampanias: number, ejecutada: boolean): string {
  if (pausado) return 'El sistema está en modo seguro (PAUSA). Reanude con un actor humano antes de avanzar.';
  if (nCampanias === 0) return 'Configure al menos una campaña con contenido antes de ejecutar el ciclo.';
  if (!ejecutada) return 'Ejecute el ciclo (simulado) para medir señales; ningún efecto será real.';
  return 'Resultados SIMULADOS disponibles. No representan ventas ni ingresos reales; úselos solo para comparar señales entre campañas.';
}
