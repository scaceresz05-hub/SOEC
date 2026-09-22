/**
 * apps/api · ACEPTACIÓN · PREPARACIÓN COMERCIAL de una empresa real (Autonomy Fase H, nivel C).
 *
 * Responde una pregunta distinta de la del onboarding. El readiness de la Fase D contesta «¿entendemos este
 * negocio?». Esto contesta: **«si mañana quisiéramos que SOEC llevara el marketing de esta empresa, qué falta,
 * quién lo tiene que hacer, y qué puede hacer SOEC por su cuenta»**.
 *
 * Tres reglas que hacen que este informe sirva para vender y para operar:
 *
 *  1. **No inventa nada.** Cada ítem se calcula desde lo PERSISTIDO. Si un dato no está, el ítem no está listo;
 *     no se rellena la empresa para que el informe se vea verde.
 *  2. **Distingue quién resuelve.** `MISSING` es un dato que falta, `HUMAN_ACTION_REQUIRED` es un acto que sólo
 *     puede hacer una persona (conectar una cuenta, firmar dinero, instalar la medición en su web) y
 *     `SYSTEM_ACTION_REQUIRED` es trabajo que SOEC puede hacer solo en cuanto lo anterior exista.
 *  3. **No reemplaza al motor de readiness.** Los nueve ítems de negocio se derivan de `evaluarReadiness`
 *     (Fase D); aquí se añade lo operativo de las Fases E–G. Un solo motor, dos preguntas.
 *
 * FUNCIÓN PURA: recibe hechos, devuelve el read model. No escribe, no consulta y no toca ninguna empresa.
 */
import type { BusinessReadiness, DominioReadiness } from '../onboarding/readiness';

export type EstadoItem =
  | 'READY'                    // está, y se puede comprobar en los datos
  | 'MISSING'                  // falta un dato: se resuelve respondiendo
  | 'HUMAN_ACTION_REQUIRED'    // sólo una persona puede hacerlo (conectar, autorizar, instalar, decidir)
  | 'SYSTEM_ACTION_REQUIRED'   // SOEC puede hacerlo por su cuenta cuando lo anterior exista
  | 'OPTIONAL';                // no bloquea nada y nadie lo ha tocado

export type ItemPreparacion =
  | 'PERFIL_DEL_NEGOCIO'
  | 'SITIO_WEB_OBSERVADO'
  | 'OFERTA_DECLARADA'
  | 'TERRITORIO_DECLARADO'
  | 'OBJETIVO_COMERCIAL'
  | 'ACCION_DE_CLIENTE'
  | 'LIMITES_DE_COMUNICACION'
  | 'POLITICA_DE_EVALUACION'
  | 'TECHO_DE_INVERSION'
  | 'CONEXION_GOOGLE_ADS'
  | 'CAPACIDAD_DE_MEDICION'
  | 'CAPACIDAD_DE_ESCRITURA'
  | 'MODO_OPERATIVO'
  | 'GOBIERNO_DE_EJECUCION'
  | 'MANDATO_FINANCIERO'
  | 'INVESTIGACION_Y_PLAN'
  | 'MEDICION_VERIFICADA'
  | 'CAMPANA_CREADA';

/** Orden estable: la interfaz, el informe y las pruebas ven siempre la misma secuencia. */
export const ITEMS: readonly ItemPreparacion[] = [
  'PERFIL_DEL_NEGOCIO', 'SITIO_WEB_OBSERVADO', 'OFERTA_DECLARADA', 'TERRITORIO_DECLARADO', 'OBJETIVO_COMERCIAL',
  'ACCION_DE_CLIENTE', 'LIMITES_DE_COMUNICACION', 'POLITICA_DE_EVALUACION', 'TECHO_DE_INVERSION',
  'CONEXION_GOOGLE_ADS', 'CAPACIDAD_DE_MEDICION', 'CAPACIDAD_DE_ESCRITURA', 'MODO_OPERATIVO',
  'GOBIERNO_DE_EJECUCION', 'MANDATO_FINANCIERO', 'INVESTIGACION_Y_PLAN', 'MEDICION_VERIFICADA', 'CAMPANA_CREADA',
];

export interface ItemEvaluado {
  readonly item: ItemPreparacion;
  readonly estado: EstadoItem;
  /** Qué se observó en los datos, en lenguaje de negocio. Nunca un identificador técnico solo. */
  readonly observado: string;
  /** Qué hay que hacer para pasarlo a READY. `null` cuando ya lo está. */
  readonly siguientePaso: string | null;
}

export type Hito = 'CREAR_CAMPANA' | 'ENCENDER_CAMPANA' | 'OPERAR_CON_AUTONOMIA';

export interface HitoEvaluado {
  readonly hito: Hito;
  readonly listo: boolean;
  readonly bloqueos: readonly string[];
}

export interface PreparacionComercial {
  readonly organizationId: string;
  readonly evaluadoEn: string;
  readonly items: readonly ItemEvaluado[];
  readonly hitos: readonly HitoEvaluado[];
  /** Cuántos ítems hay en cada estado. Un resumen que no esconde nada porque los ítems van al lado. */
  readonly conteo: Readonly<Record<EstadoItem, number>>;
  /** Lo siguiente que conviene hacer, y de quién es. `null` si no falta nada. */
  readonly siguienteAccion: { readonly de: 'LA_EMPRESA' | 'SOEC'; readonly que: string } | null;
}

export interface DatosPreparacion {
  readonly organizationId: string;
  readonly ahora: string;
  /** Readiness de la Fase D: la fuente de los ítems de negocio. */
  readonly readiness: BusinessReadiness;
  readonly sitio: { readonly url: string | null; readonly estado: string | null; readonly paginas: number } | null;
  /** Sitio DECLARADO en el perfil. Declarado no es observado: sirve para saber si SOEC ya puede mirarlo. */
  readonly sitioDeclarado: string | null;
  /**
   * Lo que la INVESTIGACIÓN observó del sitio (Fase E). Vale como observación: es el mismo sitio, leído por
   * otra vía. Sin esto, un negocio que sí tiene páginas aterrizables aparecería como si no tuviera sitio.
   */
  readonly landings: readonly { readonly ofertaSlug: string; readonly estado: string; readonly url: string | null }[];
  readonly conexionGoogle: { readonly estado: string; readonly cuenta: string | null } | null;
  readonly capacidades: readonly string[];
  readonly modoOperativo: string;
  readonly gobierno: { readonly externalMutations: boolean; readonly campaignExecution: boolean; readonly autonomousSpend: boolean } | null;
  readonly mandato: { readonly vigente: boolean; readonly topeMinor: number; readonly moneda: string; readonly hasta: string } | null;
  readonly investigacion: { readonly estado: string; readonly fresca: boolean; readonly terminos: number } | null;
  readonly plan: { readonly estado: string; readonly vigente: boolean; readonly grupos: number } | null;
  readonly medicion: readonly { readonly eventKey: string; readonly estado: string }[];
  readonly campana: { readonly estado: string; readonly campaignId: string | null; readonly reconciliada: boolean | null } | null;
  readonly politicaAutonomia: { readonly accionesPermitidas: readonly string[]; readonly activacionAutonomaPermitida: boolean } | null;
}

const it = (item: ItemPreparacion, estado: EstadoItem, observado: string, siguientePaso: string | null): ItemEvaluado =>
  ({ item, estado, observado, siguientePaso });

/** Traduce un dominio del readiness (Fase D) a un ítem de preparación, sin volver a decidir nada. */
function desdeReadiness(r: BusinessReadiness, dominio: DominioReadiness, item: ItemPreparacion, comoSeResuelve: string): ItemEvaluado {
  const d = r.dominios.find((x) => x.dominio === dominio);
  if (d === undefined) return it(item, 'MISSING', 'no se pudo evaluar', comoSeResuelve);
  const motivos = d.motivos.map((m) => m.motivo).join('; ');
  switch (d.estado) {
    case 'COMPLETE': return it(item, 'READY', motivos === '' ? 'declarado y completo' : `declarado (${motivos})`, null);
    case 'OPTIONAL': return it(item, 'OPTIONAL', motivos === '' ? 'sin revisar, y no bloquea' : motivos, comoSeResuelve);
    case 'ACTION_REQUIRED': return it(item, 'HUMAN_ACTION_REQUIRED', motivos, comoSeResuelve);
    default: return it(item, 'MISSING', motivos === '' ? 'falta información' : motivos, comoSeResuelve);
  }
}

export function evaluarPreparacionComercial(d: DatosPreparacion): PreparacionComercial {
  const capacidades = new Set(d.capacidades);
  const items: ItemEvaluado[] = [];

  // ── 1–9. El negocio, tal como lo entiende el motor de readiness ───────────────────────────────
  items.push(desdeReadiness(d.readiness, 'BUSINESS_PROFILE', 'PERFIL_DEL_NEGOCIO', 'contar a qué se dedica la empresa'));

  // El sitio no es un dato declarado: es una OBSERVACIÓN, y puede venir de dos vías (la inspección del
  // onboarding o la investigación). Sin una página que responda no hay dónde aterrice el clic.
  const aterrizables = d.landings.filter((l) => l.estado === 'READY' || l.estado === 'WEAK');
  items.push(
    d.sitio !== null && d.sitio.url !== null && d.sitio.estado === 'OK'
      ? it('SITIO_WEB_OBSERVADO', 'READY', `${d.sitio.url} responde y se observaron ${d.sitio.paginas} páginas`, null)
      : aterrizables.length > 0
        ? it('SITIO_WEB_OBSERVADO', 'READY', `la investigación encontró ${aterrizables.length} página(s) aterrizable(s) del sitio`, null)
        : d.sitio !== null && d.sitio.url !== null
          ? it('SITIO_WEB_OBSERVADO', 'HUMAN_ACTION_REQUIRED', `${d.sitio.url} no se pudo leer (${d.sitio.estado ?? 'sin estado'})`, 'revisar que el sitio esté publicado y accesible en https')
          : d.sitioDeclarado !== null
            ? it('SITIO_WEB_OBSERVADO', 'SYSTEM_ACTION_REQUIRED', `hay sitio declarado (${d.sitioDeclarado}) y SOEC todavía no lo ha mirado`, 'SOEC puede inspeccionarlo al investigar el mercado')
            : it('SITIO_WEB_OBSERVADO', 'MISSING', 'no hay sitio declarado', 'indicar la dirección del sitio web'),
  );

  items.push(desdeReadiness(d.readiness, 'OFFER', 'OFERTA_DECLARADA', 'escribir los servicios como los nombra la empresa'));
  items.push(desdeReadiness(d.readiness, 'GEOGRAPHY', 'TERRITORIO_DECLARADO', 'indicar las comunas o ciudades donde atiende'));
  items.push(desdeReadiness(d.readiness, 'OBJECTIVE', 'OBJETIVO_COMERCIAL', 'elegir qué quiere conseguir'));
  items.push(desdeReadiness(d.readiness, 'CONVERSIONS', 'ACCION_DE_CLIENTE', 'elegir la acción que hace un cliente interesado'));
  items.push(desdeReadiness(d.readiness, 'RESTRICTIONS', 'LIMITES_DE_COMUNICACION', 'revisar qué no debe decir nunca la publicidad'));
  items.push(desdeReadiness(d.readiness, 'EVALUATION', 'POLITICA_DE_EVALUACION', 'definir el indicador, la meta y cuántos datos hacen falta'));
  items.push(desdeReadiness(d.readiness, 'FINANCIAL_MANDATE', 'TECHO_DE_INVERSION', 'declarar cuánto como máximo se invertiría'));

  // ── 10–15. Lo que ningún formulario puede dar: cuentas, permisos y dinero ─────────────────────
  items.push(
    d.conexionGoogle === null
      ? it('CONEXION_GOOGLE_ADS', 'HUMAN_ACTION_REQUIRED', 'no hay ninguna conexión de Google Ads', 'conectar la cuenta de Google Ads desde Conexiones y permisos')
      : d.conexionGoogle.estado !== 'CONNECTED'
        ? it('CONEXION_GOOGLE_ADS', 'HUMAN_ACTION_REQUIRED', `la conexión quedó en ${d.conexionGoogle.estado}`, 'terminar de conectar la cuenta y volver a validarla')
        : d.conexionGoogle.cuenta === null
          ? it('CONEXION_GOOGLE_ADS', 'HUMAN_ACTION_REQUIRED', 'la conexión existe pero no señala ninguna cuenta', 'elegir la cuenta de Google Ads que SOEC debe usar')
          : it('CONEXION_GOOGLE_ADS', 'READY', `conectada a la cuenta ${d.conexionGoogle.cuenta}`, null),
  );
  items.push(
    capacidades.has('MEDICION_REAL') || capacidades.has('INGESTA_GROWTH')
      ? it('CAPACIDAD_DE_MEDICION', 'READY', 'la lectura de datos reales está habilitada', null)
      : it('CAPACIDAD_DE_MEDICION', 'HUMAN_ACTION_REQUIRED', 'la lectura de datos reales no está habilitada', 'habilitar la capacidad de medición en Conexiones y permisos'),
  );
  items.push(
    capacidades.has('ESCRITURA_ADS')
      ? it('CAPACIDAD_DE_ESCRITURA', 'READY', 'SOEC puede crear en la cuenta de anuncios', null)
      : it('CAPACIDAD_DE_ESCRITURA', 'HUMAN_ACTION_REQUIRED', 'SOEC no tiene permiso para crear nada en la cuenta', 'habilitar la capacidad de escritura cuando se decida empezar'),
  );
  items.push(
    d.modoOperativo === 'SUPERVISED_REAL' || d.modoOperativo === 'AUTONOMOUS_REAL'
      ? it('MODO_OPERATIVO', 'READY', `el modo es ${d.modoOperativo === 'AUTONOMOUS_REAL' ? 'automático' : 'supervisado'}`, null)
      : it('MODO_OPERATIVO', 'HUMAN_ACTION_REQUIRED', 'el modo actual es sólo observar', 'cambiar el nivel de autonomía a supervisado'),
  );
  items.push(
    d.gobierno === null
      ? it('GOBIERNO_DE_EJECUCION', 'MISSING', 'no hay postura de gobierno registrada', 'se crea al dar de alta la empresa')
      : d.gobierno.campaignExecution && d.gobierno.externalMutations
        ? it('GOBIERNO_DE_EJECUCION', 'READY', 'la empresa autorizó ejecutar campañas y modificar sus cuentas', null)
        : it('GOBIERNO_DE_EJECUCION', 'HUMAN_ACTION_REQUIRED',
            `${d.gobierno.campaignExecution ? '' : 'ejecución de campañas cerrada'}${!d.gobierno.campaignExecution && !d.gobierno.externalMutations ? '; ' : ''}${d.gobierno.externalMutations ? '' : 'modificación de cuentas cerrada'}`,
            'abrir la postura de gobierno cuando se decida empezar a invertir'),
  );
  items.push(
    d.mandato === null
      ? it('MANDATO_FINANCIERO', 'HUMAN_ACTION_REQUIRED', 'nadie ha autorizado dinero', 'firmar una autorización de presupuesto con su tope y su período')
      : !d.mandato.vigente
        ? it('MANDATO_FINANCIERO', 'HUMAN_ACTION_REQUIRED', `la autorización venció el ${d.mandato.hasta.slice(0, 10)}`, 'renovar la autorización de presupuesto')
        : it('MANDATO_FINANCIERO', 'READY', `autorizados ${d.mandato.topeMinor} ${d.mandato.moneda} hasta el ${d.mandato.hasta.slice(0, 10)}`, null),
  );

  // ── 16–18. Lo que SOEC hace solo, en cuanto lo anterior exista ────────────────────────────────
  const negocioListo = d.readiness.niveles.find((n) => n.nivel === 'BUSINESS_READY')?.listo === true;
  items.push(
    d.investigacion === null || d.plan === null
      ? it('INVESTIGACION_Y_PLAN', negocioListo ? 'SYSTEM_ACTION_REQUIRED' : 'MISSING',
          d.investigacion === null ? 'no se ha investigado el mercado' : 'hay investigación pero no hay plan',
          negocioListo ? 'SOEC puede investigar y planificar sin intervención' : 'primero completar los datos del negocio')
      : !d.investigacion.fresca || !d.plan.vigente
        ? it('INVESTIGACION_Y_PLAN', 'SYSTEM_ACTION_REQUIRED', 'la investigación o el plan quedaron desactualizados al cambiar el negocio', 'SOEC puede volver a investigar y replanificar')
        : it('INVESTIGACION_Y_PLAN', 'READY', `investigación con ${d.investigacion.terminos} términos y plan con ${d.plan.grupos} grupos`, null),
  );

  const verificadas = d.medicion.filter((m) => m.estado === 'VERIFIED');
  const degradadas = d.medicion.filter((m) => m.estado === 'DEGRADED');
  items.push(
    d.medicion.length === 0
      ? it('MEDICION_VERIFICADA', capacidades.has('ESCRITURA_ADS') ? 'SYSTEM_ACTION_REQUIRED' : 'HUMAN_ACTION_REQUIRED',
          'no hay ninguna acción de conversión preparada',
          capacidades.has('ESCRITURA_ADS') ? 'SOEC puede crear la acción de conversión; instalar la medición en el sitio es de la empresa' : 'habilitar la escritura para que SOEC pueda preparar la medición')
      : degradadas.length > 0
        ? it('MEDICION_VERIFICADA', 'HUMAN_ACTION_REQUIRED', `${degradadas.length} medición(es) dejaron de registrar`, 'revisar por qué la señal dejó de llegar al sitio')
        : verificadas.length === d.medicion.length
          ? it('MEDICION_VERIFICADA', 'READY', `${verificadas.length} de ${d.medicion.length} acciones con señal observada`, null)
          : it('MEDICION_VERIFICADA', 'HUMAN_ACTION_REQUIRED', `${verificadas.length} de ${d.medicion.length} acciones con señal observada`, 'instalar la medición en el sitio y esperar la primera señal real'),
  );
  items.push(
    d.campana === null
      ? it('CAMPANA_CREADA', 'SYSTEM_ACTION_REQUIRED', 'no hay campaña creada', 'SOEC la crea EN PAUSA cuando los requisitos estén; crear no es gastar')
      : d.campana.estado === 'CREATED_PAUSED' || d.campana.estado === 'ACTIVE'
        ? d.campana.reconciliada === false
          ? it('CAMPANA_CREADA', 'HUMAN_ACTION_REQUIRED', `la campaña ${d.campana.campaignId ?? 'creada'} fue cambiada fuera de SOEC`, 'revisar los cambios hechos por fuera antes de seguir')
          : it('CAMPANA_CREADA', 'READY', `campaña ${d.campana.campaignId ?? 'sin id'} creada (${d.campana.estado})`, null)
        : it('CAMPANA_CREADA', 'SYSTEM_ACTION_REQUIRED', `la última preparación quedó en ${d.campana.estado}`, 'SOEC puede volver a preparar y ejecutar'),
  );

  // ── Hitos: qué se puede hacer HOY con esta empresa ────────────────────────────────────────────
  const estado = (i: ItemPreparacion): EstadoItem => items.find((x) => x.item === i)!.estado;
  const listo = (i: ItemPreparacion): boolean => estado(i) === 'READY' || estado(i) === 'OPTIONAL';
  const falta = (i: ItemPreparacion, texto: string): readonly string[] => (listo(i) ? [] : [texto]);

  const crear = [
    ...falta('PERFIL_DEL_NEGOCIO', 'falta saber a qué se dedica'),
    ...falta('OFERTA_DECLARADA', 'falta saber qué vende'),
    ...falta('TERRITORIO_DECLARADO', 'falta saber dónde atiende'),
    ...falta('OBJETIVO_COMERCIAL', 'falta el objetivo comercial'),
    ...falta('ACCION_DE_CLIENTE', 'falta saber qué hace un cliente interesado'),
    ...falta('POLITICA_DE_EVALUACION', 'falta con qué indicador y qué meta se evalúa'),
    ...falta('CONEXION_GOOGLE_ADS', 'falta la cuenta de Google Ads conectada'),
    ...falta('CAPACIDAD_DE_ESCRITURA', 'falta el permiso para crear en la cuenta'),
    ...falta('GOBIERNO_DE_EJECUCION', 'falta abrir la postura de gobierno'),
    ...falta('MANDATO_FINANCIERO', 'falta la autorización de presupuesto'),
    ...falta('MODO_OPERATIVO', 'el modo actual es sólo observar'),
    ...falta('INVESTIGACION_Y_PLAN', 'falta investigar y planificar'),
  ];
  const encender = [
    ...(crear.length > 0 ? ['primero hay que poder crear la campaña'] : []),
    ...falta('CAMPANA_CREADA', 'falta crear la campaña (nace en pausa)'),
    ...falta('MEDICION_VERIFICADA', 'falta que llegue la primera señal real de medición'),
    ...falta('SITIO_WEB_OBSERVADO', 'falta un sitio que responda: es donde aterriza el clic'),
  ];
  const autonomia = [
    ...(encender.length > 0 ? ['primero hay que poder encender la campaña'] : []),
    ...(d.politicaAutonomia === null || d.politicaAutonomia.accionesPermitidas.length === 0
      ? ['falta declarar qué puede hacer SOEC por su cuenta'] : []),
    ...(d.politicaAutonomia?.activacionAutonomaPermitida === true ? [] : ['falta autorizar que SOEC encienda campañas sin preguntar']),
    ...(d.gobierno?.autonomousSpend === true ? [] : ['falta habilitar el gasto autónomo']),
    ...(d.modoOperativo === 'AUTONOMOUS_REAL' ? [] : ['el modo actual no es automático']),
  ];

  const conteo: Record<EstadoItem, number> = { READY: 0, MISSING: 0, HUMAN_ACTION_REQUIRED: 0, SYSTEM_ACTION_REQUIRED: 0, OPTIONAL: 0 };
  for (const x of items) conteo[x.estado] += 1;

  // La siguiente acción se elige por el orden de los ítems: lo primero que bloquea es lo que toca hacer.
  const pendiente = items.find((x) => x.estado === 'MISSING')
    ?? items.find((x) => x.estado === 'HUMAN_ACTION_REQUIRED')
    ?? items.find((x) => x.estado === 'SYSTEM_ACTION_REQUIRED')
    ?? null;

  return {
    organizationId: d.organizationId,
    evaluadoEn: d.ahora,
    items,
    hitos: [
      { hito: 'CREAR_CAMPANA', listo: crear.length === 0, bloqueos: crear },
      { hito: 'ENCENDER_CAMPANA', listo: encender.length === 0, bloqueos: encender },
      { hito: 'OPERAR_CON_AUTONOMIA', listo: autonomia.length === 0, bloqueos: autonomia },
    ],
    conteo,
    siguienteAccion: pendiente === null ? null : {
      de: pendiente.estado === 'SYSTEM_ACTION_REQUIRED' ? 'SOEC' : 'LA_EMPRESA',
      que: pendiente.siguientePaso ?? pendiente.observado,
    },
  };
}
