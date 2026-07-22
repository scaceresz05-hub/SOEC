/**
 * Motor de readiness (F2-PILOT-01 §12–§14). DETERMINISTA: evalúa la preparación de una
 * organización POR ENTORNO y produce chequeos estructurados. La ausencia de datos no es
 * fracaso: distingue pendiente de bloqueado. Una credencial fixture basta para sandbox
 * pero no para producción; una especificación visual basta para un ensayo emulado pero
 * no para publicar en un canal visual real. La activación REAL nunca se aprueba aquí.
 */
import { type Entorno, capacidadesEntorno } from './entorno';
import type { OrgState } from './organizacion';

export type EstadoChequeo = 'aprobado' | 'aprobado_con_advertencia' | 'pendiente' | 'bloqueado' | 'no_aplicable';

export interface ChequeoReadiness {
  readonly codigo: string;
  readonly categoria: string;
  readonly estado: EstadoChequeo;
  readonly severidad: 'info' | 'menor' | 'mayor' | 'critico';
  readonly requisito: string;
  readonly evidencia: string;
  readonly faltante: string;
  readonly resolucion: string;
  readonly bloqueo: boolean;
  readonly entorno: Entorno;
}

export type ResultadoReadiness =
  | 'no_evaluado'
  | 'incompleto'
  | 'bloqueado'
  | 'apto_para_ensayo'
  | 'ensayo_aprobado'
  | 'apto_para_activacion'
  | 'activacion_prohibida';

export interface EvaluacionReadiness {
  readonly entorno: Entorno;
  readonly chequeos: readonly ChequeoReadiness[];
  readonly resultado: ResultadoReadiness;
  /** Guardarraíl: la activación REAL nunca se habilita en F2-PILOT-01. */
  readonly activacionRealPermitida: false;
  readonly nota: string;
}

const CATEGORIAS: { categoria: string; etapa: keyof OrgState['etapas'] | null; codigo: string; requisito: string }[] = [
  { categoria: 'organizacion', etapa: 'identidad', codigo: 'org.identidad', requisito: 'identidad de organización completa' },
  { categoria: 'organizacion', etapa: 'responsables', codigo: 'org.responsables', requisito: 'responsables declarados' },
  { categoria: 'estrategia', etapa: 'objetivos', codigo: 'estrategia.objetivo', requisito: 'objetivo, audiencia e indicadores' },
  { categoria: 'estrategia', etapa: 'audiencia', codigo: 'estrategia.audiencia', requisito: 'audiencia definida' },
  { categoria: 'marca', etapa: 'marca', codigo: 'marca.identidad', requisito: 'identidad de marca, tono y prohibiciones' },
  { categoria: 'operacion', etapa: 'horarios', codigo: 'operacion.calendario', requisito: 'calendario, horarios y volumen' },
  { categoria: 'politicas', etapa: 'politicas', codigo: 'politicas.base', requisito: 'políticas, autonomía y aprobaciones' },
  { categoria: 'seguridad', etapa: 'pausa', codigo: 'seguridad.pausa', requisito: 'mecanismo de pausa' },
  { categoria: 'seguridad', etapa: 'suspension', codigo: 'seguridad.suspension', requisito: 'criterios de suspensión' },
  { categoria: 'medicion', etapa: 'medicion', codigo: 'medicion.fuente', requisito: 'métricas, línea base y meta' },
  { categoria: 'seguridad', etapa: 'exito', codigo: 'seguridad.exito', requisito: 'criterios de éxito' },
];

export function evaluarReadiness(org: OrgState, entorno: Entorno, ensayoAprobado: boolean): EvaluacionReadiness {
  if (!org.existe) return { entorno, chequeos: [], resultado: 'no_evaluado', activacionRealPermitida: false, nota: 'organización no registrada' };
  const cap = capacidadesEntorno(entorno);
  const chequeos: ChequeoReadiness[] = [];

  for (const c of CATEGORIAS) {
    const et = c.etapa ? org.etapas[c.etapa] : undefined;
    const completa = et?.estado === 'completa';
    const noAplica = et?.estado === 'no_aplicable';
    const estado: EstadoChequeo = noAplica ? 'no_aplicable' : completa ? 'aprobado' : 'pendiente';
    chequeos.push({ codigo: c.codigo, categoria: c.categoria, estado, severidad: completa || noAplica ? 'info' : 'mayor', requisito: c.requisito, evidencia: et ? `etapa '${c.etapa}' en estado ${et.estado}` : 'etapa no iniciada', faltante: completa || noAplica ? '' : (et?.faltantes.join(', ') || `completar la etapa ${c.etapa}`), resolucion: `completar ${c.requisito}`, bloqueo: false, entorno });
  }

  // Perfil y presupuesto.
  chequeos.push({ codigo: 'operacion.perfil', categoria: 'operacion', estado: org.perfil ? 'aprobado' : 'pendiente', severidad: 'mayor', requisito: 'perfil operacional definido', evidencia: org.perfil ? `departamento ${org.perfil.departamentoPiloto}, modo ${org.perfil.modo}` : 'sin perfil', faltante: org.perfil ? '' : 'definir el perfil operacional', resolucion: 'definir el perfil', bloqueo: false, entorno });
  const presOk = !!org.presupuesto && org.presupuesto.limiteTotal > 0 && org.presupuesto.limiteDiario > 0 && org.presupuesto.limiteDiario <= org.presupuesto.limiteTotal;
  chequeos.push({ codigo: 'presupuesto.consistente', categoria: 'politicas', estado: presOk ? 'aprobado' : org.presupuesto ? 'bloqueado' : 'pendiente', severidad: 'mayor', requisito: 'presupuesto con límites consistentes', evidencia: org.presupuesto ? `total ${org.presupuesto.limiteTotal}, diario ${org.presupuesto.limiteDiario}` : 'sin presupuesto', faltante: presOk ? '' : 'corregir los límites de presupuesto', resolucion: 'límite diario ≤ total y > 0', bloqueo: !!org.presupuesto && !presOk, entorno });

  // Conexión POR ENTORNO: fixture sirve para sandbox/emulado, no para real.
  const conexiones = Object.values(org.conexiones);
  if (conexiones.length === 0) {
    chequeos.push({ codigo: 'canal.conexion', categoria: 'canal', estado: 'pendiente', severidad: 'mayor', requisito: 'conexión de canal declarada', evidencia: 'sin conexiones', faltante: 'declarar una conexión de canal', resolucion: 'declarar la conexión', bloqueo: false, entorno });
  } else {
    for (const cx of conexiones) {
      // Para un entorno real, una credencial verificada solo en sandbox (o ausente) NO basta.
      const requiereRealSinCred = cap.exigeCredencialReal && cx.estado !== 'preparada_para_real';
      chequeos.push({ codigo: `canal.credencial:${cx.canal}`, categoria: 'canal', estado: requiereRealSinCred ? 'bloqueado' : cx.estado === 'verificada_sandbox' || cx.estado === 'lista_para_verificar' || cx.estado === 'declarada' ? 'aprobado_con_advertencia' : 'pendiente', severidad: requiereRealSinCred ? 'critico' : 'menor', requisito: `credencial válida para ${entorno}`, evidencia: `canal ${cx.canal}, estado ${cx.estado}, credencialRef ${cx.credencialRef ?? 'ausente'}`, faltante: requiereRealSinCred ? 'credencial real verificada (no fixture)' : '', resolucion: requiereRealSinCred ? 'proveer y verificar una credencial real; el modo real permanece bloqueado' : 'verificar en sandbox', bloqueo: requiereRealSinCred, entorno });
    }
  }

  const hayBloqueo = chequeos.some((c) => c.bloqueo || c.estado === 'bloqueado');
  const hayPendiente = chequeos.some((c) => c.estado === 'pendiente');
  let resultado: ResultadoReadiness;
  if (hayBloqueo) resultado = 'bloqueado';
  else if (hayPendiente) resultado = 'incompleto';
  else if (!ensayoAprobado) resultado = 'apto_para_ensayo';
  else resultado = entornoRealPreparado(entorno) ? 'apto_para_activacion' : 'ensayo_aprobado';

  const nota =
    resultado === 'apto_para_activacion'
      ? 'apto para activación, pero la ACTIVACIÓN REAL permanece pendiente de decisión estratégica (bloqueada en F2-PILOT-01)'
      : resultado === 'ensayo_aprobado'
        ? 'ensayo aprobado en entorno no productivo; para activación real se requiere entorno real_preparado + credenciales reales + autorización'
        : 'preparación en curso';
  return { entorno, chequeos, resultado, activacionRealPermitida: false, nota };
}

function entornoRealPreparado(e: Entorno): boolean {
  return e === 'real_preparado' || e === 'real_desactivado';
}
