/**
 * Planificador autónomo DETERMINÍSTICO y auditable (F2-MKT-01 §5). No usa LLM.
 * Traduce un objetivo evaluable + una política vigente en un plan operativo
 * ejecutable: iniciativas → campañas → actividades, con calendario y presupuesto,
 * separando lo ejecutable de lo bloqueado y explicando cada decisión.
 *
 * El planificador PROPONE; jamás publica, accede a adaptadores, salta la
 * autorización ni crea efectos. La ejecución la decide el plano operacional.
 */
import type { VersionPolitica } from '@soec/operacional';
import type { ContenidoObjetivo } from './objetivo';
import type { Actividad, Campania, Iniciativa, PlanVersionContenido } from './plan';

const CANALES_PAGADOS = ['meta_ads', 'google_ads', 'anuncios'];

export interface PlanificarOpts {
  readonly fechaInicio: string; // ISO
  readonly zonaHoraria?: string;
  readonly diasPermitidos?: readonly number[]; // 0=dom … 6=sáb
  /** Canales cuyo contenido aún no fue producido → actividades bloqueadas por falta de datos. */
  readonly canalesSinContenido?: readonly string[];
  /** Plantilla de contenido por canal (para forzar/variar contenido en la instancia). */
  readonly contenidoPorCanal?: Readonly<Record<string, string>>;
}

function esPagado(canal: string): boolean {
  return CANALES_PAGADOS.includes(canal);
}

function siguienteDiaPermitido(baseMs: number, diasPermitidos: readonly number[]): number {
  let ms = baseMs;
  for (let g = 0; g < 7; g += 1) {
    const dow = new Date(ms).getUTCDay();
    if (diasPermitidos.includes(dow)) return ms;
    ms += 86_400_000;
  }
  return baseMs;
}

/** Genera una versión de plan de forma determinística (mismas entradas → mismo plan). */
export function planificar(
  objetivo: ContenidoObjetivo,
  policy: VersionPolitica,
  opts: PlanificarOpts,
  planVersion: number,
  motivo: string,
): PlanVersionContenido {
  const dias = opts.diasPermitidos ?? [1, 2, 3, 4, 5];
  const canalesPagados = objetivo.canales.filter(esPagado);
  const presupuestoPorPagado = canalesPagados.length > 0 ? objetivo.presupuestoTotal / canalesPagados.length : 0;

  const iniciativas: Iniciativa[] = [
    { id: 'ini-organico', nombre: 'Presencia orgánica', porque: `sostener alcance para: ${objetivo.objetivoMarketing}`, objetivoAtendido: objetivo.objetivoMarketing },
  ];
  if (canalesPagados.length > 0) {
    iniciativas.push({ id: 'ini-captacion', nombre: 'Captación pagada', porque: `acelerar ${objetivo.indicador} con inversión`, objetivoAtendido: objetivo.objetivoMarketing });
  }

  const campanias: Campania[] = objetivo.canales.map((canal) => ({
    id: `cmp-${canal}`,
    iniciativaId: esPagado(canal) ? 'ini-captacion' : 'ini-organico',
    nombre: `${esPagado(canal) ? 'Anuncios' : 'Contenido'} en ${canal}`,
    canal,
    presupuesto: esPagado(canal) ? presupuestoPorPagado : 0,
    porque: `${objetivo.audiencia} es alcanzable por ${canal}`,
  }));

  const nActividades = Math.max(1, Math.floor(objetivo.horizonteDias / objetivo.frecuenciaDias));
  const inicioMs = new Date(opts.fechaInicio).getTime();
  const actividades: Actividad[] = [];

  for (const campania of campanias) {
    const pagado = esPagado(campania.canal);
    const sinContenido = (opts.canalesSinContenido ?? []).includes(campania.canal);
    for (let i = 0; i < nActividades; i += 1) {
      const fechaMs = siguienteDiaPermitido(inicioMs + i * objetivo.frecuenciaDias * 86_400_000, dias);
      const plantilla = opts.contenidoPorCanal?.[campania.canal];
      const contenido = sinContenido ? '' : plantilla ?? `${campania.nombre} — publicación ${i + 1} para ${objetivo.audiencia}`;
      const tipo = pagado ? 'anuncio' : 'publicar_organico';
      const costo = pagado ? Math.round((campania.presupuesto / nActividades) * 100) / 100 : 0;

      let estado: Actividad['estado'] = 'autorizable';
      let motivoBloqueo: string | null = null;
      const faltantes: string[] = [];
      if (!policy.canalesAutorizados.includes(campania.canal)) {
        estado = 'bloqueada';
        motivoBloqueo = 'canal_no_autorizado';
      } else if (!contenido) {
        estado = 'bloqueada';
        motivoBloqueo = 'contenido_faltante';
        faltantes.push('contenido');
      } else if (policy.accionesProhibidas.includes(tipo)) {
        estado = 'bloqueada';
        motivoBloqueo = 'accion_prohibida';
      }

      actividades.push({
        id: `act-${campania.canal}-${i}`,
        campaniaId: campania.id,
        tipo,
        canal: campania.canal,
        contenido,
        costo,
        fechaProgramada: new Date(fechaMs).toISOString(),
        estado,
        motivoBloqueo,
        explicacion:
          estado === 'autorizable'
            ? `atiende "${objetivo.objetivoMarketing}" vía ${campania.canal}; permitido por la política v${policy.version}`
            : `bloqueada: ${motivoBloqueo}`,
        supuestos: [`audiencia: ${objetivo.audiencia}`, `frecuencia: cada ${objetivo.frecuenciaDias} días`],
        faltantes,
        accionExecutionId: null,
        resultado: null,
        paqueteContenidoRef: null,
      });
    }
  }

  const hayBloqueada = actividades.some((a) => a.estado === 'bloqueada');
  const hayEjecutable = actividades.some((a) => a.estado === 'autorizable');

  return {
    planVersion,
    objetivoRef: '',
    policyId: '',
    iniciativas,
    campanias,
    actividades,
    calendario: {
      zonaHoraria: opts.zonaHoraria ?? 'UTC',
      desde: opts.fechaInicio,
      hasta: new Date(inicioMs + objetivo.horizonteDias * 86_400_000).toISOString(),
      diasPermitidos: dias,
      frecuenciaDias: objetivo.frecuenciaDias,
    },
    presupuesto: {
      total: objetivo.presupuestoTotal,
      moneda: objetivo.moneda,
      porCampania: Object.fromEntries(campanias.map((c) => [c.id, c.presupuesto])),
    },
    estado: hayBloqueada && hayEjecutable ? 'parcialmente_bloqueado' : hayEjecutable ? 'listo' : 'parcialmente_bloqueado',
    motivo,
  };
}
