/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · instalación de la medición.
 *
 * El patrón que esta fase quiere eliminar como arquitectura es «un desarrollador (o Claude) edita a mano la web
 * de cada empresa para poner la medición». Aquí se declara el puerto que lo sustituye:
 *
 *   `TrackingDeploymentProvider` — instala la medición en un sitio que SOEC controla por una vía soportada.
 *
 * Y se declara también el límite honesto: si para una empresa NO existe una vía segura y real, el estado es
 * `TRACKING_INSTALLATION_REQUIRED`, la ejecución queda bloqueada y **no se marca `VERIFIED`**. Fingir la
 * verificación sería peor que no tenerla: la campaña optimizaría a una señal que no llega.
 *
 * En este despliegue el único proveedor implementado es el del PUENTE DE MEDICIÓN propio (`GROWTH_M2M`, Fase B):
 * ahí SOEC ya tiene un canal autenticado con el sitio del negocio y puede comprobar si la señal llega. Para
 * cualquier otro sitio, la instalación es una acción humana con instrucciones claras.
 */
import type { EstadoMedicion } from './ejecucion-tipos';

export interface InstruccionInstalacion {
  /** Qué hay que hacer, en lenguaje de negocio. */
  readonly titulo: string;
  readonly detalle: string;
  /** Fragmento a pegar, cuando aplique. Nunca contiene secretos: sólo identificadores públicos de medición. */
  readonly fragmento: string | null;
}

export interface ResultadoInstalacion {
  readonly estado: EstadoMedicion;
  readonly metodo: string;
  readonly detalle: string;
  readonly instrucciones: readonly InstruccionInstalacion[];
}

/**
 * Puerto de instalación de medición. Una implementación sólo debe existir donde haya una vía SEGURA y real de
 * escribir en el sitio del negocio; mientras no la haya, `instalar` devuelve `TRACKING_MISSING` con las
 * instrucciones para que lo haga una persona.
 */
export interface TrackingDeploymentProvider {
  readonly nombre: string;
  /** ¿Este proveedor puede instalar en el sitio de esta organización? */
  soporta(org: string): Promise<boolean>;
  instalar(entrada: {
    readonly organizationId: string;
    readonly sitio: string;
    readonly conversionId: string | null;
    readonly conversionLabel: string | null;
    readonly eventKey: string;
  }): Promise<ResultadoInstalacion>;
  /** Comprueba si la señal LLEGA de verdad. Sin esto no existe `VERIFIED`. */
  verificar(entrada: { readonly organizationId: string; readonly eventKey: string }): Promise<{ readonly verificada: boolean; readonly detalle: string }>;
}

/** Fragmento estándar de medición de Google. Es público: no revela ningún secreto de la cuenta. */
export function fragmentoGoogle(conversionId: string, label: string | null, eventKey: string): string {
  const envio = label === null ? `AW-${conversionId}` : `AW-${conversionId}/${label}`;
  return [
    `<!-- SOEC · medición de «${eventKey}» -->`,
    `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-${conversionId}"></script>`,
    '<script>',
    '  window.dataLayer = window.dataLayer || [];',
    '  function gtag(){dataLayer.push(arguments);}',
    "  gtag('js', new Date());",
    `  gtag('config', 'AW-${conversionId}');`,
    `  // Llama a esta función cuando ocurra «${eventKey}» (por ejemplo, al pulsar el botón de contacto):`,
    `  function soecConversion(){ gtag('event', 'conversion', { send_to: '${envio}' }); }`,
    '</script>',
  ].join('\n');
}

/**
 * Proveedor por defecto: NO instala nada. Devuelve el estado honesto y las instrucciones para que una persona
 * lo haga. Existe para que el sistema funcione sin fingir: bloquear con instrucciones es mejor que mentir.
 */
export const instalacionManual: TrackingDeploymentProvider = {
  nombre: 'instalacion-manual',
  soporta: async () => false,
  instalar: async ({ conversionId, conversionLabel, eventKey, sitio }) => ({
    estado: 'TRACKING_MISSING',
    metodo: 'MANUAL',
    detalle: 'este despliegue no tiene una vía automática y segura para escribir en el sitio del negocio',
    instrucciones: [
      {
        titulo: `Instalar la medición de «${eventKey}» en ${sitio}`,
        detalle: 'Pega este fragmento en todas las páginas y llama a soecConversion() cuando ocurra la acción. Si tu web la lleva otra persona, envíaselo tal cual.',
        fragmento: conversionId === null ? null : fragmentoGoogle(conversionId, conversionLabel, eventKey),
      },
    ],
  }),
  // Sin señal observada no hay verificación. Este proveedor nunca devuelve `true`.
  verificar: async () => ({ verificada: false, detalle: 'no hay una vía automática para comprobar la señal' }),
};

/**
 * Proveedor sobre el PUENTE DE MEDICIÓN propio (Fase B). No escribe en el sitio: comprueba si la señal llega a
 * SOEC, que es justamente lo que convierte `TRACKING_INSTALLED` en `VERIFIED`.
 */
export function crearVerificadorPorIngesta(deps: {
  readonly hayEventosRecientes: (org: string, eventKey: string) => Promise<{ readonly observados: number; readonly desde: string | null }>;
}): TrackingDeploymentProvider {
  return {
    nombre: 'verificacion-por-ingesta',
    soporta: async () => false, // no instala; sólo verifica
    instalar: (e) => instalacionManual.instalar(e),
    verificar: async ({ organizationId, eventKey }) => {
      const { observados, desde } = await deps.hayEventosRecientes(organizationId, eventKey);
      return observados > 0
        ? { verificada: true, detalle: `se observaron ${observados} eventos desde ${desde ?? 'la última ingesta'}` }
        : { verificada: false, detalle: 'todavía no se ha observado ningún evento de esta acción' };
    },
  };
}
