/**
 * Fixtures SINTÉTICOS de preparación de piloto (F2-PILOT-01). Organización, perfil,
 * presupuesto, conexión (fixture de sandbox), y datos de onboarding para demostrar el
 * recorrido. NINGÚN dato real, credencial real ni gasto real.
 */
import type { ConexionPrevista, IdentidadOrganizacion, PerfilOperacional, PresupuestoPiloto, EtapaOnboarding } from './domain/organizacion';
import type { CriterioExito, CriterioSuspension, PasoRollback } from './domain/expediente';

export const IDS_PILOTO = { org: 'org-pyme-piloto', expediente: 'exp-pyme-piloto' } as const;

export const identidadDemo: IdentidadOrganizacion = {
  nombreComercial: 'Pyme de servicios (demo)',
  nombreLegal: 'Pyme de Servicios SpA (sintético)',
  identificadorTributario: null,
  pais: 'Chile',
  territorio: 'Región Metropolitana',
  zonaHoraria: 'America/Santiago',
  idioma: 'es',
  moneda: 'CLP',
  sector: 'servicios',
  tamano: 'pequeña',
  responsables: [{ nombre: 'Propietario (demo)', rol: 'propietario', contacto: 'demo@sintetico.local' }],
  claseDatos: 'sintetico',
};

export const perfilDemo: PerfilOperacional = {
  departamentoPiloto: 'marketing',
  capacidades: ['comprender_estado', 'producir_contenido', 'publicar', 'medir', 'optimizar'],
  actividadesPermitidas: ['publicar_organico'],
  actividadesProhibidas: ['anuncio'],
  canales: ['blog', 'linkedin', 'correo'],
  modo: 'sandbox',
  nivelAutonomia: 3,
  ventanaOperacional: 'L-V 09:00-18:00',
  volumenMaximo: 30,
  frecuenciaMaxima: 3,
  duracionDias: 14,
};

export const presupuestoDemo: PresupuestoPiloto = {
  moneda: 'CLP',
  produccion: 30,
  distribucion: 0,
  publicidad: 0,
  integracion: 0,
  contingencia: 20,
  limiteTotal: 300,
  limiteDiario: 50,
  comprometido: 0,
  reservado: 0,
  ejecutadoSintetico: 0,
  ejecutadoReal: 0,
};

export const conexionDemoSandbox: ConexionPrevista = {
  proveedor: 'emulado',
  canal: 'blog',
  cuentaLogica: 'cuenta-demo',
  entorno: 'sandbox',
  credencialRef: 'cred-demo', // referencia fixture (válida para sandbox, no para real)
  capacidades: ['publicaTexto'],
  permisosRequeridos: ['publish'],
  permisosConcedidos: ['publish'],
  estado: 'verificada_sandbox',
};

export const criteriosExitoDemo: CriterioExito[] = [{ indicador: 'tasa_conversion', lineaBase: 0.02, meta: 0.05, minimoEvidencia: 500, ventana: '14d', tolerancia: 0.2, peso: 1 }];
export const criteriosSuspensionDemo: CriterioSuspension[] = [
  { codigo: 'gasto_superior_autorizado', severidad: 'critico', accion: 'pausar', reversible: true, descripcion: 'gasto por encima del límite' },
  { codigo: 'afirmacion_prohibida', severidad: 'critico', accion: 'retirar', reversible: true, descripcion: 'contenido con afirmación prohibida' },
  { codigo: 'credencial_invalida', severidad: 'mayor', accion: 'pausar', reversible: true, descripcion: 'error de credencial' },
];
export const rollbackDemo: PasoRollback[] = [
  { orden: 1, accion: 'pausar el departamento', reversible: true, responsable: 'propietario' },
  { orden: 2, accion: 'retirar publicaciones donde el canal lo permita', reversible: true, responsable: 'operador_tecnico' },
  { orden: 3, accion: 'restaurar la versión anterior del plan y de la política', reversible: true, responsable: 'operador_tecnico' },
  { orden: 4, accion: 'conservar métricas y auditoría', reversible: true, responsable: 'operador_tecnico' },
];

/** Datos de onboarding para completar todas las etapas del piloto sintético. */
export const DATOS_ETAPAS: Readonly<Record<EtapaOnboarding, Record<string, string>>> = {
  identidad: { nombre: identidadDemo.nombreComercial },
  responsables: { propietario: 'Propietario (demo)' },
  contexto: { sector: 'servicios' },
  marca: { marca: 'ServiPyme', tono: 'cercano y profesional' },
  objetivos: { objetivo: 'generar leads calificados', indicador: 'tasa_conversion' },
  audiencia: { audiencia: 'administradores de edificios' },
  canales: { canales: 'blog, linkedin, correo' },
  presupuesto: { total: '300 CLP' },
  politicas: { autonomia: '3' },
  autonomia: { nivel: '3' },
  horarios: { ventana: 'L-V 09:00-18:00' },
  aprobaciones: { escalamiento: 'requiere aprobación' },
  pausa: { mecanismo: 'interruptor maestro' },
  medicion: { fuente: 'proveedor emulado', lineaBase: '0.02', meta: '0.05' },
  exito: { criterio: 'tasa_conversion ≥ 0.05 con evidencia' },
  suspension: { criterio: 'gasto anómalo / afirmación prohibida' },
  revision: { revisado: 'sí' },
};
