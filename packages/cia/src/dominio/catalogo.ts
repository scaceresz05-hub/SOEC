/**
 * @soec/cia · dominio · CATÁLOGO de capacidades de marketing (resultados autorizables, NO herramientas).
 *
 * Principio rector del CIA: el usuario autoriza CAPACIDADES (resultados que quiere lograr), nunca
 * herramientas. La selección y operación del proveedor (Meta, Google, un CRM…) pertenece a la plataforma y
 * vive DETRÁS de la frontera. Por eso este catálogo es NEUTRAL: cada entrada nombra un resultado en lenguaje
 * de negocio; los proveedores candidatos son REFERENCIAS OPACAS (`proveedoresRef`) que jamás se muestran al
 * usuario y que, en modo REAL (aún bloqueado), resuelven a un adaptador de `@soec/adaptadores`/`@soec/canales`
 * detrás de una capacidad `@soec/plataforma-capacidades`. Aquí no hay nombres comerciales.
 */

/** Una capacidad de marketing = un resultado que el usuario puede autorizar. */
export interface CapacidadMarketing {
  /** id estable de la capacidad (resultado), no del proveedor. */
  readonly id: string;
  /** Texto de cara al usuario: describe el RESULTADO, nunca la herramienta. */
  readonly titulo: string;
  readonly descripcion: string;
  /** Unidad del límite que fija el usuario (p. ej. dinero mensual, envíos por mes). */
  readonly unidadLimite: 'CLP_MENSUAL' | 'ENVIOS_MENSUALES' | 'SIN_GASTO';
  /** Tipo de capacidad PCE (`@soec/plataforma-capacidades`) que la realiza. Interno, no comercial. */
  readonly capacidadTipoPCE: string;
  /**
   * Proveedores candidatos, como REFERENCIAS OPACAS detrás de la frontera. NUNCA se exponen al usuario.
   * SOEC elige cuál usar; son sustituibles sin cambiar la experiencia.
   */
  readonly proveedoresRef: readonly string[];
}

/**
 * Catálogo neutral. Cada resultado mapea a varios proveedores candidatos (opacos), lo que permite sustituir
 * la herramienta sin tocar la experiencia. Los `proveedoresRef` son identificadores internos, no marcas.
 */
export const CATALOGO_MARKETING: readonly CapacidadMarketing[] = [
  {
    id: 'captar-clientes-publicidad',
    titulo: 'Captar clientes con publicidad',
    descripcion: 'Que SOEC llegue a personas que aún no te conocen y las invite a acercarse, dentro del límite que fijes.',
    unidadLimite: 'CLP_MENSUAL',
    capacidadTipoPCE: 'publicidad-pagada',
    proveedoresRef: ['ads-alfa', 'ads-beta'],
  },
  {
    id: 'dar-a-conocer-marca',
    titulo: 'Dar a conocer tu marca',
    descripcion: 'Que SOEC difunda quién eres y qué ofreces para que más gente te tenga presente.',
    unidadLimite: 'CLP_MENSUAL',
    capacidadTipoPCE: 'difusion-social',
    proveedoresRef: ['social-alfa', 'social-beta'],
  },
  {
    id: 'medir-audiencia',
    titulo: 'Medir tu audiencia y resultados',
    descripcion: 'Que SOEC observe qué funciona y qué no, para aprender y mejorar tus objetivos.',
    unidadLimite: 'SIN_GASTO',
    capacidadTipoPCE: 'analitica',
    proveedoresRef: ['analitica-alfa'],
  },
  {
    id: 'enviar-correo',
    titulo: 'Escribir a tus clientes por correo',
    descripcion: 'Que SOEC mantenga el contacto con tus clientes por correo, dentro del límite de envíos que fijes.',
    unidadLimite: 'ENVIOS_MENSUALES',
    capacidadTipoPCE: 'correo',
    proveedoresRef: ['correo-alfa', 'correo-beta'],
  },
  {
    id: 'gestionar-clientes',
    titulo: 'Ordenar tu relación con los clientes',
    descripcion: 'Que SOEC mantenga ordenada la información de tus clientes y su historial contigo.',
    unidadLimite: 'SIN_GASTO',
    capacidadTipoPCE: 'crm',
    proveedoresRef: ['crm-alfa'],
  },
  {
    id: 'publicar-sitio',
    titulo: 'Publicar en tu sitio web',
    descripcion: 'Que SOEC mantenga al día los contenidos de tu sitio para acompañar tus objetivos.',
    unidadLimite: 'SIN_GASTO',
    capacidadTipoPCE: 'sitio',
    proveedoresRef: ['sitio-alfa'],
  },
];

export function buscarCapacidad(id: string): CapacidadMarketing | undefined {
  return CATALOGO_MARKETING.find((c) => c.id === id);
}

/** Todas las referencias de proveedor del catálogo (para verificar que ninguna se filtre a la vista). */
export function todosLosProveedoresRef(): readonly string[] {
  return CATALOGO_MARKETING.flatMap((c) => c.proveedoresRef);
}
