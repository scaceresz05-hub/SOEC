/**
 * Decisión del PRIMER PILOTO REAL — SmileFlow Clinic (F2-PILOT-DEC-01).
 *
 * Registra la configuración ESTRATÉGICA APROBADA por el propietario (2026-07-21) como un
 * expediente en modo `real_preparado`. NO es una organización sintética de demostración:
 * es la decisión del primer piloto real, en PREPARACIÓN. Aun así, ningún efecto real
 * ocurre aquí: la publicación permanece BLOQUEADA hasta que el propietario provea y
 * verifique credenciales reales y otorgue una autorización de publicación explícita.
 *
 * Campos que el propietario debe confirmar/proveer (marcados como pendientes): identidad
 * legal, país/moneda si difieren, cuenta real de LinkedIn y su credencial verificada.
 */
import type { ConexionPrevista, IdentidadOrganizacion, PerfilOperacional, PresupuestoPiloto, EtapaOnboarding } from './domain/organizacion';
import type { CriterioExito, CriterioSuspension, PasoRollback } from './domain/expediente';

export const IDS_SMILEFLOW = { org: 'smileflow-clinic', expediente: 'exp-smileflow-piloto-1' } as const;

/** Identidad declarada de la decisión. País/moneda son ASUNCIONES a confirmar (marcadas en el dossier). */
export const identidadSmileFlow: IdentidadOrganizacion = {
  nombreComercial: 'SmileFlow Clinic',
  nombreLegal: '(pendiente de declaración por el propietario)',
  identificadorTributario: null,
  pais: 'Chile',
  territorio: '(por confirmar)',
  zonaHoraria: 'America/Santiago',
  idioma: 'es',
  moneda: 'CLP',
  sector: 'software para administración de clínicas',
  tamano: 'pequeña',
  responsables: [{ nombre: 'Propietario', rol: 'propietario', contacto: '(por confirmar)' }],
  claseDatos: 'pendiente', // decisión real en preparación; datos operativos aún pendientes
};

/** Perfil aprobado: marketing, LinkedIn orgánico, nivel 2, sin publicación automática. Modo real_preparado. */
export const perfilSmileFlow: PerfilOperacional = {
  departamentoPiloto: 'marketing',
  capacidades: ['comprender_estado', 'producir_contenido', 'preparar_publicacion', 'medir', 'proponer_optimizacion'],
  actividadesPermitidas: ['publicar_organico'],
  actividadesProhibidas: ['anuncio', 'responder_publico', 'aumentar_frecuencia_auto'],
  canales: ['linkedin'],
  modo: 'real_preparado', // preparado, NO habilitado; la publicación real permanece bloqueada
  nivelAutonomia: 2, // preparación autónoma CON aprobación previa por publicación
  ventanaOperacional: 'L-V 09:00-18:00 (por confirmar)',
  volumenMaximo: 4,
  frecuenciaMaxima: 2, // máximo 2 publicaciones semanales
  duracionDias: 14,
};

/** Presupuesto: SIN gasto publicitario ($0). ejecutadoReal del tipo literal 0. */
export const presupuestoSmileFlow: PresupuestoPiloto = {
  moneda: 'CLP',
  produccion: 0,
  distribucion: 0,
  publicidad: 0, // $0 de publicidad pagada
  integracion: 0,
  contingencia: 0,
  limiteTotal: 0,
  limiteDiario: 0,
  comprometido: 0,
  reservado: 0,
  ejecutadoSintetico: 0,
  ejecutadoReal: 0,
};

/** Conexión LinkedIn: declarada pero SIN credencial real. En modo real → readiness BLOQUEADA. */
export const conexionLinkedinPendiente: ConexionPrevista = {
  proveedor: 'linkedin',
  canal: 'linkedin',
  cuentaLogica: 'smileflow-empresarial',
  entorno: 'real_preparado',
  credencialRef: null, // el propietario debe proveer y verificar una credencial real
  capacidades: ['publicaTexto'],
  permisosRequeridos: ['w_organization_social', 'r_organization_social'],
  permisosConcedidos: [],
  estado: 'pendiente_credencial',
};

export const criteriosExitoSmileFlow: CriterioExito[] = [
  { indicador: 'solicitudes_demo_identificables', lineaBase: 0, meta: 1, minimoEvidencia: 4, ventana: '14d', tolerancia: 0, peso: 1 },
  { indicador: 'publicaciones_aprobadas_verificadas', lineaBase: 0, meta: 4, minimoEvidencia: 4, ventana: '14d', tolerancia: 0, peso: 1 },
];
export const criteriosSuspensionSmileFlow: CriterioSuspension[] = [
  { codigo: 'publicacion_duplicada', severidad: 'critico', accion: 'pausar', reversible: false, descripcion: 'una publicación se emitió dos veces' },
  { codigo: 'publicado_sin_aprobacion', severidad: 'critico', accion: 'retirar', reversible: true, descripcion: 'se publicó sin aprobación humana' },
  { codigo: 'datos_personales_expuestos', severidad: 'critico', accion: 'retirar', reversible: false, descripcion: 'exposición de datos de pacientes' },
  { codigo: 'afirmacion_clinica_no_sustentada', severidad: 'critico', accion: 'retirar', reversible: true, descripcion: 'promesa o comparación clínica no demostrable' },
  { codigo: 'cuenta_equivocada', severidad: 'critico', accion: 'retirar', reversible: false, descripcion: 'publicación en una cuenta incorrecta' },
  { codigo: 'imposible_retirar', severidad: 'critico', accion: 'requiere_aprobacion', reversible: false, descripcion: 'no se puede retirar una publicación incorrecta' },
  { codigo: 'perdida_trazabilidad', severidad: 'mayor', accion: 'pausar', reversible: true, descripcion: 'pérdida de trazabilidad' },
  { codigo: 'credencial_comprometida', severidad: 'critico', accion: 'pausar', reversible: true, descripcion: 'credencial comprometida' },
  { codigo: 'autonomia_no_autorizada', severidad: 'mayor', accion: 'pausar', reversible: true, descripcion: 'SOEC intenta aumentar autonomía/frecuencia sin permiso' },
];
export const rollbackSmileFlow: PasoRollback[] = [
  { orden: 1, accion: 'pausar el departamento de marketing', reversible: true, responsable: 'propietario' },
  { orden: 2, accion: 'retirar la publicación de LinkedIn donde el canal lo permita', reversible: true, responsable: 'operador_tecnico' },
  { orden: 3, accion: 'restaurar la versión anterior del plan y de la política', reversible: true, responsable: 'operador_tecnico' },
  { orden: 4, accion: 'revocar la credencial por referencia', reversible: true, responsable: 'propietario' },
  { orden: 5, accion: 'conservar métricas y auditoría', reversible: true, responsable: 'operador_tecnico' },
];

/** Prohibiciones de contenido (requisito duro): sin datos de pacientes, promesas clínicas ni comparaciones no demostrables. */
export const PROHIBICIONES_SMILEFLOW = ['datos de pacientes', 'promesas clínicas', 'comparaciones no demostrables', 'garantizado', 'oferta imperdible'];

/** Onboarding de la decisión: etapas ESTRATÉGICAS completas; las OPERATIVAS quedan pendientes (bloquean el real). */
export const DATOS_ETAPAS_SMILEFLOW: Readonly<Partial<Record<EtapaOnboarding, { estado: 'completa' | 'incompleta'; datos: Record<string, string>; faltantes: string[] }>>> = {
  identidad: { estado: 'incompleta', datos: { nombre: 'SmileFlow Clinic' }, faltantes: ['identidad legal', 'país/moneda a confirmar'] },
  responsables: { estado: 'completa', datos: { propietario: 'Propietario' }, faltantes: [] },
  contexto: { estado: 'completa', datos: { producto: 'software para clínicas' }, faltantes: [] },
  marca: { estado: 'completa', datos: { marca: 'SmileFlow', tono: 'educativo y profesional' }, faltantes: [] },
  objetivos: { estado: 'completa', datos: { objetivo: 'solicitudes calificadas de demostración', indicador: 'solicitudes_demo_identificables' }, faltantes: [] },
  audiencia: { estado: 'completa', datos: { audiencia: 'administradores de clínicas' }, faltantes: [] },
  canales: { estado: 'completa', datos: { canal: 'linkedin' }, faltantes: [] },
  presupuesto: { estado: 'completa', datos: { publicidad: '0' }, faltantes: [] },
  politicas: { estado: 'completa', datos: { autonomia: '2', aprobacion: 'por publicación' }, faltantes: [] },
  autonomia: { estado: 'completa', datos: { nivel: '2' }, faltantes: [] },
  horarios: { estado: 'completa', datos: { ventana: 'L-V 09:00-18:00 (por confirmar)' }, faltantes: [] },
  aprobaciones: { estado: 'completa', datos: { publicacion: 'aprobación humana obligatoria' }, faltantes: [] },
  pausa: { estado: 'completa', datos: { responsables: 'propietario, supervisor' }, faltantes: [] },
  medicion: { estado: 'completa', datos: { indicador: 'solicitudes_demo_identificables', lineaBase: '0', meta: '1' }, faltantes: [] },
  exito: { estado: 'completa', datos: { criterio: '4 piezas válidas, aprobación por publicación, atribución honesta' }, faltantes: [] },
  suspension: { estado: 'completa', datos: { criterio: 'duplicado / sin aprobación / datos personales / afirmación no sustentada' }, faltantes: [] },
  revision: { estado: 'incompleta', datos: {}, faltantes: ['cuenta LinkedIn real y credencial verificada por el propietario'] },
};
