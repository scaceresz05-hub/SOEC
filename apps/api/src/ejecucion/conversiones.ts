/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · conversiones y medición.
 *
 * Aquí se separan cuatro cosas que el producto solía tratar como una:
 *
 *   EVENTO INTERNO        lo que el negocio declaró que cuenta como resultado (Fase C: `business_conversion_event`).
 *   ACCIÓN EXTERNA        el objeto que existe en la plataforma y al que la campaña puede optimizar.
 *   MEDICIÓN INSTALADA    el sitio dispara esa acción de verdad.
 *   MEDICIÓN VERIFICADA   alguien comprobó que llegó al menos una.
 *
 * Confundirlas es cómo se acaba con campañas «optimizando a conversiones» que nunca registraron ninguna. Por
 * eso `MEASUREMENT_READY` exige `VERIFIED`, no «existe la acción en Google».
 *
 * IDENTIDAD ESTABLE: (organización + proveedor + evento). Un reintento busca por esa identidad y reutiliza; no
 * existe forma de acabar con «WhatsApp CP 2» y «WhatsApp CP 3».
 */
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import type { MapeoConversion } from './ejecucion-pg';
import type { EstadoMedicion, ProveedorEjecucion, TipoConversionComercial } from './ejecucion-tipos';

/** Traducción del lenguaje del negocio a la configuración técnica. El usuario nunca escribe estos enums. */
export interface ConfiguracionGoogle {
  readonly categoria: string;
  readonly tipo: string;
  readonly conteo: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';
}

export const CONFIGURACION_GOOGLE: Readonly<Record<TipoConversionComercial, ConfiguracionGoogle>> = {
  // Un contacto por formulario: se cuenta UNA vez por clic (dos envíos del mismo visitante no son dos clientes).
  CONTACTO_WEB: { categoria: 'SUBMIT_LEAD_FORM', tipo: 'WEBPAGE', conteo: 'ONE_PER_CLICK' },
  LLAMADA: { categoria: 'PHONE_CALL_LEAD', tipo: 'WEBPAGE', conteo: 'ONE_PER_CLICK' },
  MENSAJERIA: { categoria: 'CONTACT', tipo: 'WEBPAGE', conteo: 'ONE_PER_CLICK' },
  // Una compra: cada una cuenta, porque cada una es ingreso.
  COMPRA: { categoria: 'PURCHASE', tipo: 'WEBPAGE', conteo: 'MANY_PER_CLICK' },
};

/** Cómo se llama la acción en la cuenta del cliente. Estable y reconocible: es la clave de la idempotencia. */
export function nombreExternoDe(nombreNegocio: string, eventKey: string): string {
  return `SOEC · ${nombreNegocio} · ${eventKey}`.slice(0, 100);
}

/** Traduce una acción declarada en el onboarding a su tipo comercial. Sin jerga para el usuario. */
export function tipoComercialDe(eventKey: string): TipoConversionComercial {
  const k = eventKey.toLowerCase();
  if (k.includes('whatsapp') || k.includes('mensaje') || k.includes('chat')) return 'MENSAJERIA';
  if (k.includes('phone') || k.includes('llamad') || k.includes('call')) return 'LLAMADA';
  if (k.includes('compra') || k.includes('purchase') || k.includes('venta') || k.includes('order')) return 'COMPRA';
  return 'CONTACTO_WEB';
}

export interface AccionExternaObservada {
  readonly resourceName: string;
  readonly id: string;
  readonly nombre: string;
  readonly estado: string;
  readonly etiqueta: string | null;
}

/**
 * Busca en la cuenta la acción de conversión por NOMBRE estable. Se consulta la plataforma, no la memoria de
 * SOEC: si alguien la borró allá, aquí no se finge que existe.
 */
export async function buscarAccionDeConversion(
  cliente: Pick<GoogleAdsMutateHttpClient, 'buscar'>,
  customerId: string,
  nombre: string,
): Promise<AccionExternaObservada | null> {
  const seguro = nombre.replace(/'/g, "\\'");
  const filas = await cliente.buscar(
    customerId,
    `select conversion_action.id, conversion_action.name, conversion_action.resource_name, conversion_action.status,
            conversion_action.tag_snippets
     from conversion_action
     where conversion_action.name = '${seguro}' and conversion_action.status != 'REMOVED'
     limit 1`,
  );
  const f = filas[0] as { conversionAction?: Record<string, unknown> } | undefined;
  const ca = f?.conversionAction;
  if (ca === undefined) return null;
  const snippets = (ca.tagSnippets ?? []) as Array<{ eventSnippet?: string }>;
  return {
    resourceName: String(ca.resourceName ?? ''),
    id: String(ca.id ?? ''),
    nombre: String(ca.name ?? ''),
    estado: String(ca.status ?? ''),
    etiqueta: etiquetaDeSnippet(snippets.map((s) => s.eventSnippet ?? '').join('\n')),
  };
}

/** La etiqueta (`send_to: AW-123/AbC-D_efG`) es lo que el sitio necesita; se extrae del snippet, no se inventa. */
export function etiquetaDeSnippet(snippet: string): string | null {
  const m = /AW-\d+\/([\w-]+)/.exec(snippet);
  return m?.[1] ?? null;
}

export interface ResultadoAsegurar {
  readonly mapeo: MapeoConversion;
  readonly creada: boolean;
  readonly providerRequestId: string | null;
}

/**
 * Asegura que exista la acción externa para un evento declarado. Orden deliberado:
 *   1) mapeo persistido con id externo ⇒ se reutiliza sin tocar la plataforma;
 *   2) búsqueda por nombre estable ⇒ si ya existe allá, se adopta (reconciliación);
 *   3) sólo entonces se crea.
 * Nunca hay un cuarto camino: no se crea «por si acaso».
 */
export async function asegurarAccionDeConversion(deps: {
  readonly cliente: Pick<GoogleAdsMutateHttpClient, 'buscar' | 'crearAccionDeConversion'>;
  readonly customerId: string;
  readonly organizationId: string;
  readonly proveedor: ProveedorEjecucion;
  readonly eventKey: string;
  readonly rol: MapeoConversion['rol'];
  readonly nombreNegocio: string;
  readonly moneda: string;
  readonly existente: MapeoConversion | null;
  readonly ahora: string;
}): Promise<ResultadoAsegurar> {
  const tipo = tipoComercialDe(deps.eventKey);
  const nombreExterno = deps.existente?.nombreExterno ?? nombreExternoDe(deps.nombreNegocio, deps.eventKey);
  const base = {
    organizationId: deps.organizationId,
    proveedor: deps.proveedor,
    eventKey: deps.eventKey,
    tipo,
    rol: deps.rol,
    nombreExterno,
    semanticaValor: 'SIN_VALOR' as const,
    valor: null,
    verificacion: deps.existente?.verificacion ?? ('NO_VERIFICADA' as const),
    verificadaEn: deps.existente?.verificadaEn ?? null,
    actualizadoEn: deps.ahora,
  };

  if (deps.existente?.externalId) {
    return { mapeo: { ...base, externalId: deps.existente.externalId, externalLabel: deps.existente.externalLabel, estado: deps.existente.estado }, creada: false, providerRequestId: null };
  }

  const yaEnLaPlataforma = await buscarAccionDeConversion(deps.cliente, deps.customerId, nombreExterno);
  if (yaEnLaPlataforma !== null) {
    return {
      mapeo: { ...base, externalId: yaEnLaPlataforma.id, externalLabel: yaEnLaPlataforma.etiqueta, estado: 'ACTION_CREATED' },
      creada: false,
      providerRequestId: null,
    };
  }

  const cfg = CONFIGURACION_GOOGLE[tipo];
  const creada = await deps.cliente.crearAccionDeConversion(deps.customerId, {
    nombre: nombreExterno,
    categoria: cfg.categoria,
    tipo: cfg.tipo,
    conteo: cfg.conteo,
    valorPorDefecto: null,
    moneda: deps.moneda,
  });
  const id = creada.resourceName.split('/').pop() ?? null;
  return {
    mapeo: { ...base, externalId: id, externalLabel: null, estado: 'ACTION_CREATED' },
    creada: true,
    providerRequestId: creada.requestId,
  };
}

/**
 * Estado de medición resultante de combinar la acción externa con lo que se sabe de la instalación. Es
 * deliberadamente conservador: sin señal de instalación, la respuesta es «falta instalarla», no «lista».
 */
export function estadoDeMedicion(mapeo: MapeoConversion | null, instalacion: EstadoMedicion | null): EstadoMedicion {
  if (mapeo === null || mapeo.externalId === null) return 'ACTION_MISSING';
  if (mapeo.verificacion === 'VERIFICADA') return 'VERIFIED';
  if (instalacion === 'VERIFIED') return 'VERIFIED';
  if (instalacion === 'DEGRADED') return 'DEGRADED';
  if (instalacion === 'TRACKING_INSTALLED') return 'TRACKING_INSTALLED';
  return 'TRACKING_MISSING';
}
