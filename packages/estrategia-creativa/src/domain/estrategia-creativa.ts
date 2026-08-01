/**
 * @soec/estrategia-creativa · dominio · Deriva, de forma DETERMINISTA y EVALUABLE, un BriefComercial
 * y una EstrategiaCreativa (concepto/ángulo/gancho/mensajes/tono) a partir del CONOCIMIENTO COMERCIAL
 * del cerebro comercial (`@soec/crm-comercial`). No inventa: si el conocimiento es insuficiente,
 * ABSTIENE con sus faltantes (Evaluabilidad). Sin proveedores externos (neutral). El artefacto
 * creativo es el paso propio que faltaba entre el conocimiento y las piezas de contenido.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { ConocimientoComercialState, EntidadComercial } from '@soec/crm-comercial';

/** Brief comercial derivado: insumo que el pipeline existente (marketing/contenido) sabe consumir. */
export interface BriefComercial {
  readonly empresa: string;
  readonly propuestaValor: string;
  readonly producto: string;
  readonly problemaCliente: string;
  readonly beneficio: string;
  readonly audiencia: string;
  readonly dolor: string;
  readonly mensajePrincipal: string;
  readonly tono: string;
}

/** Artefacto creativo de primera clase (hoy inexistente): concepto → ángulo → gancho → mensajes. */
export interface EstrategiaCreativa {
  readonly concepto: string;
  readonly angulo: string;
  readonly gancho: string;
  readonly mensajesClave: readonly string[];
  readonly tono: string;
}

/** Salida de la derivación: PROPUESTA (evaluable) o ABSTENCION (ausencia ≠ conclusión). */
export type DerivacionCreativa =
  | { readonly tipo: 'PROPUESTA'; readonly brief: BriefComercial; readonly estrategia: EstrategiaCreativa }
  | { readonly tipo: 'ABSTENCION'; readonly faltantes: readonly string[] };

function campo(ent: EntidadComercial | null | undefined, clave: string): string | null {
  const v = ent?.campos[clave]?.valor;
  return v && v.trim() ? v.trim() : null;
}
function primeraDe(state: ConocimientoComercialState, tipo: EntidadComercial['tipo']): EntidadComercial | null {
  return Object.values(state.entidades).find((e) => e.tipo === tipo) ?? null;
}

/**
 * Deriva brief + estrategia creativa del conocimiento comercial. Requiere, como mínimo evaluable:
 * empresa con propuesta de valor, un producto con problema y beneficio, y un cliente ideal con dolor
 * o motivación. Si algo falta, ABSTIENE declarando exactamente qué falta.
 */
export function derivarCreativa(state: ConocimientoComercialState): DerivacionCreativa {
  const faltantes: string[] = [];
  const empresa = state.empresa;
  const propuestaValor = campo(empresa, 'propuestaValor');
  if (!empresa) faltantes.push('falta el perfil de empresa');
  else if (!propuestaValor) faltantes.push('la empresa no declara propuesta de valor');

  const producto = primeraDe(state, 'PRODUCTO');
  const problema = campo(producto, 'problemaQueResuelve');
  const beneficio = campo(producto, 'beneficios');
  if (!producto) faltantes.push('no hay ningún producto registrado');
  else {
    if (!problema) faltantes.push('el producto no declara el problema que resuelve');
    if (!beneficio) faltantes.push('el producto no declara beneficios');
  }

  const icp = primeraDe(state, 'CLIENTE_IDEAL');
  const dolor = campo(icp, 'dolores') ?? campo(icp, 'motivaciones');
  if (!icp) faltantes.push('no hay ningún cliente ideal (ICP) registrado');
  else if (!dolor) faltantes.push('el cliente ideal no declara dolores ni motivaciones');

  if (faltantes.length > 0) return { tipo: 'ABSTENCION', faltantes };

  const emp = empresa!.nombre;
  const pv = propuestaValor!;
  const prod = producto!.nombre;
  const aud = icp!.nombre;
  const tono = 'cercano y claro';
  const brief: BriefComercial = {
    empresa: emp,
    propuestaValor: pv,
    producto: prod,
    problemaCliente: problema!,
    beneficio: beneficio!,
    audiencia: aud,
    dolor: dolor!,
    mensajePrincipal: `${prod}: ${beneficio!} para ${aud}`,
    tono,
  };
  const estrategia: EstrategiaCreativa = {
    concepto: `${pv} — resolvemos ${problema!}`,
    angulo: `hablar al dolor de ${aud}: ${dolor!}`,
    gancho: `${beneficio!}`,
    mensajesClave: [pv, `${prod} resuelve ${problema!}`, `beneficio: ${beneficio!}`],
    tono,
  };
  return { tipo: 'PROPUESTA', brief, estrategia };
}

// ── Persistencia event-sourced (una estrategia creativa vigente por organización) ────────────────

export interface EstrategiaCreativaState {
  readonly organizacionId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly brief: BriefComercial | null;
  readonly estrategia: EstrategiaCreativa | null;
  readonly derivadaEn: string | null;
}

export const EVENTOS_ESTCREATIVA = { derivada: 'estcreativa.derivada' } as const;

export function estrategiaCreativaStreamId(organizacionId: string): string {
  return `estrategia-creativa:${organizacionId}`;
}

export function estadoInicialEstrategiaCreativa(organizacionId: string): EstrategiaCreativaState {
  return { organizacionId, version: 0, existe: false, brief: null, estrategia: null, derivadaEn: null };
}

export function aplicarEstrategiaCreativa(state: EstrategiaCreativaState, event: RecordedEvent): EstrategiaCreativaState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_ESTCREATIVA.derivada) {
    const p = event.payload as { brief: BriefComercial; estrategia: EstrategiaCreativa };
    return { ...next, existe: true, brief: p.brief, estrategia: p.estrategia, derivadaEn: event.recordedAt };
  }
  return next;
}

export function reconstruirEstrategiaCreativa(organizacionId: string, events: readonly RecordedEvent[]): EstrategiaCreativaState {
  return events.reduce(aplicarEstrategiaCreativa, estadoInicialEstrategiaCreativa(organizacionId));
}
