/**
 * @soec/estrategia · app · Motor de Estrategia (función pura, determinista).
 *
 * proponerEstrategia(comprensión, rubro, política) → PROPUESTA | ABSTENCION.
 *
 * Derivación CAUSAL: una señal se activa por el VALOR de una pregunta cerrada
 * (condición de activación), nunca por coincidencia libre de texto. Solo señales
 * ACTIVAS habilitan sus mapeos versionados (señal→objetivo→estrategia). Un objetivo
 * sin mapeo aplicable no aparece aunque esté RATIFIED. Produce candidatos, no
 * decisiones; no accede a MED/MDM/ECE ni a internals del Diagnóstico; sin efectos.
 */
import type {
  ActivadorRegulatorio,
  Confianza,
  Mapeo,
  Objetivo,
  RubroKnowledgePort,
  Senal,
} from '@soec/rubros';
import type { ComprensionEvaluable } from '@soec/diagnostico';
import type {
  AdvertenciaRegulatoria,
  CandidatoEstrategia,
  EstrategiaSugerida,
  FactoresConfianza,
  PoliticaEstrategia,
  ResultadoEstrategia,
} from '../domain/tipos';

export const POLITICA_ESTRATEGIA_CONSERVADORA: PoliticaEstrategia = {
  minConfianza: 'MEDIUM',
  maxCandidatos: 3,
  candidatosEsperados: 2,
  degradarPorContradiccion: true,
};

const ORDEN: readonly Confianza[] = ['LOW', 'MEDIUM', 'HIGH'];
const rango = (c: Confianza): number => ORDEN.indexOf(c);
const degradar = (c: Confianza, n: number): Confianza => ORDEN[Math.max(0, rango(c) - n)]!;

type EstadoSenal = 'ACTIVA' | 'INACTIVA' | 'INDETERMINADA' | 'CONTRADICTORIA';

function estadoDeSenal(s: Senal, comp: ComprensionEvaluable): EstadoSenal {
  const hecho = comp.hechos.find((h) => h.preguntaId === s.preguntaId);
  if (hecho) return hecho.valor === s.condicionActivacion.valor ? 'ACTIVA' : 'INACTIVA';
  if (comp.contradicciones.some((c) => c.preguntaId === s.preguntaId)) return 'CONTRADICTORIA';
  return 'INDETERMINADA';
}

function abstener(razon: string, comp: ComprensionEvaluable): ResultadoEstrategia {
  return {
    tipo: 'ABSTENCION',
    abstencion: { razon, faltantesRelevantes: comp.faltantes.map((f) => f.preguntaId) },
  };
}

export function proponerEstrategia(
  comprension: ComprensionEvaluable,
  rubro: RubroKnowledgePort,
  politica: PoliticaEstrategia = POLITICA_ESTRATEGIA_CONSERVADORA,
): ResultadoEstrategia {
  const senales = rubro.senales();
  const senalPorId = new Map(senales.map((s) => [s.id, s]));
  const activas = new Set(
    senales.filter((s) => estadoDeSenal(s, comprension) === 'ACTIVA').map((s) => s.id),
  );

  const objetivosRat = new Map(rubro.objetivosElegibles().map((o) => [o.id, o]));

  // Agrupa por objetivo los mapeos cuya señal está ACTIVA y cuyo objetivo es RATIFIED.
  const grupos = new Map<string, { objetivo: Objetivo; mapeos: Mapeo[]; senalIds: string[] }>();
  for (const m of rubro.mapeos()) {
    if (!activas.has(m.senalId)) continue;
    const objetivo = objetivosRat.get(m.objetivoId);
    if (!objetivo) continue; // objetivo sin participación válida (no RATIFIED) → no aparece
    const g = grupos.get(m.objetivoId) ?? { objetivo, mapeos: [], senalIds: [] };
    g.mapeos.push(m);
    if (!g.senalIds.includes(m.senalId)) g.senalIds.push(m.senalId);
    grupos.set(m.objetivoId, g);
  }

  if (grupos.size === 0) {
    return abstener('ninguna señal diagnóstica activa habilita un objetivo candidato', comprension);
  }

  const hayContradiccion = comprension.contradicciones.length > 0;
  const faltanDominan = comprension.faltantes.length > comprension.hechos.length;
  const supuesto = rubro.supuestos()[0];
  const faltantesIds = comprension.faltantes.map((f) => f.preguntaId);
  const contradIds = comprension.contradicciones.map((c) => c.preguntaId);

  const candidatos: CandidatoEstrategia[] = [...grupos.values()].map((g): CandidatoEstrategia => {
    const o = g.objetivo;
    const hechosRespaldatorios = g.senalIds.map((id) => senalPorId.get(id)!.preguntaId);

    const k =
      (politica.degradarPorContradiccion && hayContradiccion ? 1 : 0) + (faltanDominan ? 1 : 0);
    const confianza = degradar(o.confianza, k);
    const factoresConfianza: FactoresConfianza = {
      hechosRespaldatorios,
      faltantesQueReducen: faltanDominan ? faltantesIds : [],
      contradiccionesQueReducen:
        politica.degradarPorContradiccion && hayContradiccion ? contradIds : [],
      supuestosUtilizados: supuesto ? [supuesto.id] : [],
      resultado: confianza,
    };

    // Estrategias del mapeo + regulatorio específico por estrategia.
    const estrsObjetivo = rubro.estrategiasDe(o.id);
    const idsEstrategia = [...new Set(g.mapeos.map((m) => m.estrategiaId))];
    const advertencias: AdvertenciaRegulatoria[] = [];
    const estrategiasSugeridas: EstrategiaSugerida[] = idsEstrategia.map((eid) => {
      const est = estrsObjetivo.find((e) => e.id === eid);
      const activadores: readonly ActivadorRegulatorio[] = est?.activadores ?? [];
      let bloqueada = false;
      for (const regla of rubro.restriccionesRegulatorias()) {
        for (const act of regla.observa) {
          if (activadores.includes(act)) {
            advertencias.push({
              reglaId: regla.id,
              estrategiaId: eid,
              activadaPor: act,
              efecto: regla.efecto,
              estado: 'PRELIMINARY',
              certificaCumplimiento: false,
              nota: 'no certifica cumplimiento; fundamento regulatorio pendiente de validación jurídica',
            });
            if (regla.efecto === 'BLOQUEA') bloqueada = true;
          }
        }
      }
      return { id: eid, estrategia: est?.estrategia ?? eid, bloqueada };
    });

    return {
      objetivoId: o.id,
      objetivo: o.objetivo,
      metrica: o.metrica,
      costoMedicion: o.costoMedicion ?? null,
      estrategiasSugeridas,
      confianza,
      factoresConfianza,
      explicacion: {
        detecte: `detecté la(s) señal(es) activa(s): ${g.senalIds.map((id) => senalPorId.get(id)!.nombre).join(', ')}`,
        observe: supuesto
          ? `observé (patrón del rubro): ${supuesto.supuesto}`
          : 'observé el objetivo típico del rubro',
        necesito: `para medirlo necesito: ${o.metrica}${o.costoMedicion ? ` (${o.costoMedicion})` : ''}`,
        meFalta: comprension.faltantes.length
          ? `todavía me falta: ${faltantesIds[0]}`
          : 'no registré faltantes relevantes',
      },
      procedencia: {
        senalesActivas: g.senalIds,
        hechosUtilizados: hechosRespaldatorios,
        faltantesRelevantes: faltantesIds,
        contradiccionesQueReducenConfianza: hayContradiccion ? contradIds : [],
        entradasRubro: [
          ...new Set([
            ...g.mapeos.map((m) => m.id),
            ...g.senalIds,
            o.id,
            ...idsEstrategia,
            ...(supuesto ? [supuesto.id] : []),
          ]),
        ],
      },
      advertenciasRegulatorias: advertencias,
    };
  });

  const seleccionados = candidatos
    .filter((c) => rango(c.confianza) >= rango(politica.minConfianza))
    .sort(
      (a, b) => rango(b.confianza) - rango(a.confianza) || (a.objetivoId < b.objetivoId ? -1 : 1),
    )
    .slice(0, politica.maxCandidatos);

  if (seleccionados.length === 0) {
    return abstener(
      `ningún candidato fundado alcanza la confianza mínima (${politica.minConfianza})`,
      comprension,
    );
  }

  const cobertura = {
    candidatosEsperados: politica.candidatosEsperados,
    candidatosFundados: seleccionados.length,
    ...(seleccionados.length < politica.candidatosEsperados
      ? {
          motivoDeCoberturaParcial:
            'solo hay fundamento (señales activas + mapeos + confianza suficiente) para menos candidatos que los esperados',
        }
      : {}),
  };

  return { tipo: 'PROPUESTA', candidatos: seleccionados, cobertura };
}
