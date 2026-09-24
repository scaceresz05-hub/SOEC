/**
 * Autonomy Fase I.6 · ¿PUEDE ESTA CUENTA PAGAR SUS ANUNCIOS? El mapeo, como función pura.
 *
 * La regla innegociable: **la falta de información nunca se convierte en «listo»**. Google no expone si una
 * tarjeta es válida hoy —ni un rechazo reciente, ni el saldo—, así que hay situaciones en las que la única
 * respuesta honesta es «no lo sé». Que exista ese valor es lo que impide que el sistema dé por bueno un
 * silencio y siga adelante hacia el gasto.
 *
 * La otra cosa que se fija aquí: los estados intermedios existen de verdad. «Google está aprobando la forma
 * de pago» no es ni listo ni pendiente de la persona; es esperar, y se dice así.
 */
import { describe, expect, it } from 'vitest';
import { evaluarFacturacion, URL_FACTURACION_GOOGLE, type SenalesFacturacion } from '../src/facturacion/facturacion-tipos';

const senales = (over: Partial<SenalesFacturacion> = {}): SenalesFacturacion => ({
  estadoCuenta: 'ENABLED',
  configuraciones: [],
  gastoHistoricoMinor: 0,
  ...over,
});

describe('la preparación para facturar', () => {
  it('con una configuración aprobada, y sólo entonces, está lista', () => {
    const r = evaluarFacturacion(senales({ configuraciones: ['APPROVED'] }));
    expect(r.estado).toBe('READY');
    expect(r.motivo).toBe('CONFIGURACION_APROBADA');
  });

  it('sin ninguna configuración, hace falta que una persona la configure en Google', () => {
    const r = evaluarFacturacion(senales({ configuraciones: [] }));
    expect(r.estado).toBe('PAYMENT_SETUP_REQUIRED');
    expect(r.motivo).toBe('SIN_CONFIGURACION_DE_PAGO');
    expect(r.explicacion).toMatch(/cómo se pagan tus anuncios/i);
  });

  it('una configuración cancelada no cuenta como configuración', () => {
    expect(evaluarFacturacion(senales({ configuraciones: ['CANCELLED'] })).estado).toBe('PAYMENT_SETUP_REQUIRED');
  });

  it('mientras Google la aprueba, no se le pide nada más a nadie', () => {
    for (const c of ['PENDING', 'APPROVED_HELD'] as const) {
      const r = evaluarFacturacion(senales({ configuraciones: [c] }));
      expect(r.estado, c).toBe('PENDING_PROVIDER');
      expect(r.explicacion).toMatch(/no hace falta que hagas nada más/i);
    }
  });

  it('una cuenta que Google tiene inactiva es un bloqueo externo, no una tarea', () => {
    for (const estado of ['SUSPENDED', 'CANCELED', 'CLOSED']) {
      const r = evaluarFacturacion(senales({ estadoCuenta: estado, configuraciones: ['APPROVED'] }));
      expect(r.estado, estado).toBe('BLOCKED_EXTERNAL');
      expect(r.motivo).toBe('CUENTA_NO_OPERATIVA');
    }
  });

  it('si no se pudo consultar, no se concluye nada', () => {
    expect(evaluarFacturacion(senales({ configuraciones: null })).estado).toBe('RETRY_LATER');
    expect(evaluarFacturacion(senales({ estadoCuenta: null })).estado).toBe('RETRY_LATER');
    // Y no saber manda sobre todo lo demás: ni siquiera una configuración aprobada lo convierte en listo.
    expect(evaluarFacturacion({ estadoCuenta: null, configuraciones: ['APPROVED'], gastoHistoricoMinor: 0 }).estado).toBe('RETRY_LATER');
  });

  it('un estado de cuenta que no entendemos nunca es «listo»', () => {
    const r = evaluarFacturacion(senales({ estadoCuenta: 'UNKNOWN', configuraciones: ['APPROVED'] }));
    expect(r.estado).toBe('UNKNOWN');
    expect(r.motivo).toBe('SIN_EVIDENCIA_SUFICIENTE');
  });

  /** Contraprueba: a quien ya publicó no se le manda a configurar lo que probablemente ya tiene. */
  it('una cuenta que ya gastó no recibe la tarea, pero tampoco se declara lista', () => {
    const r = evaluarFacturacion(senales({ configuraciones: [], gastoHistoricoMinor: 125_000 }));
    expect(r.estado).toBe('UNKNOWN');
    expect(r.estado).not.toBe('READY');
    expect(r.estado).not.toBe('PAYMENT_SETUP_REQUIRED');
  });

  it('NINGUNA combinación sin configuración aprobada termina en READY', () => {
    const cuentas = ['ENABLED', 'SUSPENDED', 'CANCELED', 'CLOSED', 'UNKNOWN', 'RARO', null];
    const configs: Array<readonly ('PENDING' | 'APPROVED_HELD' | 'CANCELLED' | 'UNKNOWN')[] | null> = [
      [], ['PENDING'], ['APPROVED_HELD'], ['CANCELLED'], ['UNKNOWN'], ['PENDING', 'CANCELLED'], null,
    ];
    for (const estadoCuenta of cuentas) {
      for (const configuraciones of configs) {
        for (const gastoHistoricoMinor of [null, 0, 999_999]) {
          const r = evaluarFacturacion({ estadoCuenta, configuraciones, gastoHistoricoMinor });
          expect(r.estado, `${estadoCuenta}/${JSON.stringify(configuraciones)}/${gastoHistoricoMinor}`).not.toBe('READY');
        }
      }
    }
  });

  it('ninguna explicación menciona jerga del proveedor ni datos de pago', () => {
    const combinaciones: SenalesFacturacion[] = [
      senales(), senales({ configuraciones: ['APPROVED'] }), senales({ configuraciones: ['PENDING'] }),
      senales({ estadoCuenta: 'SUSPENDED' }), senales({ configuraciones: null }), senales({ estadoCuenta: 'UNKNOWN' }),
    ];
    for (const s of combinaciones) {
      const t = evaluarFacturacion(s).explicacion;
      for (const jerga of ['billing_setup', 'BillingSetup', 'customer.status', 'APPROVED', 'PENDING', 'payments account', 'PAN', 'CVV']) {
        expect(t, `«${jerga}» no puede salir a la pantalla`).not.toContain(jerga);
      }
    }
  });
});

describe('a dónde se manda a la persona', () => {
  it('es una dirección oficial de Google, https, y de un anfitrión ya permitido', () => {
    const u = new URL(URL_FACTURACION_GOOGLE);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('ads.google.com');
    expect(u.pathname).toContain('/billing');
  });
});
