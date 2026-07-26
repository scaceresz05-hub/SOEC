/**
 * @soec/rubros · biblioteca del rubro «Clínica Dental» · v1.1
 *
 * Conocimiento de RUBRO (tipo de negocio), no de instancia. Fuente ratificada:
 * `docs/producto/rubros/clinica-dental.md` (Gate G1 v1.0; evolución gobernada v1.1).
 * v1.1 añade la Capa de Producto causal: señales diagnósticas con condición de
 * activación, mapeos versionados señal→objetivo→estrategia, `OBJ-CD-07` (tasa de
 * agendamiento), `EST-CD-05` (optimización de respuesta/agendamiento) y activadores
 * regulatorios tipados por estrategia/regla. Capa regulatoria PRELIMINARY.
 */
import type {
  RubroKnowledge,
  Objetivo,
  Estrategia,
  Metrica,
  RestriccionGeneral,
  Supuesto,
  Regulatorio,
  Senal,
  Mapeo,
  Confianza,
  EstadoMadurez,
  ActivadorRegulatorio,
} from '../domain/tipos';

const DEF = {
  origen: 'Gate G1 v1.0 / evolución gobernada v1.1 — Director (2026-07-22)',
  incorporado: '2026-07-22',
  cambio: 'creación inicial',
} as const;

const V1 = 'v1.0';
const V11 = 'v1.1';

// Preguntas señalizadas (cerradas, sí/no). Su afirmación (valor true) activa una señal.
const Q_POCAS = '¿El cuello de botella es que llegan pocas solicitudes de primera consulta?';
const Q_AGENDA =
  '¿El cuello de botella es que llegan solicitudes pero pocas terminan en cita agendada?';
const Q_NOSHOW = '¿El cuello de botella es un ausentismo alto a las citas (no-show)?';
const Q_RECOMPRA = '¿El cuello de botella es la poca recompra o recurrencia de pacientes?';

function obj(
  id: string,
  objetivo: string,
  metrica: string,
  confianza: Confianza,
  estado: EstadoMadurez = 'RATIFIED',
  apareceEn = V1,
): Objetivo {
  return {
    ...DEF,
    tipo: 'objetivo',
    id,
    objetivo,
    metrica,
    confianza,
    estado,
    apareceEn,
    motivo: 'objetivo típico del rubro',
  };
}
function est(
  id: string,
  estrategia: string,
  atiende: readonly string[],
  confianza: Confianza,
  activadores: readonly ActivadorRegulatorio[] = [],
  apareceEn = V1,
): Estrategia {
  return {
    ...DEF,
    tipo: 'estrategia',
    id,
    estrategia,
    atiende,
    activadores,
    confianza,
    estado: 'RATIFIED',
    apareceEn,
    motivo: 'estrategia recomendada del rubro',
  };
}
function met(id: string, metrica: string, confianza: Confianza): Metrica {
  return {
    ...DEF,
    tipo: 'metrica',
    id,
    metrica,
    confianza,
    estado: 'RATIFIED',
    apareceEn: V1,
    motivo: 'métrica típica del rubro',
  };
}
function res(id: string, restriccion: string): RestriccionGeneral {
  return {
    ...DEF,
    tipo: 'restriccion_general',
    id,
    restriccion,
    confianza: 'HIGH',
    estado: 'RATIFIED',
    apareceEn: V1,
    motivo: 'buena práctica general del rubro',
  };
}
function sup(id: string, supuesto: string, confianza: Confianza): Supuesto {
  return {
    ...DEF,
    tipo: 'supuesto',
    id,
    supuesto,
    confianza,
    estado: 'RATIFIED',
    apareceEn: V1,
    motivo: 'hipótesis general del rubro',
  };
}
function reg(
  id: string,
  regla: string,
  confianza: Confianza,
  observa: readonly ActivadorRegulatorio[],
  efecto: 'ADVIERTE' | 'BLOQUEA',
): Regulatorio {
  return {
    ...DEF,
    tipo: 'regulatorio',
    id,
    regla,
    rigor: 'DURA',
    confianza,
    estado: 'PRELIMINARY',
    verificacion: 'PENDING_LEGAL_REVIEW',
    observa,
    efecto,
    apareceEn: V1,
    motivo:
      'restricción regulatoria/sanitaria, borrador conservador pendiente de validación jurídica',
  };
}
function sig(id: string, nombre: string, preguntaId: string, confianza: Confianza): Senal {
  return {
    ...DEF,
    tipo: 'senal',
    id,
    nombre,
    preguntaId,
    condicionActivacion: { operador: 'IGUAL_A', valor: true },
    confianza,
    estado: 'RATIFIED',
    apareceEn: V11,
    motivo: 'señal diagnóstica del rubro',
  };
}
function map(
  id: string,
  senalId: string,
  objetivoId: string,
  estrategiaId: string,
  porque: string,
  confianza: Confianza,
): Mapeo {
  return {
    ...DEF,
    tipo: 'mapeo',
    id,
    senalId,
    objetivoId,
    estrategiaId,
    porque,
    confianza,
    estado: 'RATIFIED',
    apareceEn: V11,
    motivo: 'mapeo causal del rubro',
  };
}

export const conocimientoClinicaDental: RubroKnowledge = {
  rubroId: 'clinica-dental',
  version: '1.1.0',

  objetivos: [
    obj('OBJ-CD-01', 'Aumentar solicitudes de primera consulta', 'solicitudes/mes', 'HIGH'),
    obj(
      'OBJ-CD-02',
      'Aumentar valoraciones de tratamientos de alto valor (ortodoncia, implantes, estética)',
      'valoraciones agendadas/mes',
      'HIGH',
    ),
    obj('OBJ-CD-03', 'Reducir ausentismo a citas (no-shows)', '% de asistencia', 'MEDIUM'),
    obj(
      'OBJ-CD-04',
      'Reactivar pacientes inactivos (recall/controles)',
      'reactivaciones/mes',
      'MEDIUM',
    ),
    obj('OBJ-CD-05', 'Mejorar la reputación', 'reseñas nuevas/mes y calificación media', 'MEDIUM'),
    // Backlog v2 — DRAFT: no elegible por defecto. Su identidad permanece.
    obj(
      'OBJ-CD-06',
      'Fidelización del paciente (crecer por recurrencia)',
      'recurrencia/paciente',
      'MEDIUM',
      'DRAFT',
    ),
    // v1.1 — conversión solicitud→agenda (distinto de tratamientos de alto valor).
    obj(
      'OBJ-CD-07',
      'Aumentar la tasa de agendamiento de solicitudes',
      'porcentaje de solicitudes que terminan en cita agendada',
      'HIGH',
      'RATIFIED',
      V11,
    ),
  ],

  estrategias: [
    est(
      'EST-CD-01',
      'Captación local orgánica (perfil de negocio, reseñas, contenido educativo)',
      ['OBJ-CD-01', 'OBJ-CD-05'],
      'HIGH',
    ),
    est(
      'EST-CD-02',
      'Contenido educativo de confianza (tratamientos, cuidados, dudas frecuentes)',
      ['OBJ-CD-01', 'OBJ-CD-02'],
      'HIGH',
    ),
    est(
      'EST-CD-03',
      'Recordatorios y recall a la base de pacientes con consentimiento',
      ['OBJ-CD-03', 'OBJ-CD-04'],
      'MEDIUM',
      ['CONTACTA_BASE_EXISTENTE', 'USA_DATOS_DE_PACIENTES'],
    ),
    est(
      'EST-CD-04',
      'Campañas de valoración para tratamientos de alto valor',
      ['OBJ-CD-02'],
      'MEDIUM',
    ),
    // v1.1 — optimización de respuesta y agendamiento (conversión solicitud→agenda).
    est(
      'EST-CD-05',
      'Optimización de respuesta y agendamiento: seguimiento oportuno, reducción de fricción, claridad del siguiente paso y revisión del proceso de contacto',
      ['OBJ-CD-07'],
      'MEDIUM',
      ['USA_DATOS_DE_PACIENTES'],
      V11,
    ),
  ],

  metricas: [
    met('MET-CD-01', 'solicitudes/mes', 'HIGH'),
    met('MET-CD-02', 'coste por solicitud', 'MEDIUM'),
    met('MET-CD-03', 'tasa de agendamiento', 'MEDIUM'),
    met('MET-CD-04', '% de asistencia', 'MEDIUM'),
    met('MET-CD-05', 'valor medio por tratamiento', 'MEDIUM'),
    met('MET-CD-06', 'reseñas/mes', 'MEDIUM'),
  ],

  embudos: [
    {
      ...DEF,
      tipo: 'embudo',
      id: 'EMB-CD-01',
      etapas: [
        'descubrimiento',
        'interés (contenido)',
        'solicitud',
        'valoración agendada',
        'tratamiento',
        'seguimiento/recall',
      ],
      confianza: 'HIGH',
      estado: 'RATIFIED',
      apareceEn: V1,
      motivo: 'embudo frecuente del rubro',
    },
  ],

  restriccionesGenerales: [
    res('RES-CD-01', 'No prometer resultados'),
    res('RES-CD-02', 'Lenguaje claro y no alarmista'),
    res('RES-CD-03', 'Foco geográfico local'),
  ],

  supuestos: [
    sup(
      'SUP-CD-01',
      'La mayoría de las clínicas operan localmente (radio geográfico acotado)',
      'MEDIUM',
    ),
    sup(
      'SUP-CD-02',
      'Una parte importante del descubrimiento depende de búsquedas y mapas',
      'MEDIUM',
    ),
    sup('SUP-CD-03', 'El no-show suele ser un problema frecuente', 'MEDIUM'),
    sup(
      'SUP-CD-04',
      'Los tratamientos de alto valor requieren más confianza y un ciclo de decisión más largo',
      'MEDIUM',
    ),
  ],

  regulatorio: [
    reg(
      'REG-CD-01',
      'Prohibido usar datos de pacientes en marketing sin consentimiento explícito (datos de salud = categoría especial)',
      'HIGH',
      ['USA_DATOS_DE_PACIENTES', 'CONTACTA_BASE_EXISTENTE'],
      'ADVIERTE',
    ),
    reg(
      'REG-CD-02',
      'Prohibido prometer o garantizar resultados clínicos',
      'HIGH',
      ['AFIRMA_RESULTADO_CLINICO'],
      'BLOQUEA',
    ),
    reg(
      'REG-CD-03',
      'Prohibidas comparaciones no demostrables o afirmaciones de superioridad sin evidencia',
      'HIGH',
      ['AFIRMA_RESULTADO_CLINICO'],
      'ADVIERTE',
    ),
    reg(
      'REG-CD-04',
      'Cumplir las normas de publicidad de servicios de salud y de profesionales (varía por jurisdicción)',
      'LOW',
      [],
      'ADVIERTE',
    ),
    reg(
      'REG-CD-05',
      'Prohibido usar imágenes de pacientes o «antes/después» sin consentimiento y sin cumplir la norma local',
      'MEDIUM',
      ['USA_IMAGEN_DE_PACIENTE', 'USA_ANTES_DESPUES'],
      'BLOQUEA',
    ),
  ],

  producto: [
    {
      ...DEF,
      tipo: 'producto',
      id: 'PRD-CD-01',
      clave: 'preguntas_diagnosticas',
      preguntas: [
        '¿Qué tratamientos ofrece?',
        '¿Cuál es su ticket o sus tratamientos de alto valor?',
        '¿Cuál es su capacidad de agenda?',
        '¿De dónde vienen hoy sus pacientes?',
        Q_POCAS,
        Q_AGENDA,
        Q_NOSHOW,
        Q_RECOMPRA,
      ],
      confianza: 'HIGH',
      estado: 'RATIFIED',
      apareceEn: V1,
      motivo: 'guía de diagnóstico del rubro (v1.1: preguntas señalizadas)',
    },
    {
      ...DEF,
      tipo: 'producto',
      id: 'PRD-CD-02',
      clave: 'construccion_hipotesis',
      texto:
        'Cada señal diagnóstica ACTIVA habilita, por su mapeo versionado, un objetivo candidato; la ausencia o contradicción no activa señal. Los candidatos son hipótesis con evidencia, nunca certezas.',
      confianza: 'HIGH',
      estado: 'RATIFIED',
      apareceEn: V1,
      motivo: 'cómo SOEC construye hipótesis en el rubro',
    },
    {
      ...DEF,
      tipo: 'producto',
      id: 'PRD-CD-03',
      clave: 'priorizacion',
      texto:
        'Priorizar por evaluabilidad, reversibilidad/riesgo, señal activa y cumplimiento regulatorio (una estrategia que active una regla se advierte o se bloquea; nunca se afirma cumplimiento).',
      confianza: 'HIGH',
      estado: 'RATIFIED',
      apareceEn: V1,
      motivo: 'cómo SOEC prioriza estrategias en el rubro',
    },
    {
      ...DEF,
      tipo: 'producto',
      id: 'PRD-CD-04',
      clave: 'plantilla_explicacion',
      texto:
        'Propongo [objetivo] porque detecté [señal activa X] y observé [Y, patrón del rubro]; para medirlo necesitaré [Z]; todavía me falta [W].',
      confianza: 'HIGH',
      estado: 'RATIFIED',
      apareceEn: V1,
      motivo: 'plantilla de explicación evaluable del rubro',
    },
  ],

  senales: [
    sig('SIG-CD-01', 'POCAS_SOLICITUDES', Q_POCAS, 'HIGH'),
    sig('SIG-CD-02', 'BAJA_TASA_AGENDAMIENTO', Q_AGENDA, 'HIGH'),
    sig('SIG-CD-03', 'ALTO_NO_SHOW', Q_NOSHOW, 'HIGH'),
    sig('SIG-CD-04', 'POCA_RECOMPRA', Q_RECOMPRA, 'MEDIUM'),
  ],

  mapeos: [
    map(
      'MAP-CD-01',
      'SIG-CD-01',
      'OBJ-CD-01',
      'EST-CD-01',
      'pocas solicitudes → captación',
      'HIGH',
    ),
    map(
      'MAP-CD-02',
      'SIG-CD-02',
      'OBJ-CD-07',
      'EST-CD-05',
      'baja conversión solicitud→agenda → optimizar agendamiento',
      'HIGH',
    ),
    map(
      'MAP-CD-03',
      'SIG-CD-03',
      'OBJ-CD-03',
      'EST-CD-03',
      'no-show → recordatorios/asistencia',
      'HIGH',
    ),
    map(
      'MAP-CD-04',
      'SIG-CD-04',
      'OBJ-CD-04',
      'EST-CD-03',
      'poca recompra → reactivación',
      'MEDIUM',
    ),
  ],
};
