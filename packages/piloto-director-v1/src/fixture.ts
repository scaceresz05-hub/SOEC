/**
 * Fixture reproducible del piloto SmileFlow (Bloque J). Datos sintéticos deterministas de una
 * clínica dental que quiere más solicitudes de demostración. Sin reloj ni azar: todos los
 * tiempos son constantes ISO-8601 UTC. `org` se parametriza para probar la separación.
 */
import type { EntradaDecision } from '@soec/decisiones-mkt';
import type { EntradaCampania } from '@soec/campanias';
import type { EntradaContenido } from '@soec/contenido-gobernado';
import type { Attribution } from '@soec/contracts';

export const T0 = '2026-07-30T00:00:00.000Z';
export const AHORA = '2026-07-30T12:00:00.000Z';
export const FUTURO = '2026-12-31T00:00:00.000Z';
export const ORG_SMILEFLOW = 'smileflow';

/** El objetivo estratégico que la decisión sirve (cabeza de la cadena de trazabilidad). */
export const OBJETIVO_ID = 'obj-smileflow-solicitudes';

export const ATRIBUCION: Attribution = {
  source: 'piloto-director-v1',
  purpose: 'validar el ciclo del Director de Marketing Autónomo',
  assumptions: ['datos sintéticos de SmileFlow'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

export function decisionSmileFlow(org = ORG_SMILEFLOW, over: Partial<EntradaDecision> = {}): EntradaDecision {
  return {
    organizacionId: org,
    objetivo: `${OBJETIVO_ID}: generar solicitudes de demostración`,
    contexto: 'clínica dental con holgura de agenda',
    hechos: [{ enunciado: 'pocas solicitudes de demostración', origen: 'DATO_DECLARADO_POR_USUARIO', fuente: 'recepción', evidenciaId: null }],
    fuentes: ['recepción'],
    faltantesObligatorios: [],
    inferencias: [],
    hipotesis: [{ id: 'h1', enunciado: 'la captación local aumentará solicitudes', tipo: 'HIPOTESIS' }],
    alternativas: [
      { id: 'a1', descripcion: 'captación local orgánica', elegida: true, razonDescarte: null },
      { id: 'a2', descripcion: 'anuncios pagados', elegida: false, razonDescarte: 'sin presupuesto aprobado' },
    ],
    justificacion: 'la señal activa es POCAS_SOLICITUDES',
    riesgos: ['estacionalidad'],
    confianza: 'MEDIA',
    criterioExito: '+20% solicitudes/mes',
    criterioFracaso: 'sin cambio a 30 días',
    aprobacionRequerida: true,
    nivelAutonomia: 1,
    aprendizajeQueLaCambio: null,
    ...over,
  };
}

export function campaniaSmileFlow(org = ORG_SMILEFLOW, decisionId = 'd1', over: Partial<EntradaCampania> = {}): EntradaCampania {
  return {
    organizacionId: org,
    decisionId,
    objetivo: 'Generar solicitudes de demostración',
    publico: 'clínicas dentales pyme',
    propuesta: 'agenda sin sobrecarga',
    mensaje: 'Solicita una demostración esta semana',
    canal: 'correo',
    calendario: '2026-08',
    presupuesto: { monto: 100000, moneda: 'CLP' },
    hipotesis: ['la captación local aumentará solicitudes'],
    metricas: ['solicitudes/mes'],
    criterioExito: '+20% solicitudes/mes',
    criterioPausa: 'CPL > umbral',
    ...over,
  };
}

export function contenidoSmileFlow(over: Partial<EntradaContenido> = {}): EntradaContenido {
  return {
    canal: 'correo',
    cuerpo: 'Hola, agenda tu demostración sin sobrecargar tu clínica.',
    marcaId: 'marca-smileflow',
    productoServicio: 'software de agenda dental',
    llamadaAccion: 'Solicita una demostración',
    idioma: 'es',
    ...over,
  };
}
