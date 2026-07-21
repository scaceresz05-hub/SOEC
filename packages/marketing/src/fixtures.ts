/**
 * Estrategia operativa SINTÉTICA inicial (F2-MKT-01 §9) para una PyME de servicios.
 * FIXTURE de demostración, no taxonomía comercial permanente. Datos sintéticos;
 * ningún dato real ni credencial. Diseñada para producir, al planificar+ejecutar,
 * una acción permitida, una denegada y dos bloqueadas (falta de datos y canal).
 */
import type { ContenidoPolitica } from '@soec/operacional';
import type { ContenidoObjetivo } from './domain/objetivo';
import type { PlanificarOpts } from './domain/planner';

export const IDS_DEMO = {
  objetivo: 'obj-pyme-leads',
  politica: 'pol-pyme-marketing',
  plan: 'plan-pyme-30d',
} as const;

export const objetivoDemo: ContenidoObjetivo = {
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
  canales: ['blog', 'blog_tecnico', 'meta_ads', 'youtube'],
  objetivoComercial: 'aumentar las solicitudes de cotización',
  objetivoMarketing: 'generar leads calificados',
  indicador: 'leads por mes',
  lineaBase: 10,
  valorEsperado: 25,
  horizonteDias: 30,
  prioridad: 'alta',
  restricciones: ['sin promesas de resultados garantizados'],
  presupuestoTotal: 300,
  frecuenciaDias: 7,
};

export const politicaDemo: ContenidoPolitica = {
  empresa: 'Pyme de servicios (demo)',
  objetivo: 'generar leads dentro de presupuesto y sin afirmaciones prohibidas',
  canalesAutorizados: ['blog', 'blog_tecnico', 'meta_ads'], // youtube NO autorizado
  presupuestoTotal: 300,
  presupuestoDiario: 50,
  productosRestringidos: [],
  afirmacionesProhibidas: ['oferta imperdible', 'garantizado'],
  accionesProhibidas: [],
  accionesRequierenAprobacion: [],
  nivelAutonomia: 3,
  riesgoPorAccion: { publicar_organico: 'bajo', anuncio: 'medio' },
};

export const optsDemo: Omit<PlanificarOpts, 'fechaInicio'> = {
  zonaHoraria: 'America/Santiago',
  diasPermitidos: [1, 2, 3, 4, 5],
  canalesSinContenido: ['blog_tecnico'], // autorizado pero sin contenido → bloqueada por falta de datos
  contenidoPorCanal: { meta_ads: 'Anuncio: oferta imperdible de mantención' }, // afirmación prohibida → denegada al ejecutar
};
