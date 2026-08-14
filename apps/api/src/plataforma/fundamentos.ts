/**
 * apps/api · PLATAFORMA · FUNDAMENTOS DE UN NEGOCIO — ¿es evaluable todavía?
 *
 * El Director de SOEC no puede recomendar inversión publicitaria sobre un negocio del que no sabe
 * ni cuánto vende, ni cuánto gana, ni si alguien mide algo. Este módulo produce ese juicio de forma
 * DETERMINISTA y EXPLICABLE, derivándolo del estado real de las fuentes y del perfil.
 *
 * `FOUNDATION_REQUIRED` no es «malo»: es el estado honesto de un negocio real que todavía no tiene
 * instrumentación. Y NO es lo mismo que el `OBSERVAR` de un negocio que sí mide y cuya evidencia
 * aún es insuficiente: ahí hay datos y aquí no hay de dónde sacarlos. Semánticas distintas,
 * estados distintos.
 */
import type { LineaBaseDeVentas } from '@soec/comercio';
import {
  ESTADOS_CON_LECTURA,
  type FuenteRegistrada,
  type NegocioRegistrado,
  type PerfilComercial,
} from './tipos';

export type VeredictoFundamentos =
  /** Faltan cimientos: no hay con qué medir ni con qué decidir inversión. */
  | 'FOUNDATION_REQUIRED'
  /** Hay lectura suficiente para observar, pero no política de evaluación. */
  | 'OBSERVABLE_SIN_POLITICA'
  /** Hay política y fuentes: el Director puede razonar con su motor habitual. */
  | 'EVALUABLE';

export type MotivoFundamentos =
  | 'ANALYTICS_NOT_CONFIGURED'
  | 'SALES_NOT_CONNECTED'
  | 'ECONOMICS_UNKNOWN'
  | 'NATIONWIDE_SHIPPING_NOT_READY'
  | 'ADS_NOT_CONFIGURED'
  | 'CATALOG_NOT_OBSERVED'
  | 'BUSINESS_PROFILE_NOT_CONFIGURED'
  // SaaS / captación de clientes
  | 'ACQUISITION_NOT_CONNECTED'
  | 'CONVERSION_SIGNAL_NOT_CONNECTED'
  // Fail-closed
  | 'UNKNOWN_BUSINESS_MODEL';

export interface MotivoExplicado {
  readonly codigo: MotivoFundamentos;
  readonly explicacion: string;
  /** Qué acto humano lo resolvería. SOEC no puede hacerlo por su cuenta. */
  readonly resuelveCon: string;
}

export interface EstadoFundamentos {
  readonly organizationId: string;
  readonly veredicto: VeredictoFundamentos;
  readonly motivos: readonly MotivoExplicado[];
  /** Lo que SÍ está demostrado hoy. Evita que el informe parezca sólo una lista de carencias. */
  readonly cimientosPresentes: readonly string[];
  readonly puedeRecomendarInversionPublicitaria: false;
}

const conLectura = (f: FuenteRegistrada | undefined): boolean =>
  f !== undefined && ESTADOS_CON_LECTURA.includes(f.estado);

/**
 * Deriva el estado de fundamentos. PURO y determinista: mismas fuentes, mismo veredicto.
 *
 * `puedeRecomendarInversionPublicitaria` es del tipo literal `false`: mientras exista este módulo,
 * ninguna composición puede usarlo para justificar gasto. Habilitar inversión exigirá un cambio
 * deliberado de contrato, no un cambio de datos.
 */
export function evaluarFundamentos(
  negocio: NegocioRegistrado,
  fuentes: readonly FuenteRegistrada[],
  perfilComercial: PerfilComercial | null,
  tienePoliticaDeEvaluacion: boolean,
  /** Línea base de ventas OBSERVADA, si ya existe. Lo medido pesa más que lo declarado. */
  ventas?: LineaBaseDeVentas | null,
): EstadoFundamentos {
  // Los fundamentos REQUERIDOS dependen del MODELO de negocio y sus capacidades, no de la
  // organización. Un SaaS no necesita catálogo ni ventas WooCommerce; un e-commerce sí.
  const modelo = negocio.modeloDeNegocio;
  if (modelo !== 'ECOMMERCE_DISTRIBUCION' && modelo !== 'SAAS_FUNNEL' && modelo !== 'SERVICIOS') {
    // Modelo desconocido ⇒ fail-closed: SOEC no sabe qué exigir, así que exige todo.
    return {
      organizationId: negocio.organizationId,
      veredicto: 'FOUNDATION_REQUIRED',
      motivos: [
        {
          codigo: 'UNKNOWN_BUSINESS_MODEL',
          explicacion: 'el modelo de negocio no es reconocido: SOEC no sabe qué fundamentos exigir',
          resuelveCon: 'declarar un modelo de negocio con su política de fundamentos',
        },
      ],
      cimientosPresentes: [],
      puedeRecomendarInversionPublicitaria: false,
    };
  }
  if (modelo === 'SAAS_FUNNEL' || modelo === 'SERVICIOS') {
    return evaluarFundamentosCaptacion(negocio, fuentes, perfilComercial, tienePoliticaDeEvaluacion);
  }

  // ── ECOMMERCE_DISTRIBUCION (política de e-commerce, sin cambios) ─────────────
  const porTipo = (t: FuenteRegistrada['tipo']): FuenteRegistrada | undefined =>
    fuentes.find((f) => f.tipo === t);

  const motivos: MotivoExplicado[] = [];
  const presentes: string[] = [];

  const catalogo = porTipo('CATALOG');
  const ecommerce = porTipo('ECOMMERCE');
  if (conLectura(catalogo) || conLectura(ecommerce)) {
    presentes.push('catálogo observable desde la tienda pública');
  } else {
    motivos.push({
      codigo: 'CATALOG_NOT_OBSERVED',
      explicacion: 'no hay catálogo observable: SOEC no sabe qué vende este negocio',
      resuelveCon: 'confirmar el dominio de la tienda y su plataforma',
    });
  }

  const analytics = porTipo('ANALYTICS');
  if (conLectura(analytics)) {
    presentes.push('analítica conectada');
  } else {
    motivos.push({
      codigo: 'ANALYTICS_NOT_CONFIGURED',
      explicacion:
        'no hay analítica instalada: no existe embudo, ni conversiones, ni sesiones. Cero eventos OBSERVADOS no es cero eventos OCURRIDOS',
      resuelveCon: 'instalar y verificar medición de comercio electrónico (acto del propietario)',
    });
  }

  const fuenteVentas = porTipo('SALES');
  if (conLectura(fuenteVentas)) {
    presentes.push(
      ventas
        ? `ventas legibles: ${ventas.pedidos} pedidos observados en la fuente`
        : 'ventas legibles',
    );
  } else {
    motivos.push({
      codigo: 'SALES_NOT_CONNECTED',
      explicacion:
        'la fuente de ventas no es legible: SOEC no puede afirmar cuánto vende el negocio, ni que no vende',
      resuelveCon: 'credenciales de lectura de pedidos',
    });
  }

  // La economía se conoce cuando se puede decidir INVERSIÓN, y para eso el ticket no basta: hace
  // falta el margen. Un ticket observado con margen desconocido sigue siendo insuficiente.
  const ticketObservado = ventas?.ticketPromedio.conocido === true;
  const margenConocido =
    perfilComercial?.economia.margenBruto.conocido === true ||
    ventas?.margenBruto.conocido === true;

  if (ticketObservado) {
    presentes.push('ticket promedio observado desde ventas reales');
  }
  if (margenConocido) {
    presentes.push('margen conocido');
  } else {
    motivos.push({
      codigo: 'ECONOMICS_UNKNOWN',
      explicacion: ticketObservado
        ? 'el ticket ya es observable, pero el COSTO y el MARGEN siguen desconocidos (no cero): sin margen no se puede decidir cuánto vale captar un pedido'
        : 'ticket, margen y costos son desconocidos (no cero): sin ellos ninguna inversión publicitaria es evaluable',
      resuelveCon: 'costos por producto desde una fuente autorizada',
    });
  }

  const envio = porTipo('SHIPPING');
  if (envio && envio.estado === 'PARTIAL_CONFIGURATION') {
    motivos.push({
      codigo: 'NATIONWIDE_SHIPPING_NOT_READY',
      explicacion:
        'la cobertura nacional está declarada pero no configurada operativamente en el checkout',
      resuelveCon: 'estructurar tarifas y cobertura de despacho en la tienda',
    });
  } else if (conLectura(envio)) {
    presentes.push('despacho estructurado');
  }

  const ads = porTipo('ADS');
  if (!conLectura(ads)) {
    motivos.push({
      codigo: 'ADS_NOT_CONFIGURED',
      explicacion: 'no hay cuenta de publicidad conectada en solo lectura',
      resuelveCon: 'customer_id y credencial propia de la organización',
    });
  }

  if (!tienePoliticaDeEvaluacion) {
    motivos.push({
      codigo: 'BUSINESS_PROFILE_NOT_CONFIGURED',
      explicacion:
        'no hay objetivo ni criterio de evaluación: fijarlos sin datos sería inventarlos',
      resuelveCon: 'primero medir; la política se deriva de la evidencia, no al revés',
    });
  }

  if (perfilComercial) presentes.push('modelo de negocio y canales identificados');
  if (negocio.estado === 'SOURCES_PARTIAL') presentes.push('parte de las fuentes ya es observable');

  // Un solo motivo estructural basta para que no haya cimientos.
  const bloqueantes: readonly MotivoFundamentos[] = [
    'ANALYTICS_NOT_CONFIGURED',
    'SALES_NOT_CONNECTED',
    'ECONOMICS_UNKNOWN',
    'CATALOG_NOT_OBSERVED',
  ];
  const veredicto: VeredictoFundamentos = motivos.some((m) => bloqueantes.includes(m.codigo))
    ? 'FOUNDATION_REQUIRED'
    : tienePoliticaDeEvaluacion
      ? 'EVALUABLE'
      : 'OBSERVABLE_SIN_POLITICA';

  return {
    organizationId: negocio.organizationId,
    veredicto,
    motivos,
    cimientosPresentes: presentes,
    puedeRecomendarInversionPublicitaria: false,
  };
}

/**
 * Fundamentos para negocios de CAPTACIÓN (SaaS / servicios). NO exige catálogo ni ventas de tienda:
 * exige una fuente de ADQUISICIÓN (anuncios o sitio) y una SEÑAL DE CONVERSIÓN (leads/eventos). La
 * atribución y la economía se informan, pero no bloquean el fundamento —sí gatean la inversión, que
 * permanece `false` por contrato. PURA y determinista.
 */
function evaluarFundamentosCaptacion(
  negocio: NegocioRegistrado,
  fuentes: readonly FuenteRegistrada[],
  perfilComercial: PerfilComercial | null,
  tienePoliticaDeEvaluacion: boolean,
): EstadoFundamentos {
  const porTipo = (t: FuenteRegistrada['tipo']): FuenteRegistrada | undefined => fuentes.find((f) => f.tipo === t);
  const motivos: MotivoExplicado[] = [];
  const presentes: string[] = [];

  // Adquisición: anuncios o sitio observable.
  if (conLectura(porTipo('ADS')) || conLectura(porTipo('WEBSITE'))) {
    presentes.push('fuente de adquisición conectada (anuncios o sitio)');
  } else {
    motivos.push({
      codigo: 'ACQUISITION_NOT_CONNECTED',
      explicacion: 'no hay una fuente de adquisición legible: SOEC no ve de dónde llegarían los clientes',
      resuelveCon: 'conectar Google Ads y/o la analítica del sitio en solo lectura',
    });
  }

  // Señal de conversión: eventos de producto (growth) o analítica.
  if (conLectura(porTipo('GROWTH')) || conLectura(porTipo('ANALYTICS'))) {
    presentes.push('señal de conversiones/leads conectada');
  } else {
    motivos.push({
      codigo: 'CONVERSION_SIGNAL_NOT_CONNECTED',
      explicacion: 'no hay señal de conversiones: SOEC no puede saber si el tráfico se convierte en clientes',
      resuelveCon: 'conectar los eventos del sitio (formularios/leads) o medición de conversiones',
    });
  }

  // Atribución (informativa): mejora la confianza, no bloquea el fundamento.
  if (conLectura(porTipo('ANALYTICS'))) presentes.push('analítica conectada');
  else
    motivos.push({
      codigo: 'ANALYTICS_NOT_CONFIGURED',
      explicacion: 'sin analítica del sitio la atribución es limitada: mejora la confianza, no impide observar',
      resuelveCon: 'instalar medición web (GA4) cuando sea posible',
    });

  // Economía (informativa para el fundamento; gatea la inversión, que sigue en `false`).
  const margenConocido = perfilComercial?.economia.margenBruto.conocido === true;
  if (margenConocido) presentes.push('economía del cliente conocida');
  else
    motivos.push({
      codigo: 'ECONOMICS_UNKNOWN',
      explicacion: 'todavía no se conoce cuánto vale un cliente/lead: se necesita para decidir cuánto invertir',
      resuelveCon: 'cargar el valor del lead/cliente o el margen desde una fuente autorizada',
    });

  if (perfilComercial) presentes.push('modelo de negocio y canales identificados');
  if (!tienePoliticaDeEvaluacion) {
    motivos.push({
      codigo: 'BUSINESS_PROFILE_NOT_CONFIGURED',
      explicacion: 'no hay objetivo ni criterio de evaluación configurado',
      resuelveCon: 'fijar el objetivo de captación (p. ej. leads calificados) y su criterio',
    });
  }

  // Sólo la adquisición y la señal de conversión bloquean el FUNDAMENTO de un negocio de captación.
  const bloqueantes: readonly MotivoFundamentos[] = ['ACQUISITION_NOT_CONNECTED', 'CONVERSION_SIGNAL_NOT_CONNECTED'];
  const veredicto: VeredictoFundamentos = motivos.some((m) => bloqueantes.includes(m.codigo))
    ? 'FOUNDATION_REQUIRED'
    : tienePoliticaDeEvaluacion
      ? 'EVALUABLE'
      : 'OBSERVABLE_SIN_POLITICA';

  return {
    organizationId: negocio.organizationId,
    veredicto,
    motivos,
    cimientosPresentes: presentes,
    puedeRecomendarInversionPublicitaria: false,
  };
}
