/**
 * apps/api · ONBOARDING INTELIGENTE · catálogo de preguntas y ramas condicionales.
 *
 * FUNCIÓN PURA. Recibe lo que SOEC ya sabe del negocio y devuelve la conversación que toca ahora: qué pasos
 * aplican, qué preguntas se hacen, cuáles ya están respondidas y cuáles NO hace falta preguntar porque el
 * dato ya existe (de una respuesta previa, de una conexión o del propio sitio).
 *
 * TRES REGLAS QUE ESTE ARCHIVO HACE CUMPLIR:
 *
 *  1. SE PREGUNTA EN LENGUAJE DE NEGOCIO. Aquí no aparece CPC, CPA, ROAS, pixel, bidding ni capability. Si una
 *     pregunta sólo se entiende sabiendo marketing técnico, está mal escrita.
 *  2. NO ES UN FORMULARIO GIGANTE. La siguiente pregunta depende de las anteriores: a una tienda se le
 *     pregunta por despacho y a una consulta por zonas atendidas, y nadie ve las dos.
 *  3. NO SE PREGUNTA LO QUE SOEC YA SABE. Si el país ya está en el perfil o Google ya está conectado, eso se
 *     muestra para confirmar, no se vuelve a pedir.
 *
 * Las ramas se expresan por TIPO DE NEGOCIO y por respuestas previas — nunca por rubro concreto. «Clínica
 * dental» no existe como arquitectura: existe `CLINICA`, igual que `ECOMMERCE`, `SAAS`, `LOCAL` o `SERVICIOS`.
 */
import type { OfertaNegocio, PerfilNegocio, RestriccionNegocio, TerritorioNegocio } from '../negocio/negocio-pg';
import type { CapacidadPersistida, Conexion } from '../conexion/conexion-pg';
import type { PoliticaCompleta } from '../politica/politica-pg';
import type { IntencionPresupuesto, ObservacionSitio, RespuestaOnboarding } from './onboarding-pg';
import {
  PASOS_EN_ORDEN,
  type EstadoConfirmacion,
  type OpcionPregunta,
  type PasoId,
  type ProcedenciaDato,
  type TipoPregunta,
} from './onboarding-tipos';

export interface ContextoOnboarding {
  readonly perfil: PerfilNegocio;
  readonly oferta: readonly OfertaNegocio[];
  readonly territorios: readonly TerritorioNegocio[];
  readonly restricciones: readonly RestriccionNegocio[];
  readonly politica: PoliticaCompleta;
  readonly conexiones: readonly Conexion[];
  readonly capacidades: readonly CapacidadPersistida[];
  readonly sitio: ObservacionSitio | null;
  readonly presupuesto: IntencionPresupuesto | null;
  /** Modo operativo vigente de la organización (identidad). `PILOT` es el nombre almacenado de OBSERVE. */
  readonly modoOperativo: string;
  readonly respuestas: ReadonlyMap<string, RespuestaOnboarding>;
}

export interface PreguntaVista {
  readonly id: string;
  readonly etiqueta: string;
  readonly ayuda: string | null;
  readonly tipo: TipoPregunta;
  readonly opciones: readonly OpcionPregunta[];
  readonly requerida: boolean;
  readonly valorActual: unknown;
  readonly procedencia: ProcedenciaDato | null;
  readonly confirmacion: EstadoConfirmacion | null;
  /** `true` ⇒ SOEC ya lo sabe: se muestra para confirmar o corregir, no se vuelve a pedir. */
  readonly yaSabemos: boolean;
}

export type EstadoPaso = 'PENDIENTE' | 'COMPLETO';

export interface PasoVista {
  readonly id: PasoId;
  readonly titulo: string;
  readonly descripcion: string;
  readonly estado: EstadoPaso;
  readonly preguntas: readonly PreguntaVista[];
}

/** Definición interna de una pregunta. `aplica` es la rama condicional; `yaSabemos` resuelve la regla 3. */
interface DefPregunta {
  readonly id: string;
  readonly etiqueta: string;
  readonly ayuda?: string;
  readonly tipo: TipoPregunta;
  readonly opciones?: (ctx: ContextoOnboarding) => readonly OpcionPregunta[];
  readonly requerida?: boolean;
  readonly aplica?: (ctx: ContextoOnboarding) => boolean;
  /** Valor que SOEC ya conoce sin preguntar, con su procedencia. `null` ⇒ hay que preguntar. */
  readonly yaSabemos?: (ctx: ContextoOnboarding) => { readonly valor: unknown; readonly procedencia: ProcedenciaDato } | null;
}

interface DefPaso {
  readonly id: PasoId;
  readonly titulo: string;
  readonly descripcion: string;
  readonly preguntas: readonly DefPregunta[];
}

const TIPOS_NEGOCIO: readonly OpcionPregunta[] = [
  { valor: 'SERVICIOS', etiqueta: 'Presto servicios profesionales' },
  { valor: 'CLINICA', etiqueta: 'Tengo una clínica o consulta de salud' },
  { valor: 'LOCAL', etiqueta: 'Atiendo en un local con público presencial' },
  { valor: 'ECOMMERCE', etiqueta: 'Vendo productos por internet' },
  { valor: 'SAAS', etiqueta: 'Tengo un software o plataforma' },
  { valor: 'OTRO', etiqueta: 'Otra cosa' },
];

const OBJETIVOS: readonly OpcionPregunta[] = [
  { valor: 'nuevos-clientes', etiqueta: 'Conseguir nuevos clientes' },
  { valor: 'mas-consultas', etiqueta: 'Recibir más consultas' },
  { valor: 'reservas', etiqueta: 'Conseguir reservas o citas' },
  { valor: 'vender-productos', etiqueta: 'Vender productos' },
  { valor: 'demos', etiqueta: 'Conseguir demostraciones' },
  { valor: 'registros', etiqueta: 'Conseguir registros' },
  { valor: 'ventas-online', etiqueta: 'Aumentar las ventas por internet' },
];

/** Texto con el que se guarda el objetivo elegido. Es la frase del negocio, no un código de plataforma. */
export const TEXTO_DE_OBJETIVO: Readonly<Record<string, string>> = {
  'nuevos-clientes': 'conseguir nuevos clientes',
  'mas-consultas': 'recibir más consultas',
  reservas: 'conseguir reservas o citas',
  'vender-productos': 'vender productos',
  demos: 'conseguir demostraciones',
  registros: 'conseguir registros',
  'ventas-online': 'aumentar las ventas por internet',
};

/** Acciones de cliente en lenguaje humano, con el evento con el que se persisten. */
export const ACCIONES: ReadonlyArray<{ valor: string; etiqueta: string; eventKey: string }> = [
  { valor: 'llama', etiqueta: 'Te llama por teléfono', eventKey: 'phone_intent' },
  { valor: 'whatsapp', etiqueta: 'Te escribe por WhatsApp', eventKey: 'whatsapp_intent' },
  { valor: 'formulario', etiqueta: 'Completa un formulario', eventKey: 'form_submitted' },
  { valor: 'agenda', etiqueta: 'Pide una hora o agenda', eventKey: 'appointment_intent' },
  { valor: 'compra', etiqueta: 'Compra', eventKey: 'purchase' },
  { valor: 'cotizacion', etiqueta: 'Pide una cotización', eventKey: 'quote_requested' },
  { valor: 'demo', etiqueta: 'Pide una demostración', eventKey: 'demo_requested' },
  { valor: 'registro', etiqueta: 'Se registra', eventKey: 'signup' },
];

/**
 * Indicadores ofrecidos, en lenguaje de negocio. La FORMA (tipo/unidad/dirección) la pone el sistema: el
 * usuario elige qué le importa, no cómo se modela.
 */
export const INDICADORES: ReadonlyArray<{
  valor: string; etiqueta: string; clave: string; tipo: string; unidad: string; direccion: string; ayudaMeta: string;
}> = [
  { valor: 'cantidad-contactos', etiqueta: 'Cuántos clientes interesados consigo', clave: 'contactos', tipo: 'EVENT_COUNT', unidad: 'COUNT', direccion: 'HIGHER_IS_BETTER', ayudaMeta: '¿Cuántos te gustaría conseguir en el período?' },
  { valor: 'costo-por-contacto', etiqueta: 'Cuánto me cuesta cada cliente interesado', clave: 'cpa', tipo: 'COST_PER', unidad: 'CURRENCY', direccion: 'LOWER_IS_BETTER', ayudaMeta: '¿Cuánto es aceptable pagar por cada uno? (en pesos)' },
  { valor: 'cantidad-ventas', etiqueta: 'Cuántas ventas hago', clave: 'ventas', tipo: 'EVENT_COUNT', unidad: 'COUNT', direccion: 'HIGHER_IS_BETTER', ayudaMeta: '¿Cuántas ventas esperas en el período?' },
  { valor: 'retorno-publicidad', etiqueta: 'Cuánto vendo por cada peso invertido', clave: 'roas', tipo: 'RATIO', unidad: 'RATIO', direccion: 'HIGHER_IS_BETTER', ayudaMeta: 'Por cada $1 invertido, cuántos $ de venta esperas' },
];

const respuestaDe = (ctx: ContextoOnboarding, id: string): unknown => ctx.respuestas.get(id)?.valor ?? null;
const textoDe = (ctx: ContextoOnboarding, id: string): string => {
  const v = respuestaDe(ctx, id);
  return typeof v === 'string' ? v : '';
};
const tipoNegocio = (ctx: ContextoOnboarding): string => {
  const respondido = textoDe(ctx, 'negocio.tipo');
  return respondido !== '' ? respondido : ctx.perfil.businessType;
};
const conexionDe = (ctx: ContextoOnboarding, provider: string): Conexion | null =>
  ctx.conexiones.find((c) => c.provider === provider) ?? null;
const accionesElegidas = (ctx: ContextoOnboarding): readonly string[] => {
  const v = respuestaDe(ctx, 'contacto.como');
  if (Array.isArray(v)) return v.map((x) => String(x));
  // Si no hay respuesta, se derivan de los eventos ya persistidos (una empresa migrada ya los tiene).
  return ctx.politica.eventos.map((e) => ACCIONES.find((a) => a.eventKey === e.eventKey)?.valor).filter((x): x is string => x !== undefined);
};

/**
 * ¿Necesita este negocio un puente de datos propio (envío de eventos máquina a máquina)? Sólo se ofrece a
 * quien tiene un sistema que pueda enviarlos. A una peluquería no se le pregunta por integraciones M2M.
 */
const puedeTenerSistemaPropio = (ctx: ContextoOnboarding): boolean => {
  const t = tipoNegocio(ctx);
  return t === 'ECOMMERCE' || t === 'SAAS' || conexionDe(ctx, 'GROWTH_M2M') !== null;
};

const PASOS: readonly DefPaso[] = [
  {
    id: 'negocio',
    titulo: 'Tu empresa',
    descripcion: 'Lo básico para entender de qué se trata.',
    preguntas: [
      {
        id: 'negocio.aQueSeDedica',
        etiqueta: '¿A qué se dedica tu empresa?',
        ayuda: 'Una o dos frases, como se lo contarías a un cliente.',
        tipo: 'TEXTO_LARGO',
        requerida: true,
        yaSabemos: (ctx) => (ctx.perfil.description ? { valor: ctx.perfil.description, procedencia: 'USER' } : null),
      },
      {
        id: 'negocio.tipo',
        etiqueta: '¿Cuál de estas opciones describe mejor tu negocio?',
        tipo: 'OPCION',
        opciones: () => TIPOS_NEGOCIO,
        requerida: true,
        yaSabemos: (ctx) => ({ valor: ctx.perfil.businessType, procedencia: 'USER' }),
      },
      {
        id: 'negocio.tipoCliente',
        etiqueta: '¿A quién le vendes?',
        tipo: 'OPCION',
        opciones: () => [
          { valor: 'B2C', etiqueta: 'A personas' },
          { valor: 'B2B', etiqueta: 'A otras empresas' },
          { valor: 'BOTH', etiqueta: 'A las dos cosas' },
        ],
        requerida: true,
        yaSabemos: (ctx) => ({ valor: ctx.perfil.customerType, procedencia: 'USER' }),
      },
      {
        id: 'negocio.sitio',
        etiqueta: '¿Tienes sitio web?',
        ayuda: 'Si lo tienes, pégalo aquí. Si no, puedes seguir sin él.',
        tipo: 'TEXTO',
        yaSabemos: (ctx) => (ctx.perfil.website ? { valor: ctx.perfil.website, procedencia: 'USER' } : null),
      },
      {
        id: 'negocio.pais',
        etiqueta: '¿En qué país opera tu empresa?',
        tipo: 'OPCION',
        opciones: () => [
          { valor: 'CL', etiqueta: 'Chile' },
          { valor: 'AR', etiqueta: 'Argentina' },
          { valor: 'MX', etiqueta: 'México' },
          { valor: 'CO', etiqueta: 'Colombia' },
          { valor: 'PE', etiqueta: 'Perú' },
          { valor: 'ES', etiqueta: 'España' },
        ],
        requerida: true,
        // Ya viene del alta: se confirma, no se vuelve a pedir (regla 3).
        yaSabemos: (ctx) => ({ valor: ctx.perfil.country, procedencia: 'USER' }),
      },
    ],
  },
  {
    id: 'oferta',
    titulo: 'Qué vendes',
    descripcion: 'Tus productos o servicios, tal como los nombras tú.',
    preguntas: [
      {
        id: 'oferta.queVendes',
        etiqueta: '¿Qué vendes o qué servicios prestas?',
        ayuda: 'Escríbelo normal, separado por comas. Por ejemplo: cortes, tintura y peinados.',
        tipo: 'TEXTO_LARGO',
        requerida: true,
        yaSabemos: (ctx) => (ctx.oferta.length > 0 ? { valor: ctx.oferta.map((o) => o.name).join(', '), procedencia: 'USER' } : null),
      },
      {
        id: 'oferta.prioritarios',
        etiqueta: '¿Cuáles quieres potenciar primero?',
        ayuda: 'Puedes elegir más de uno, o ninguno si todos te dan igual.',
        tipo: 'OPCIONES',
        opciones: (ctx) => ctx.oferta.map((o) => ({ valor: o.slug, etiqueta: o.name })),
        aplica: (ctx) => ctx.oferta.length > 1,
        yaSabemos: (ctx) => {
          const prioritarios = ctx.oferta.filter((o) => o.priority <= 10).map((o) => o.slug);
          return prioritarios.length > 0 ? { valor: prioritarios, procedencia: 'USER' } : null;
        },
      },
      {
        id: 'oferta.ventaOnline',
        etiqueta: '¿Se puede comprar directamente en tu sitio?',
        tipo: 'SI_NO',
        aplica: (ctx) => tipoNegocio(ctx) === 'ECOMMERCE',
      },
      {
        id: 'oferta.modalidadPrueba',
        etiqueta: '¿Cómo prueba un cliente tu software antes de pagar?',
        tipo: 'OPCION',
        opciones: () => [
          { valor: 'demo', etiqueta: 'Con una demostración que hacemos nosotros' },
          { valor: 'prueba', etiqueta: 'Con una prueba gratis que usa solo' },
          { valor: 'ninguna', etiqueta: 'No hay prueba: se contrata directamente' },
        ],
        aplica: (ctx) => tipoNegocio(ctx) === 'SAAS',
      },
    ],
  },
  {
    id: 'territorio',
    titulo: 'Dónde atiendes',
    descripcion: 'El territorio donde tu empresa realmente puede atender o vender.',
    preguntas: [
      {
        id: 'territorio.donde',
        etiqueta: '¿En qué comunas o ciudades atiendes?',
        ayuda: 'Sepáralas por comas. Si atiendes en todo el país, escríbelo así.',
        tipo: 'TEXTO_LARGO',
        requerida: true,
        aplica: (ctx) => tipoNegocio(ctx) !== 'SAAS',
        yaSabemos: (ctx) => {
          const t = ctx.territorios.find((x) => x.ambito === 'BUSINESS');
          return t && t.localities.length > 0 ? { valor: t.localities.join(', '), procedencia: 'USER' } : null;
        },
      },
      {
        id: 'territorio.region',
        etiqueta: '¿En qué región o provincia está eso?',
        ayuda: 'Opcional, ayuda a acotar mejor.',
        tipo: 'TEXTO',
        aplica: (ctx) => tipoNegocio(ctx) !== 'SAAS',
        yaSabemos: (ctx) => {
          const t = ctx.territorios.find((x) => x.ambito === 'BUSINESS');
          const v = t?.province ?? t?.region ?? null;
          return v ? { valor: v, procedencia: 'USER' } : null;
        },
      },
      {
        id: 'territorio.despacho',
        etiqueta: '¿Hasta dónde despachas?',
        tipo: 'OPCION',
        opciones: () => [
          { valor: 'local', etiqueta: 'Solo en mi ciudad o comuna' },
          { valor: 'regional', etiqueta: 'En mi región' },
          { valor: 'nacional', etiqueta: 'A todo el país' },
          { valor: 'retiro', etiqueta: 'No despacho: retiran en el local' },
        ],
        aplica: (ctx) => tipoNegocio(ctx) === 'ECOMMERCE',
      },
      {
        id: 'territorio.alcanceSaas',
        etiqueta: '¿En qué países vendes tu software?',
        tipo: 'TEXTO',
        aplica: (ctx) => tipoNegocio(ctx) === 'SAAS',
      },
    ],
  },
  {
    id: 'objetivo',
    titulo: 'Qué quieres conseguir',
    descripcion: 'El resultado que esperas. Con esto SOEC sabrá si te va bien o mal.',
    preguntas: [
      {
        id: 'objetivo.queQuieres',
        etiqueta: '¿Qué quieres conseguir?',
        tipo: 'OPCION',
        opciones: () => OBJETIVOS,
        requerida: true,
        yaSabemos: (ctx) => {
          const texto = ctx.politica.politica?.objectiveText ?? ctx.perfil.primaryObjective;
          if (!texto) return null;
          const opcion = Object.entries(TEXTO_DE_OBJETIVO).find(([, t]) => t === texto)?.[0] ?? null;
          return opcion !== null ? { valor: opcion, procedencia: 'USER' } : null;
        },
      },
      {
        id: 'objetivo.enCuantoTiempo',
        etiqueta: '¿En cuántos días esperas ver resultados?',
        ayuda: 'Una estimación basta. Si no sabes, deja 30.',
        tipo: 'NUMERO',
        yaSabemos: (ctx) => {
          const d = ctx.politica.politica?.evaluationHorizonDays ?? null;
          return d !== null ? { valor: d, procedencia: 'USER' } : null;
        },
      },
    ],
  },
  {
    id: 'contacto',
    titulo: 'Cómo te contactan',
    descripcion: 'Lo que hace una persona cuando de verdad está interesada.',
    preguntas: [
      {
        id: 'contacto.como',
        etiqueta: '¿Qué hace una persona cuando está realmente interesada?',
        ayuda: 'Marca todo lo que aplique.',
        tipo: 'OPCIONES',
        opciones: () => ACCIONES.map((a) => ({ valor: a.valor, etiqueta: a.etiqueta })),
        requerida: true,
        yaSabemos: (ctx) => {
          const valores = ctx.politica.eventos.map((e) => ACCIONES.find((a) => a.eventKey === e.eventKey)?.valor).filter((x): x is string => x !== undefined);
          return valores.length > 0 ? { valor: valores, procedencia: 'USER' } : null;
        },
      },
      {
        id: 'contacto.principal',
        etiqueta: '¿Cuál de esas es la más importante para ti?',
        tipo: 'OPCION',
        opciones: (ctx) => {
          const elegidas = accionesElegidas(ctx);
          return ACCIONES.filter((a) => elegidas.includes(a.valor)).map((a) => ({ valor: a.valor, etiqueta: a.etiqueta }));
        },
        requerida: true,
        aplica: (ctx) => accionesElegidas(ctx).length > 1,
        yaSabemos: (ctx) => {
          const primario = ctx.politica.eventos.find((e) => e.rol === 'PRIMARY');
          const valor = primario ? ACCIONES.find((a) => a.eventKey === primario.eventKey)?.valor ?? null : null;
          return valor !== null ? { valor, procedencia: 'USER' } : null;
        },
      },
      {
        id: 'contacto.agenda',
        etiqueta: '¿Tienes agenda o reserva de horas?',
        tipo: 'SI_NO',
        aplica: (ctx) => ['CLINICA', 'LOCAL', 'SERVICIOS'].includes(tipoNegocio(ctx)),
      },
    ],
  },
  {
    id: 'restricciones',
    titulo: 'Lo que no debemos decir',
    descripcion: 'Límites que la publicidad nunca debe cruzar. Esto evita promesas que tú no puedes cumplir.',
    preguntas: [
      {
        id: 'restricciones.noOfrecemos',
        etiqueta: '¿Hay servicios o productos que NO ofreces y que a veces te preguntan?',
        ayuda: 'Por ejemplo: «no atendemos urgencias», «no hacemos envíos internacionales».',
        tipo: 'TEXTO_LARGO',
        yaSabemos: (ctx) => {
          const textos = ctx.restricciones.filter((r) => r.tipo === 'RESTRICTION').map((r) => r.texto);
          return textos.length > 0 ? { valor: textos.join('\n'), procedencia: 'USER' } : null;
        },
      },
      {
        id: 'restricciones.noPodemosAfirmar',
        etiqueta: '¿Hay algo que NO podamos afirmar en publicidad?',
        ayuda: 'Coberturas, convenios, precios o promesas que no correspondan. Por ejemplo: «no atendemos Fonasa».',
        tipo: 'TEXTO_LARGO',
        yaSabemos: (ctx) => {
          const textos = ctx.restricciones.filter((r) => r.tipo === 'PROHIBITED_CLAIM').map((r) => r.texto);
          return textos.length > 0 ? { valor: textos.join('\n'), procedencia: 'USER' } : null;
        },
      },
    ],
  },
  {
    id: 'medicion',
    titulo: 'Cómo sabremos si funciona',
    descripcion: 'Con qué medirlo y qué resultado consideras bueno.',
    preguntas: [
      {
        id: 'medicion.indicador',
        etiqueta: '¿Qué te importa más mirar?',
        tipo: 'OPCION',
        opciones: () => INDICADORES.map((i) => ({ valor: i.valor, etiqueta: i.etiqueta })),
        requerida: true,
        yaSabemos: (ctx) => {
          const kpi = ctx.politica.kpis.find((k) => k.rol === 'PRIMARY');
          const valor = kpi ? INDICADORES.find((i) => i.clave === kpi.clave)?.valor ?? null : null;
          return valor !== null ? { valor, procedencia: 'USER' } : null;
        },
      },
      {
        id: 'medicion.conoceMeta',
        etiqueta: '¿Tienes claro qué número sería un buen resultado?',
        ayuda: 'Si no lo sabes, no pasa nada: lo aprendemos observando los primeros datos.',
        tipo: 'SI_NO',
        requerida: true,
      },
      {
        id: 'medicion.meta',
        etiqueta: '¿Cuál es ese número?',
        tipo: 'NUMERO',
        aplica: (ctx) => respuestaDe(ctx, 'medicion.conoceMeta') === true,
        yaSabemos: (ctx) => {
          const kpi = ctx.politica.kpis.find((k) => k.rol === 'PRIMARY');
          return kpi?.targetValue !== null && kpi?.targetValue !== undefined ? { valor: kpi.targetValue, procedencia: 'USER' } : null;
        },
      },
      {
        id: 'medicion.evidencia',
        etiqueta: '¿Cuántos datos esperamos antes de sacar conclusiones?',
        ayuda: 'Sirve para no decidir con cuatro visitas. Si no lo sabes, usa el punto de partida prudente.',
        tipo: 'OPCION',
        opciones: () => [
          { valor: 'prudente', etiqueta: 'Usa un punto de partida prudente', ayuda: 'Lo fija SOEC y podrás cambiarlo cuando quieras.' },
          { valor: 'propio', etiqueta: 'Yo defino cuántos' },
        ],
        requerida: true,
        yaSabemos: (ctx) => {
          const regla = ctx.politica.reglas.find((r) => r.tipo === 'EVIDENCE_MINIMUM' && r.estado === 'CONFIGURED');
          if (!regla) return null;
          return { valor: regla.procedencia === 'SYSTEM_DEFAULT' ? 'prudente' : 'propio', procedencia: 'USER' };
        },
      },
      {
        id: 'medicion.evidenciaValor',
        etiqueta: '¿Cuántas veces debe mostrarse tu anuncio antes de concluir algo?',
        tipo: 'NUMERO',
        aplica: (ctx) => textoDe(ctx, 'medicion.evidencia') === 'propio',
      },
    ],
  },
  {
    id: 'conexiones',
    titulo: 'De dónde salen los datos',
    descripcion: 'Conectar tus cuentas permite a SOEC ver lo que realmente pasa.',
    preguntas: [
      {
        id: 'conexiones.usaGoogleAds',
        etiqueta: '¿Haces publicidad en Google?',
        tipo: 'SI_NO',
        requerida: true,
        // Si ya está conectado, no se pregunta: se muestra conectado (regla 3).
        yaSabemos: (ctx) => (conexionDe(ctx, 'GOOGLE_ADS')?.estado === 'CONNECTED' ? { valor: true, procedencia: 'CONNECTOR' } : null),
      },
      {
        id: 'conexiones.usaMeta',
        etiqueta: '¿Haces publicidad en Facebook o Instagram?',
        tipo: 'SI_NO',
        requerida: true,
        yaSabemos: (ctx) => (conexionDe(ctx, 'META_ADS')?.estado === 'CONNECTED' ? { valor: true, procedencia: 'CONNECTOR' } : null),
      },
      {
        id: 'conexiones.sistemaPropio',
        etiqueta: '¿Tu sitio o sistema puede avisarnos cuando alguien te contacta?',
        ayuda: 'Es una integración técnica. Si no lo sabes, responde que no: se puede añadir después.',
        tipo: 'SI_NO',
        aplica: puedeTenerSistemaPropio,
        yaSabemos: (ctx) => (conexionDe(ctx, 'GROWTH_M2M')?.estado === 'CONNECTED' ? { valor: true, procedencia: 'CONNECTOR' } : null),
      },
    ],
  },
  {
    id: 'presupuesto',
    titulo: 'Cuánto estás dispuesto a invertir',
    descripcion: 'Un techo, no un compromiso: guardar un máximo no activa ninguna campaña ni gasta nada.',
    preguntas: [
      {
        id: 'presupuesto.modalidad',
        etiqueta: '¿Cuánto como máximo estarías dispuesto a invertir en publicidad?',
        tipo: 'OPCION',
        opciones: () => [
          { valor: 'NONE', etiqueta: 'Todavía no quiero invertir' },
          { valor: 'DAILY', etiqueta: 'Un máximo por día' },
          { valor: 'MONTHLY', etiqueta: 'Un máximo por mes' },
          { valor: 'LATER', etiqueta: 'Prefiero decidirlo después' },
        ],
        requerida: true,
        yaSabemos: (ctx) => (ctx.presupuesto ? { valor: ctx.presupuesto.modalidad, procedencia: 'USER' } : null),
      },
      {
        id: 'presupuesto.monto',
        etiqueta: '¿De cuánto sería ese máximo?',
        ayuda: 'En pesos. Es un techo que SOEC no puede pasar.',
        tipo: 'NUMERO',
        aplica: (ctx) => ['DAILY', 'MONTHLY'].includes(textoDe(ctx, 'presupuesto.modalidad')),
        yaSabemos: (ctx) => (ctx.presupuesto?.montoClp != null ? { valor: ctx.presupuesto.montoClp, procedencia: 'USER' } : null),
      },
    ],
  },
  {
    id: 'autonomia',
    titulo: 'Cuánto quieres que SOEC decida',
    descripcion: 'Puedes cambiarlo cuando quieras. Empieza por lo más conservador si tienes dudas.',
    preguntas: [
      {
        id: 'autonomia.preferencia',
        etiqueta: '¿Cómo quieres que trabaje SOEC?',
        tipo: 'OPCION',
        opciones: () => [
          { valor: 'SOLO_OBSERVAR', etiqueta: 'Solo observar y avisarme', ayuda: 'No cambia nada por su cuenta.' },
          { valor: 'PEDIR_APROBACION', etiqueta: 'Pedirme aprobación antes de hacer cambios' },
          { valor: 'OPERAR_DENTRO_DE_LIMITES', etiqueta: 'Operar automáticamente dentro de mis límites' },
        ],
        requerida: true,
        yaSabemos: (ctx) => {
          if (ctx.modoOperativo === 'SUPERVISED_REAL') return { valor: 'PEDIR_APROBACION', procedencia: 'DERIVED' };
          if (ctx.modoOperativo === 'AUTONOMOUS_REAL') return { valor: 'OPERAR_DENTRO_DE_LIMITES', procedencia: 'DERIVED' };
          return null; // PILOT es el valor inicial de toda empresa: se pregunta igualmente
        },
      },
    ],
  },
  {
    id: 'resumen',
    titulo: 'Lo que SOEC entendió',
    descripcion: 'Revísalo. Si algo no calza, vuelve atrás y corrígelo.',
    preguntas: [],
  },
];

/** Definiciones de pregunta por id, para validar entradas sin recorrer el catálogo a mano. */
/** Definición cruda de una pregunta por id: hace falta para saber qué VALOR YA SABÍA SOEC antes de responder. */
const DEF_POR_ID: ReadonlyMap<string, DefPregunta> = new Map(
  PASOS.flatMap((p) => p.preguntas.map((q) => [q.id, q] as const)),
);

/**
 * Lo que SOEC ya sabía de esta pregunta ANTES de que nadie la respondiera, derivado de los datos del negocio.
 * `null` si no lo sabía. Es la referencia para distinguir una respuesta de verdad de la devolución de un valor
 * precargado: si coinciden, nadie confirmó nada — sólo pasó por la pantalla.
 */
export function valorSabido(preguntaId: string, ctx: ContextoOnboarding): { readonly valor: unknown; readonly procedencia: ProcedenciaDato } | null {
  const def = DEF_POR_ID.get(preguntaId);
  if (def === undefined) return null;
  if (def.aplica !== undefined && !def.aplica(ctx)) return null;
  return def.yaSabemos?.(ctx) ?? null;
}

export const PREGUNTAS_POR_ID: ReadonlyMap<string, { paso: PasoId; tipo: TipoPregunta }> = new Map(
  PASOS.flatMap((p) => p.preguntas.map((q) => [q.id, { paso: p.id, tipo: q.tipo }] as const)),
);

function vistaDePregunta(q: DefPregunta, ctx: ContextoOnboarding): PreguntaVista {
  const respuesta = ctx.respuestas.get(q.id) ?? null;
  const sabido = respuesta === null ? (q.yaSabemos?.(ctx) ?? null) : null;
  return {
    id: q.id,
    etiqueta: q.etiqueta,
    ayuda: q.ayuda ?? null,
    tipo: q.tipo,
    opciones: q.opciones?.(ctx) ?? [],
    requerida: q.requerida === true,
    valorActual: respuesta !== null ? respuesta.valor : (sabido?.valor ?? null),
    procedencia: respuesta !== null ? respuesta.procedencia : (sabido?.procedencia ?? null),
    confirmacion: respuesta !== null ? respuesta.confirmacion : (sabido !== null ? 'DISCOVERED' : null),
    yaSabemos: sabido !== null,
  };
}

/** Preguntas que aplican a este negocio AHORA (ramas condicionales resueltas). */
function preguntasDelPaso(paso: DefPaso, ctx: ContextoOnboarding): readonly PreguntaVista[] {
  return paso.preguntas.filter((q) => q.aplica?.(ctx) ?? true).map((q) => vistaDePregunta(q, ctx));
}

/** Un paso está COMPLETO cuando todas sus preguntas obligatorias tienen valor (respondido o ya sabido). */
function estadoDelPaso(preguntas: readonly PreguntaVista[]): EstadoPaso {
  const faltan = preguntas.some((q) => q.requerida && (q.valorActual === null || q.valorActual === '' || (Array.isArray(q.valorActual) && q.valorActual.length === 0)));
  return faltan ? 'PENDIENTE' : 'COMPLETO';
}

/** La conversación completa, resuelta contra lo que SOEC ya sabe. Determinista y sin efectos. */
export function construirPasos(ctx: ContextoOnboarding): readonly PasoVista[] {
  return PASOS.map((paso) => {
    const preguntas = preguntasDelPaso(paso, ctx);
    return { id: paso.id, titulo: paso.titulo, descripcion: paso.descripcion, estado: estadoDelPaso(preguntas), preguntas };
  });
}

/** Primer paso sin completar, o `resumen` cuando no queda ninguno. Es el «continuar donde iba». */
export function siguientePaso(pasos: readonly PasoVista[]): PasoId {
  return pasos.find((p) => p.estado === 'PENDIENTE')?.id ?? 'resumen';
}

/** Progreso 0–100 sobre los pasos que de verdad aplican (el resumen no cuenta como trabajo del usuario). */
export function progreso(pasos: readonly PasoVista[]): number {
  const conTrabajo = pasos.filter((p) => p.preguntas.length > 0);
  if (conTrabajo.length === 0) return 100;
  const completos = conTrabajo.filter((p) => p.estado === 'COMPLETO').length;
  return Math.round((completos / conTrabajo.length) * 100);
}

export const ORDEN_DE_PASOS = PASOS_EN_ORDEN;
