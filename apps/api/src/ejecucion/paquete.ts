/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · PAQUETE DE EJECUCIÓN (función pura).
 *
 * El paquete es la FOTOGRAFÍA CONGELADA de lo que se va a crear. Se calcula una vez, se guarda entera con la
 * petición y no vuelve a mirarse el mundo: si después cambia la oferta, el territorio, el presupuesto, el
 * landing, las palabras, los anuncios o la política, la petición anterior NO muta en silencio — hace falta una
 * versión nueva del plan y una petición nueva. Ésa es la diferencia entre ejecutar lo que una persona aprobó y
 * ejecutar lo que el sistema tenía a mano en ese instante.
 *
 * DINERO: el presupuesto que se materializa es el MENOR entre lo que el plan propone y lo que el mandato
 * humano autoriza. Nunca al revés, nunca por encima del mandato, nunca inventado.
 */
import { createHash } from 'node:crypto';
import type { OfertaNegocio, PerfilNegocio } from '../negocio/negocio-pg';
import type { GeoEjecutable } from '../investigacion/investigacion-pg';
import type { GrupoDelPlan, PlanCampania } from '../investigacion/plan-pg';
import type { Mandato } from '../accion/mandato';
import {
  EjecucionInvalidaError,
  MAX_LARGO_DESCRIPCION,
  MAX_LARGO_HEADLINE,
  MINIMO_DESCRIPCIONES,
  MINIMO_HEADLINES,
  type RolConversion,
} from './ejecucion-tipos';

/** Una palabra del paquete: texto y concordancia, tal como el plan las justificó. */
export interface PalabraPaquete {
  readonly texto: string;
  readonly concordancia: 'EXACT' | 'PHRASE' | 'BROAD';
}

export interface AnuncioPaquete {
  readonly titulares: readonly string[];
  readonly descripciones: readonly string[];
}

export interface GrupoPaquete {
  readonly id: string;
  readonly nombre: string;
  readonly ofertaSlug: string;
  readonly urlFinal: string;
  readonly palabras: readonly PalabraPaquete[];
  readonly anuncios: readonly AnuncioPaquete[];
}

export interface GeoPaquete {
  readonly criterionId: string;
  readonly nombre: string;
  readonly negativo: boolean;
}

export interface ConversionPaquete {
  readonly eventKey: string;
  readonly externalId: string;
  readonly rol: RolConversion;
}

export interface ExtensionesPaquete {
  readonly sitelinks: readonly { readonly texto: string; readonly url: string }[];
  readonly callouts: readonly string[];
}

export interface PaqueteDeEjecucion {
  readonly organizationId: string;
  readonly proveedor: 'GOOGLE_ADS';
  readonly planId: string;
  readonly planVersion: number;
  readonly researchRunId: string;
  readonly cuenta: { readonly customerId: string; readonly loginCustomerId: string };
  readonly campania: {
    readonly nombre: string;
    readonly canal: 'SEARCH';
    readonly moneda: string;
    /** Presupuesto DIARIO en micros. Es el menor entre la propuesta del plan y el mandato humano. */
    readonly presupuestoDiarioMicros: number;
    readonly presupuestoDiarioClp: number;
    readonly puja: { readonly estrategia: string; readonly techoCpcMicros: number | null };
    readonly idiomaConstantId: string;
    readonly geo: readonly GeoPaquete[];
    /** Sólo personas EN el territorio: «o con interés» anunciaría fuera del área autorizada. */
    readonly tipoDePresencia: 'PRESENCE';
  };
  readonly grupos: readonly GrupoPaquete[];
  readonly negativas: readonly (PalabraPaquete & { readonly motivo: string })[];
  readonly extensiones: ExtensionesPaquete;
  readonly conversiones: readonly ConversionPaquete[];
  /** INVARIANTE DE LA FASE: siempre `PAUSED`. No existe otra opción en el tipo. */
  readonly estadoInicial: 'PAUSED';
  readonly mandato: { readonly id: string; readonly autorizadoPor: string; readonly topeMinor: number; readonly moneda: string; readonly hasta: string };
  readonly congeladoEn: string;
  readonly hash: string;
}

/** Material de anuncio ya aprobado por una persona, agrupado por oferta. */
export interface MaterialAprobado {
  readonly ofertaSlug: string;
  readonly titulares: readonly string[];
  readonly descripciones: readonly string[];
  readonly sitelinks: readonly { readonly texto: string; readonly url: string }[];
  readonly callouts: readonly string[];
}

export interface EntradaPaquete {
  readonly organizationId: string;
  readonly perfil: PerfilNegocio;
  readonly oferta: readonly OfertaNegocio[];
  readonly plan: PlanCampania;
  readonly grupos: readonly GrupoDelPlan[];
  readonly geos: readonly GeoEjecutable[];
  readonly cuenta: { readonly customerId: string; readonly loginCustomerId: string };
  readonly mandato: Mandato;
  readonly conversiones: readonly ConversionPaquete[];
  readonly material: readonly MaterialAprobado[];
  readonly ahora: string;
}

const MICROS = 1_000_000;

/** Días (al menos 1) que cubre el mandato: sirve para repartir el tope en un presupuesto diario. */
export function diasDelMandato(m: Mandato): number {
  const ms = Date.parse(m.periodEnd) - Date.parse(m.periodStart);
  return Math.max(1, Math.round(ms / 86_400_000));
}

/**
 * Presupuesto diario que se materializa: el MENOR entre lo que propone el plan y lo que el mandato permite
 * gastar por día. Si el plan no propone nada, manda el mandato; jamás al revés.
 */
export function presupuestoDiarioDe(plan: PlanCampania, mandato: Mandato): { clp: number; micros: number; origen: 'PLAN' | 'MANDATO' } {
  const delMandato = Math.floor(mandato.authorizedBudgetMinor / diasDelMandato(mandato));
  const delPlan = plan.presupuesto.propuestoDiarioClp;
  const elegido = delPlan === null ? delMandato : Math.min(delPlan, delMandato);
  if (elegido <= 0) throw new EjecucionInvalidaError('el presupuesto autorizado no alcanza para un día de campaña');
  return { clp: elegido, micros: elegido * MICROS, origen: delPlan !== null && delPlan <= delMandato ? 'PLAN' : 'MANDATO' };
}

/** Nombre de campaña legible y estable: se puede reconocer en la cuenta del cliente sin abrir SOEC. */
export function nombreDeCampania(perfil: PerfilNegocio, plan: PlanCampania): string {
  return `SOEC · ${perfil.displayName} · búsqueda v${plan.version}`.slice(0, 120);
}

function recortar(textos: readonly string[], max: number): readonly string[] {
  return textos.map((t) => t.trim()).filter((t) => t !== '' && t.length <= max);
}

/**
 * Construye el paquete. Lanza si falta algo estructural: preferimos no construir a construir algo a medias que
 * luego habría que limpiar en la cuenta del cliente.
 */
export function construirPaquete(e: EntradaPaquete): PaqueteDeEjecucion {
  if (e.plan.canal !== 'GOOGLE_SEARCH') throw new EjecucionInvalidaError('esta fase sólo ejecuta campañas de búsqueda de Google');
  const geo = e.geos
    .filter((g) => g.disponible && g.targetId !== null)
    .map((g) => ({ criterionId: String(g.targetId), nombre: g.solicitado, negativo: false }));
  if (geo.length === 0) throw new EjecucionInvalidaError('no hay ningún territorio segmentable confirmado por la plataforma');

  const presupuesto = presupuestoDiarioDe(e.plan, e.mandato);
  const materialPorOferta = new Map(e.material.map((m) => [m.ofertaSlug, m]));

  const grupos: GrupoPaquete[] = [];
  for (const g of e.grupos) {
    const material = materialPorOferta.get(g.ofertaSlug);
    if (material === undefined) continue; // sin anuncios aprobados, el grupo no se materializa
    const titulares = recortar(material.titulares, MAX_LARGO_HEADLINE);
    const descripciones = recortar(material.descripciones, MAX_LARGO_DESCRIPCION);
    if (titulares.length < MINIMO_HEADLINES || descripciones.length < MINIMO_DESCRIPCIONES) continue;
    const urlFinal = g.landing ?? e.oferta.find((o) => o.slug === g.ofertaSlug)?.landingUrl ?? null;
    if (urlFinal === null) continue; // sin página de destino no se crea el grupo
    const palabras = g.palabras.map((p) => ({ texto: p.termino, concordancia: p.concordancia }));
    if (palabras.length === 0) continue;
    grupos.push({
      id: g.id,
      nombre: g.nombre.slice(0, 120),
      ofertaSlug: g.ofertaSlug,
      urlFinal: urlFinal.startsWith('http') ? urlFinal : `${(e.perfil.website ?? '').replace(/\/$/, '')}${urlFinal}`,
      palabras,
      anuncios: [{ titulares, descripciones }],
    });
  }
  if (grupos.length === 0) throw new EjecucionInvalidaError('ningún grupo del plan tiene anuncios aprobados, palabras y página de destino');

  // Las negativas se toman del plan (candidatas ya justificadas), no del catálogo completo de candidatos.
  const vistas = new Set<string>();
  const negativas = e.grupos
    .flatMap((g) => g.negativas)
    .filter((n) => (vistas.has(n.termino) ? false : (vistas.add(n.termino), true)))
    .map((n) => ({ texto: n.termino, concordancia: 'PHRASE' as const, motivo: n.motivo }));

  const extensiones: ExtensionesPaquete = {
    sitelinks: e.material.flatMap((m) => m.sitelinks).slice(0, 8),
    callouts: [...new Set(e.material.flatMap((m) => m.callouts))].slice(0, 10),
  };

  const base = {
    organizationId: e.organizationId,
    proveedor: 'GOOGLE_ADS' as const,
    planId: e.plan.id,
    planVersion: e.plan.version,
    researchRunId: e.plan.researchRunId,
    cuenta: e.cuenta,
    campania: {
      nombre: nombreDeCampania(e.perfil, e.plan),
      canal: 'SEARCH' as const,
      moneda: e.perfil.currency,
      presupuestoDiarioMicros: presupuesto.micros,
      presupuestoDiarioClp: presupuesto.clp,
      puja: {
        estrategia: e.plan.puja.estrategia,
        techoCpcMicros: e.plan.puja.techoCpcClp === null ? null : e.plan.puja.techoCpcClp * MICROS,
      },
      idiomaConstantId: e.perfil.language.startsWith('es') ? '1003' : '1000',
      geo,
      tipoDePresencia: 'PRESENCE' as const,
    },
    grupos,
    negativas,
    extensiones,
    conversiones: e.conversiones,
    estadoInicial: 'PAUSED' as const,
    mandato: {
      id: e.mandato.id,
      autorizadoPor: e.mandato.authorizedBy,
      topeMinor: e.mandato.authorizedBudgetMinor,
      moneda: e.mandato.currency,
      hasta: e.mandato.periodEnd,
    },
    congeladoEn: e.ahora,
  };
  return { ...base, hash: hashDePaquete(base) };
}

/**
 * Hash del paquete SIN la fecha de congelación: dos paquetes materialmente idénticos comparten hash aunque se
 * preparen en momentos distintos. Es lo que permite detectar «esto ya se ejecutó» sin depender del reloj.
 */
export function hashDePaquete(p: Omit<PaqueteDeEjecucion, 'hash' | 'congeladoEn'> & { congeladoEn?: string; hash?: string }): string {
  // Se excluyen la fecha y el propio hash: recalcular el hash de un paquete ya congelado debe devolver el mismo
  // valor, que es como se comprueba que nadie lo manipuló entre la aprobación y la ejecución.
  const { congeladoEn, hash, ...material } = p as Record<string, unknown> & { congeladoEn?: string; hash?: string };
  void congeladoEn; void hash;
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 32);
}

/** Todos los textos que se publicarían: es lo que hay que validar contra lo que el negocio NO puede afirmar. */
export function textosDelPaquete(p: PaqueteDeEjecucion): readonly { readonly donde: string; readonly texto: string }[] {
  const out: { donde: string; texto: string }[] = [];
  for (const g of p.grupos) {
    for (const a of g.anuncios) {
      a.titulares.forEach((t, i) => out.push({ donde: `${g.nombre} · titular ${i + 1}`, texto: t }));
      a.descripciones.forEach((t, i) => out.push({ donde: `${g.nombre} · descripción ${i + 1}`, texto: t }));
    }
  }
  p.extensiones.sitelinks.forEach((s, i) => out.push({ donde: `enlace ${i + 1}`, texto: s.texto }));
  p.extensiones.callouts.forEach((c, i) => out.push({ donde: `destacado ${i + 1}`, texto: c }));
  return out;
}
