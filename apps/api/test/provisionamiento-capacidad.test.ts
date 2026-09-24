/**
 * Autonomy Fase I.5 · ¿PUEDE SOEC CREAR LA CUENTA? La inspección, como función pura.
 *
 * El error que estas pruebas existen para impedir es tentador y caro: leer «cero cuentas accesibles» y
 * concluir «entonces la creo yo». No se sigue. Google exige que una cuenta cliente nazca DESDE una cuenta
 * administradora —su identificador viaja en la propia dirección de la llamada—, así que sin ninguna
 * administradora accesible no hay operación que intentar. Cero cuentas es exactamente el caso en que menos se
 * puede automatizar, no el caso en que más.
 *
 * Y la otra distinción que aquí se fija: «no pude preguntar» (`RETRY_LATER`) no es «no se puede».
 */
import { describe, expect, it } from 'vitest';
import {
  datosDeCuentaDesdeNegocio, inspeccionarCapacidad, type CuentaAccesible, type HechosDeCapacidad,
} from '../src/provisionamiento/provisionamiento-tipos';

const DATOS = { nombre: 'Clínica QA', moneda: 'CLP', zonaHoraria: 'America/Santiago' };
const cuenta = (over: Partial<CuentaAccesible> = {}): CuentaAccesible =>
  ({ customerId: '1111111111', manager: false, testAccount: false, ...over });

const hechos = (over: Partial<HechosDeCapacidad> = {}): HechosDeCapacidad => ({
  estadoProveedor: 'ACCOUNT_SELECTION_PENDING',
  cuentas: [],
  accesoDeApi: true,
  datosDeCuenta: DATOS,
  ...over,
});

describe('la capacidad de crear una cuenta', () => {
  it('con una administradora utilizable, se puede intentar', () => {
    const c = inspeccionarCapacidad(hechos({ cuentas: [cuenta({ customerId: '9999999999', manager: true })] }));
    expect(c.estado).toBe('AUTOMATABLE');
    expect(c.motivo).toBe('MANAGER_ELEGIBLE_DISPONIBLE');
    expect(c.managerCustomerId).toBe('9999999999');
  });

  /** El caso de CP, y el corazón de esta fase. */
  it('cero cuentas NO significa «puedo crear una»: sin administradora, lo hace una persona', () => {
    const c = inspeccionarCapacidad(hechos({ cuentas: [] }));
    expect(c.estado).toBe('HUMAN_PROVIDER_STEP_REQUIRED');
    expect(c.motivo).toBe('SIN_MANAGER_ACCESIBLE');
    expect(c.managerCustomerId).toBeNull();
    expect(c.explicacion).toMatch(/cuenta administradora/i);
    // La explicación se le enseña a una persona: nada de jerga del proveedor.
    for (const jerga of ['MCC', 'customerId', 'developer token', 'API', 'createCustomerClient']) {
      expect(c.explicacion).not.toContain(jerga);
    }
  });

  it('una administradora de PRUEBA no sirve para crear cuentas reales', () => {
    const c = inspeccionarCapacidad(hechos({ cuentas: [cuenta({ manager: true, testAccount: true })] }));
    expect(c.estado).toBe('HUMAN_PROVIDER_STEP_REQUIRED');
    expect(c.motivo).toBe('SIN_MANAGER_ACCESIBLE');
  });

  it('sin autorización vigente no se afirma nada sobre lo que se puede crear', () => {
    for (const estado of [null, 'NEEDS_REAUTH', 'DISCONNECTED', 'OAUTH_PENDING', 'NOT_CONNECTED']) {
      const c = inspeccionarCapacidad(hechos({ estadoProveedor: estado, cuentas: [] }));
      expect(c.estado, `estado ${estado}`).toBe('HUMAN_PROVIDER_STEP_REQUIRED');
      expect(c.motivo).toBe('AUTORIZACION_NO_VIGENTE');
    }
  });

  it('sin acceso de API del despliegue, el bloqueo es externo: no es un paso de nadie', () => {
    const c = inspeccionarCapacidad(hechos({ accesoDeApi: false, cuentas: [cuenta({ manager: true })] }));
    expect(c.estado).toBe('BLOCKED_EXTERNAL');
    expect(c.motivo).toBe('SIN_ACCESO_DE_API');
  });

  it('si no se pudo consultar al proveedor, no se decide nada', () => {
    const c = inspeccionarCapacidad(hechos({ cuentas: null }));
    expect(c.estado).toBe('RETRY_LATER');
    expect(c.motivo).toBe('NO_SE_PUDO_CONSULTAR');
    // Y no se cuela por delante de otras ramas: no saber manda sobre todo lo demás.
    const sinAutorizacion = inspeccionarCapacidad(hechos({ cuentas: null, estadoProveedor: null, accesoDeApi: false }));
    expect(sinAutorizacion.estado).toBe('RETRY_LATER');
  });

  it('faltando datos del negocio no se crea nada: una cuenta nace con moneda y zona horaria', () => {
    const c = inspeccionarCapacidad(hechos({ cuentas: [cuenta({ manager: true })], datosDeCuenta: null }));
    expect(c.estado).toBe('HUMAN_PROVIDER_STEP_REQUIRED');
    expect(c.motivo).toBe('DATOS_DEL_NEGOCIO_INCOMPLETOS');
  });
});

describe('los datos del alta salen del negocio, nunca de una suposición', () => {
  it('toma nombre, moneda y zona horaria declarados', () => {
    expect(datosDeCuentaDesdeNegocio({ displayName: 'CP Odontología', currency: 'clp', timezone: 'America/Santiago' }))
      .toEqual({ nombre: 'CP Odontología', moneda: 'CLP', zonaHoraria: 'America/Santiago' });
  });

  it('fail closed: si falta cualquiera de los tres, no hay datos de alta', () => {
    const casos = [
      { displayName: '', currency: 'CLP', timezone: 'America/Santiago' },
      { displayName: 'X', currency: null, timezone: 'America/Santiago' },
      { displayName: 'X', currency: 'CLP', timezone: '' },
      { displayName: 'X', currency: 'no-es-moneda', timezone: 'America/Santiago' },
      null,
    ];
    for (const c of casos) expect(datosDeCuentaDesdeNegocio(c), JSON.stringify(c)).toBeNull();
  });

  it('la moneda no se deduce del país: si el negocio no la declaró, no hay alta', () => {
    // Un negocio chileno SIN moneda declarada no produce «CLP» por inferencia.
    expect(datosDeCuentaDesdeNegocio({ displayName: 'Clínica', currency: null, timezone: 'America/Santiago' })).toBeNull();
  });
});
