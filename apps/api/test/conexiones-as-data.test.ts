/**
 * Autonomy Fase B · CONEXIONES COMO DATO — pruebas deterministas (sin base, sin red).
 *
 * Lo que se demuestra aquí:
 *  1. la configuración de una conexión se valida y su allowlist de hosts se DERIVA (nunca queda abierta);
 *  2. la proyección convierte filas en la configuración que el runtime ya entendía, y una empresa NUEVA no
 *     toma ni un campo del módulo TypeScript histórico;
 *  3. las capacidades persistidas MANDAN: apagarlas apaga la experiencia, aunque el módulo la declarara;
 *  4. el binding responde con la verdad operativa (capacidad, conexión o perfil) y nunca con «no registrada»;
 *  5. ninguna proyección expone el VALOR de una credencial.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  CapacidadNoHabilitadaError,
  ConexionRequeridaError,
  OrganizacionNoRegistradaError,
  PerfilIncompletoError,
  bindExperienciaReal,
  buscarFuenteGrowth,
  configuracionHistorica,
  estadoDeCompatibilidadLegado,
  fijarNegociosDelRuntime,
  getBusiness,
  getRecursoGoogleAds,
  restablecerNegociosDelRuntime,
  type ConfiguracionOrganizacion,
} from '../src/plataforma';
import {
  ConexionInvalidaError,
  normalizarConfigGoogleAds,
  normalizarConfigGrowth,
} from '../src/conexion/conexion-tipos';
import {
  experienciasDeCapacidades,
  fuenteDeConexion,
  proyectarNegocio,
  recursoGoogleAdsDe,
  type DatosDeNegocio,
} from '../src/conexion/proyeccion';
import { estadoDeConexionDesdeFuente, proveedorDeFuente } from '../src/conexion/migracion-conexiones';
import type { Conexion, CapacidadPersistida } from '../src/conexion/conexion-pg';
import type { PerfilNegocio } from '../src/negocio/negocio-pg';

const ORG_NUEVA = 'clinica-nueva-a1b2c3';
const TOKEN = 'token-super-secreto-que-no-debe-aparecer';

afterEach(() => {
  restablecerNegociosDelRuntime();
});

const perfilNuevo = (over: Partial<PerfilNegocio> = {}): PerfilNegocio => ({
  organizationId: ORG_NUEVA,
  businessKey: 'bk-nueva',
  displayName: 'Clínica Nueva',
  legalName: null,
  businessType: 'CLINICA',
  description: 'clínica dental',
  website: 'https://clinica-nueva.example/',
  country: 'CL',
  currency: 'CLP',
  timezone: 'America/Santiago',
  language: 'es',
  customerType: 'B2C',
  primaryObjective: 'más pacientes nuevos',
  status: 'ACTIVE',
  origen: 'UI',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

const conexionGrowth = (org = ORG_NUEVA, secretRef: string | null = `secretstore:${org}/clinica-nueva-growth-token`): Conexion => ({
  organizationId: org,
  provider: 'GROWTH_M2M',
  id: 'cx-1',
  tipo: 'GROWTH',
  estado: secretRef === null ? 'NOT_CONNECTED' : 'CONNECTED',
  externalAccountId: null,
  externalAccountName: null,
  loginAccountId: null,
  configuracion: {
    provider: 'clinica-nueva-growth',
    baseUrl: 'https://clinica-nueva.example',
    hostsAutorizados: ['clinica-nueva.example'],
    rutaIngesta: '/integrations/soec/growth-events',
    nombreLogicoCredencial: 'clinica-nueva-growth-token',
    baseUrlEnvOverride: null,
    sourceId: 'src-clinica-nueva-growth',
  },
  secretRef,
  ultimoError: null,
  validadaEn: null,
  origen: 'UI',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
});

const cap = (capacidad: CapacidadPersistida['capacidad'], habilitada: boolean, org = ORG_NUEVA): CapacidadPersistida => ({
  organizationId: org,
  capacidad,
  habilitada,
  origen: 'UI',
  nota: null,
  actor: 'qa',
  updatedAt: '2026-09-21T00:00:00.000Z',
});

const datos = (over: Partial<DatosDeNegocio> = {}): DatosDeNegocio => ({
  perfil: perfilNuevo(),
  gobierno: null,
  territorios: [],
  categorias: ['Odontología general'],
  pendientes: [],
  conexiones: [],
  capacidades: [],
  ...over,
});

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('qa'),
    scope: { organizationId: o, permissions: ['events:read'] },
    correlationId: 'qa',
  };
}

/** Fija el runtime con lo proyectado, tal como lo hace el arranque. */
function fijar(...entradas: Array<{ config: ConfiguracionOrganizacion; origen: 'PERSISTIDA' | 'PERSISTIDA_CON_REGISTRO' | 'REGISTRO'; camposDelRegistro: readonly string[] }>): void {
  fijarNegociosDelRuntime(entradas, '2026-09-21T00:00:00.000Z');
}

describe('1 · configuración de conexión: se valida y la allowlist se deriva', () => {
  it('el endpoint debe ser https con dominio, y la allowlist incluye su host sin comodines', () => {
    const cfg = normalizarConfigGrowth({ baseUrl: 'https://mi-sitio.cl/', provider: 'mi-sitio-growth' });
    expect(cfg.hostsAutorizados).toEqual(['mi-sitio.cl']);
    expect(cfg.baseUrl).toBe('https://mi-sitio.cl');
    expect(cfg.rutaIngesta).toBe('/integrations/soec/growth-events');
    expect(cfg.nombreLogicoCredencial).toBe('mi-sitio-growth-token');
    expect(() => normalizarConfigGrowth({ baseUrl: 'http://mi-sitio.cl', provider: 'x-growth' })).toThrow(ConexionInvalidaError);
    expect(() => normalizarConfigGrowth({ baseUrl: 'https://localhost', provider: 'x-growth' })).toThrow(ConexionInvalidaError);
    expect(() => normalizarConfigGrowth({ baseUrl: 'https://a.cl', provider: 'x-growth', hostsAutorizados: ['*.cl'] })).toThrow(ConexionInvalidaError);
    expect(() => normalizarConfigGrowth({ baseUrl: 'https://a.cl', provider: 'MAYÚSCULAS' })).toThrow(ConexionInvalidaError);
    expect(() => normalizarConfigGrowth({ baseUrl: 'https://a.cl', provider: 'x-growth', rutaIngesta: 'sin-barra' })).toThrow(ConexionInvalidaError);
  });

  it('una cuenta de Google Ads exige identificadores numéricos', () => {
    const cfg = normalizarConfigGoogleAds({ customerId: '860-553-9300', campaignId: '24194332264', campaniaRef: 'c1', actividadId: 'a1', nombreCampania: 'Campaña' });
    expect(cfg.customerId).toBe('8605539300');
    expect(cfg.loginCustomerId).toBe('8605539300'); // sin login explícito, la propia cuenta
    expect(() => normalizarConfigGoogleAds({ customerId: 'mi-cuenta', campaignId: '1', campaniaRef: 'c', actividadId: 'a', nombreCampania: 'n' })).toThrow(ConexionInvalidaError);
  });
});

describe('2 · proyección: una empresa nueva se configura ENTERA desde datos', () => {
  it('sin módulo histórico, la configuración no toma ningún campo del registro', () => {
    const r = proyectarNegocio(datos({ conexiones: [conexionGrowth()], capacidades: [cap('INGESTA_GROWTH', true)] }));
    expect(r.detalle.origen).toBe('PERSISTIDA');
    expect(r.detalle.camposDelRegistro).toEqual([]);
    expect(r.config.negocio.organizationId).toBe(ORG_NUEVA);
    expect(r.config.negocio.displayName).toBe('Clínica Nueva');
    expect(r.config.negocio.modeloDeNegocio).toBe('SERVICIOS');
    // Sin política de evaluación: se dice que falta, no se hereda de nadie.
    expect(r.config.perfil).toBeNull();
    expect(r.config.perfilComercial).toBeNull();
    expect(r.config.fuentes.map((f) => f.provider)).toEqual(['clinica-nueva-growth']);
    expect(r.config.fuentes[0]!.estado).toBe('CONNECTED_READ_ONLY');
  });

  it('la fuente GROWTH proyectada lleva endpoint, ruta y allowlist de la conexión, y la credencial sólo por referencia', () => {
    const f = fuenteDeConexion(conexionGrowth());
    expect(f.growth?.baseUrl).toBe('https://clinica-nueva.example');
    expect(f.growth?.rutaIngesta).toBe('/integrations/soec/growth-events');
    expect(f.growth?.hostsAutorizados).toEqual(['clinica-nueva.example']);
    expect(f.credenciales[0]!.secretRef).toBe(`secretstore:${ORG_NUEVA}/clinica-nueva-growth-token`);
    expect(JSON.stringify(f)).not.toContain(TOKEN);
  });

  it('sin credencial, la fuente pide credencial en lugar de decir que no existe', () => {
    const f = fuenteDeConexion(conexionGrowth(ORG_NUEVA, null));
    // `CREDENTIALS_REQUIRED` dice qué falta; `NOT_CONFIGURED` diría que la fuente no existe, y sí existe.
    expect(f.estado).toBe('CREDENTIALS_REQUIRED');
    expect(f.credenciales).toEqual([]);
    expect(f.faltantes).toContain('credencial de acceso');
  });

  it('el recurso de Google Ads sale de la conexión; incompleta ⇒ null (jamás un recurso inventado)', () => {
    expect(recursoGoogleAdsDe(null)).toBeNull();
    const sinIds: Conexion = { ...conexionGrowth(), provider: 'GOOGLE_ADS', tipo: 'ADS', configuracion: {} };
    expect(recursoGoogleAdsDe(sinIds)).toBeNull();
    const conIds: Conexion = {
      ...sinIds,
      configuracion: { customerId: '8605539300', loginCustomerId: '1742063041', campaignId: '24194332264', campaniaRef: 'c1', actividadId: 'a1', canal: 'GOOGLE_SEARCH', nombreCampania: 'Campaña' },
    };
    expect(recursoGoogleAdsDe(conIds)).toEqual({
      customerId: '8605539300', loginCustomerId: '1742063041', campaignId: '24194332264',
      campaniaRef: 'c1', actividadId: 'a1', canal: 'GOOGLE_SEARCH', nombreCampania: 'Campaña',
    });
  });
});

describe('3 · capacidades: lo persistido manda sobre el módulo histórico', () => {
  it('traduce capacidades a experiencias de forma determinista', () => {
    expect(experienciasDeCapacidades([cap('MEDICION_REAL', true), cap('DIRECTOR_REAL', false)])).toEqual(['medicion-real']);
    expect(experienciasDeCapacidades([])).toEqual([]);
  });

  it('apagar la capacidad apaga la experiencia de una empresa histórica', () => {
    const sf = configuracionHistorica('org-smileflow');
    expect(sf?.negocio.experienciasHabilitadas).toContain('medicion-real');
    const r = proyectarNegocio(datos({
      perfil: perfilNuevo({ organizationId: 'org-smileflow', origen: 'MIGRACION' }),
      capacidades: [cap('MEDICION_REAL', false, 'org-smileflow'), cap('DIRECTOR_REAL', false, 'org-smileflow')],
    }));
    expect(r.detalle.origen).toBe('PERSISTIDA_CON_REGISTRO');
    expect(r.config.negocio.experienciasHabilitadas).toEqual([]);
    // La política de evaluación todavía viene del módulo: se declara, no se esconde.
    expect(r.config.perfil).not.toBeNull();
    expect(r.detalle.camposDelRegistro).toContain('perfilDeEvaluacion');
  });

  it('sin ninguna fila de capacidades, una empresa histórica conserva las suyas y queda contado', () => {
    const r = proyectarNegocio(datos({ perfil: perfilNuevo({ organizationId: 'org-smileflow', origen: 'MIGRACION' }) }));
    expect(r.config.negocio.experienciasHabilitadas.length).toBeGreaterThan(0);
    expect(r.detalle.camposDelRegistro).toContain('experienciasHabilitadas');
  });

  it('apagar la conexión de una empresa migrada la desconecta de verdad (no vuelve a valer el módulo)', () => {
    const apagada: Conexion = { ...conexionGrowth('org-smileflow'), estado: 'DISABLED', secretRef: null, configuracion: { ...conexionGrowth('org-smileflow').configuracion, provider: 'smileflow-growth' } };
    const r = proyectarNegocio(datos({
      perfil: perfilNuevo({ organizationId: 'org-smileflow', origen: 'MIGRACION' }),
      conexiones: [apagada],
    }));
    fijar({ config: r.config, origen: 'PERSISTIDA_CON_REGISTRO', camposDelRegistro: r.detalle.camposDelRegistro });
    // La fuente GROWTH resuelta es la de la conexión apagada: sin credencial, no hay descriptor de ingesta.
    expect(buscarFuenteGrowth('org-smileflow')).toBeNull();
  });

  it('la pausa automática la decide el gobierno persistido, no el módulo', () => {
    const sinGobierno = proyectarNegocio(datos({ perfil: perfilNuevo({ organizationId: 'org-smileflow' }) }));
    expect(sinGobierno.config.negocio.politicaSeguridad?.pausaAutomatica).toBe(false);
    const conGobierno = proyectarNegocio(datos({
      perfil: perfilNuevo({ organizationId: 'org-smileflow' }),
      gobierno: { organizationId: 'org-smileflow', externalMutations: false, autonomousSpend: false, automaticSafetyPause: true, campaignExecution: false, updatedAt: '2026-09-21T00:00:00.000Z' },
    }));
    expect(conGobierno.config.negocio.politicaSeguridad?.pausaAutomatica).toBe(true);
  });
});

describe('4 · binding: la negativa dice la verdad operativa', () => {
  it('capacidad apagada ⇒ 403 CAPABILITY_NOT_ENABLED (no «no registrada»)', () => {
    const r = proyectarNegocio(datos({ conexiones: [conexionGrowth()] }));
    fijar({ config: r.config, origen: 'PERSISTIDA', camposDelRegistro: [] });
    expect(() => getBusiness(ORG_NUEVA)).not.toThrow(); // el negocio EXISTE
    try {
      bindExperienciaReal(ctx(ORG_NUEVA), 'medicion-real');
      throw new Error('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(CapacidadNoHabilitadaError);
      const err = e as CapacidadNoHabilitadaError;
      expect(err.code).toBe('CAPABILITY_NOT_ENABLED');
      expect(err.httpStatus).toBe(403);
      expect(err.capacidad).toBe('MEDICION_REAL');
      expect(err.message).not.toContain('registrada');
    }
  });

  it('capacidad encendida sin la conexión que exige ⇒ 409 CONNECTION_REQUIRED', () => {
    const r = proyectarNegocio(datos({ conexiones: [conexionGrowth()], capacidades: [cap('AUTONOMIA_ADS', true)] }));
    fijar({ config: r.config, origen: 'PERSISTIDA', camposDelRegistro: [] });
    try {
      bindExperienciaReal(ctx(ORG_NUEVA), 'autonomia-ads');
      throw new Error('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ConexionRequeridaError);
      expect((e as ConexionRequeridaError).code).toBe('CONNECTION_REQUIRED');
      expect((e as ConexionRequeridaError).httpStatus).toBe(409);
    }
  });

  it('capacidad y conexión listas pero sin política de evaluación ⇒ 409 PROFILE_INCOMPLETE', () => {
    const r = proyectarNegocio(datos({ conexiones: [conexionGrowth()], capacidades: [cap('MEDICION_REAL', true)] }));
    fijar({ config: r.config, origen: 'PERSISTIDA', camposDelRegistro: [] });
    try {
      bindExperienciaReal(ctx(ORG_NUEVA), 'medicion-real');
      throw new Error('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(PerfilIncompletoError);
      expect((e as PerfilIncompletoError).code).toBe('PROFILE_INCOMPLETE');
      expect((e as PerfilIncompletoError).httpStatus).toBe(409);
    }
  });

  it('una organización que no existe sigue siendo 404, y nunca resuelve la configuración de otra', () => {
    const r = proyectarNegocio(datos({ conexiones: [conexionGrowth()] }));
    fijar({ config: r.config, origen: 'PERSISTIDA', camposDelRegistro: [] });
    expect(() => getBusiness('org-que-no-existe')).toThrow(OrganizacionNoRegistradaError);
    expect(buscarFuenteGrowth('org-que-no-existe')).toBeNull();
    expect(() => getRecursoGoogleAds(ORG_NUEVA)).toThrow(); // sin conexión de Ads no hay cuenta: se lanza
  });

  it('la fuente GROWTH que resuelve el runtime es la de la CONEXIÓN, sin variables de entorno por empresa', () => {
    const r = proyectarNegocio(datos({ conexiones: [conexionGrowth()], capacidades: [cap('INGESTA_GROWTH', true)] }));
    fijar({ config: r.config, origen: 'PERSISTIDA', camposDelRegistro: [] });
    const d = buscarFuenteGrowth(ORG_NUEVA);
    expect(d?.baseUrl).toBe('https://clinica-nueva.example');
    expect(d?.credencialRef.startsWith('secretstore:')).toBe(true);
    expect(d?.baseUrlEnvOverride).toBeNull(); // ninguna variable del despliegue gobierna a esta empresa
  });
});

describe('5 · telemetría de compatibilidad', () => {
  it('cuenta los usos del módulo histórico y deja a la empresa nueva en cero', () => {
    const nueva = proyectarNegocio(datos({ conexiones: [conexionGrowth()] }));
    const historica = proyectarNegocio(datos({ perfil: perfilNuevo({ organizationId: 'org-smileflow', origen: 'MIGRACION' }) }));
    fijar(
      { config: nueva.config, origen: 'PERSISTIDA', camposDelRegistro: [] },
      { config: historica.config, origen: 'PERSISTIDA_CON_REGISTRO', camposDelRegistro: historica.detalle.camposDelRegistro },
    );
    getBusiness(ORG_NUEVA);
    getBusiness(ORG_NUEVA);
    getBusiness('org-smileflow');
    const estado = estadoDeCompatibilidadLegado();
    const n = estado.organizaciones.find((x) => x.org === ORG_NUEVA)!;
    const h = estado.organizaciones.find((x) => x.org === 'org-smileflow')!;
    expect(n.usos).toBe(0);
    expect(n.camposDelRegistro).toEqual([]);
    expect(h.usos).toBe(1);
    expect(h.camposDelRegistro.length).toBeGreaterThan(0);
  });
});

describe('6 · migración: qué es conexión y qué no', () => {
  it('sólo las fuentes conectadas u observadas se convierten en conexión', () => {
    expect(estadoDeConexionDesdeFuente('CONNECTED_READ_ONLY')).toBe('CONNECTED');
    expect(estadoDeConexionDesdeFuente('OBSERVED')).toBe('CONNECTED');
    expect(estadoDeConexionDesdeFuente('NOT_CONFIGURED')).toBeNull();
    expect(estadoDeConexionDesdeFuente('NOT_APPLICABLE')).toBeNull();
    expect(estadoDeConexionDesdeFuente('CONNECTED_UNKNOWN')).toBeNull();
    expect(estadoDeConexionDesdeFuente('CREDENTIALS_REQUIRED')).toBe('NOT_CONNECTED');
  });

  it('el proveedor canónico se deduce del tipo y del proveedor de la fuente', () => {
    const growth = configuracionHistorica('org-cp-odontologia')!.fuentes.find((f) => f.tipo === 'GROWTH')!;
    expect(proveedorDeFuente(growth)).toBe('GROWTH_M2M');
    const ads = configuracionHistorica('org-smileflow')!.fuentes.find((f) => f.provider === 'google-ads')!;
    expect(proveedorDeFuente(ads)).toBe('GOOGLE_ADS');
    const sitio = configuracionHistorica('org-cp-odontologia')!.fuentes.find((f) => f.provider === 'sitio-web')!;
    expect(proveedorDeFuente(sitio)).toBeNull(); // un sitio observado no es una conexión con credencial
  });

  it('CP no tiene pausa automática declarada, así que la migración no puede darle el monitor de seguridad', () => {
    expect(configuracionHistorica('org-cp-odontologia')!.negocio.politicaSeguridad?.pausaAutomatica ?? false).toBe(false);
    expect(configuracionHistorica('org-smileflow')!.negocio.politicaSeguridad?.pausaAutomatica).toBe(true);
    expect(configuracionHistorica('org-cp-odontologia')!.negocio.experienciasHabilitadas).toEqual([]);
  });
});
