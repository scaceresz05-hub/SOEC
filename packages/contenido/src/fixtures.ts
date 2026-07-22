/**
 * Fixtures SINTÉTICOS de la Fábrica de Contenido (F2-CONT-01 §7, §22). Marca,
 * prompts versionados y una estrategia de marketing alineada a los canales que la
 * fábrica sabe adaptar. Datos sintéticos; ningún dato real ni credencial.
 *
 * Diseñada para producir, al preparar contenido de la PyME de servicios:
 *  - blog/linkedin/instagram/correo: bloqueadas por contenido → fábrica → LISTO → autorizable (Caso A/E)
 *  - meta_ads: la generación inicial trae un gancho prohibido; la revisión lo corrige (Caso B)
 *  - facebook: canal NO autorizado → paquete borrador, no se entrega (Caso C)
 */
import type { ContenidoObjetivo } from '@soec/marketing';
import type { ContenidoPolitica } from '@soec/operacional';
import type { ContenidoMarca } from './domain/marca';
import type { ContenidoPrompt } from './domain/prompts';

export const IDS_CONT = {
  marca: 'marca-servipyme',
  promptPieza: 'prompt-pieza-fuente',
  promptAdapt: 'prompt-adaptacion',
} as const;

export const IDS_MKT_CONT = {
  objetivo: 'obj-cont-leads',
  politica: 'pol-cont-marketing',
  plan: 'plan-cont-30d',
} as const;

/** Gancho promocional que el proveedor introduce en anuncios (puede violar la política). */
export const CONT_GANCHOS: Readonly<Record<string, string>> = {
  meta_ads: 'Oferta imperdible',
};

export const marcaDemo: ContenidoMarca = {
  nombre: 'ServiPyme',
  descripcion: 'Servicios de mantención preventiva para edificios',
  proposito: 'que los edificios funcionen sin sobresaltos',
  personalidad: ['confiable', 'cercana', 'técnica'],
  tono: 'cercano y profesional, sin tecnicismos innecesarios',
  vocabularioPreferido: ['mantención preventiva', 'respuesta rápida', 'tranquilidad'],
  expresionesProhibidas: ['barato', 'lo más barato'],
  publico: 'administradores de edificios residenciales',
  propuestaValor: 'mantención confiable con respuesta en 24h',
  diferenciadores: ['respuesta en 24h', 'técnicos certificados'],
  colores: [
    { nombre: 'Azul confianza', hex: '#1F4E79', uso: 'primario' },
    { nombre: 'Verde señal', hex: '#2E7D32', uso: 'acento' },
  ],
  tipografias: [{ nombre: 'Inter', uso: 'títulos y cuerpo' }],
  estiloVisual: 'limpio, con espacio en blanco y foco en el edificio',
  estiloFotografico: 'fotografía real de edificios y técnicos, luz natural',
  estiloIlustracion: 'iconografía lineal simple',
  usoLogotipo: 'esquina inferior derecha, versión monocroma sobre foto',
  mensajesObligatorios: ['Respuesta en 24h'],
  disclaimers: ['Cotización sujeta a evaluación técnica'],
  territorios: ['Chile'],
  idiomas: ['es', 'en'],
};

export const promptPiezaDemo: ContenidoPrompt = {
  proposito: 'redactar la pieza fuente semántica a partir del brief',
  tarea: 'pieza_fuente',
  plantilla:
    'Redacta contenido para {{audiencia}} sobre {{productoServicio}}. Problema: {{problemaCliente}}. Propuesta de valor: {{propuestaValor}}. Mensaje: {{mensajePrincipal}}. Tono: {{tono}}. No inventes datos que no estén en el brief.',
  variables: ['audiencia', 'productoServicio', 'problemaCliente', 'propuestaValor', 'mensajePrincipal', 'tono'],
  restricciones: ['no inventar cifras', 'no prometer resultados garantizados', 'conservar disclaimers'],
  esquemaEsperado: ['tituloInterno', 'tesis', 'mensaje', 'cuerpo', 'llamadaAccion'],
  idioma: 'es',
};

export const promptAdaptDemo: ContenidoPrompt = {
  proposito: 'adaptar la pieza fuente a un canal específico respetando sus límites',
  tarea: 'adaptacion_canal',
  plantilla:
    'Adapta la pieza al canal {{formato}} conservando el mensaje ({{mensaje}}) y las afirmaciones. Respeta el límite del canal. CTA: {{llamadaAccion}}.',
  variables: ['formato', 'mensaje', 'llamadaAccion'],
  restricciones: ['no exceder el límite del canal', 'no introducir afirmaciones nuevas', 'conservar advertencias'],
  esquemaEsperado: ['cuerpo', 'llamadaAccion'],
  idioma: 'es',
};

export const objetivoContenidoDemo: ContenidoObjetivo = {
  empresa: 'Pyme de servicios (demo)',
  marca: 'ServiPyme',
  producto: 'servicio de mantención preventiva',
  propuestaValor: 'mantención confiable con respuesta en 24h',
  mercado: 'administración de edificios',
  territorio: 'Chile',
  idioma: 'es',
  moneda: 'CLP',
  audiencia: 'administradores de edificios',
  segmento: 'edificios residenciales medianos',
  canales: ['blog', 'linkedin', 'instagram', 'correo', 'meta_ads', 'facebook'],
  objetivoComercial: 'aumentar las solicitudes de cotización',
  objetivoMarketing: 'generar leads calificados',
  indicador: 'leads por mes',
  lineaBase: 10,
  valorEsperado: 25,
  horizonteDias: 30,
  prioridad: 'alta',
  restricciones: ['sin promesas de resultados garantizados'],
  presupuestoTotal: 300,
  frecuenciaDias: 30,
};

export const politicaContenidoDemo: ContenidoPolitica = {
  empresa: 'Pyme de servicios (demo)',
  objetivo: 'generar leads dentro de presupuesto y sin afirmaciones prohibidas',
  canalesAutorizados: ['blog', 'linkedin', 'instagram', 'correo', 'meta_ads'], // facebook NO autorizado
  presupuestoTotal: 300,
  presupuestoDiario: 300,
  productosRestringidos: [],
  afirmacionesProhibidas: ['oferta imperdible', 'garantizado', 'resultados garantizados'],
  accionesProhibidas: [],
  accionesRequierenAprobacion: [],
  nivelAutonomia: 3,
  riesgoPorAccion: { publicar_organico: 'bajo', anuncio: 'medio' },
};

/** Todas las campañas nacen sin contenido → bloqueadas por contenido_faltante (la fábrica las resuelve). */
export const optsContenidoDemo = {
  zonaHoraria: 'America/Santiago',
  diasPermitidos: [1, 2, 3, 4, 5],
  canalesSinContenido: ['blog', 'linkedin', 'instagram', 'correo', 'meta_ads', 'facebook'],
} as const;
