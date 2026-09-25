/**
 * Autonomy Fase I.6.1 · ¿PUEDE ESTA CUENTA PAGAR SUS ANUNCIOS? El mapeo, como función pura.
 *
 * Este fichero existe por un error que casi se despliega. La versión anterior leía `billing_setup`, no
 * encontraba filas y concluía «falta configurar el pago». Es falso: la documentación de Google dice que los
 * flujos de facturación de la API exigen **facturación mensual**, un régimen que pide un año de empresa y
 * miles de dólares de gasto mensual. Para una cuenta con tarjeta —casi todo el mundo— esa consulta devuelve
 * cero filas SIEMPRE, y eso no dice nada sobre su tarjeta. Habríamos acusado de no haber hecho algo a gente
 * que lo tenía hecho.
 *
 * Las tres reglas que estas pruebas fijan:
 *
 *   1. `billing_setup` vacío NO significa «falta pago»; significa «no lo podemos ver».
 *   2. `customer.status = ENABLED` sirve para descartar cuentas muertas, jamás para afirmar que hay con qué
 *      pagar. Ni el gasto histórico tampoco.
 *   3. Cuando el proveedor no deja comprobarlo, lo único que cierra el paso es que una persona lo atestigüe.
 */
import { describe, expect, it } from 'vitest';
import { evaluarFacturacion, URL_FACTURACION_GOOGLE, type SenalesFacturacion } from '../src/facturacion/facturacion-tipos';

const senales = (over: Partial<SenalesFacturacion> = {}): SenalesFacturacion => ({
  estadoCuenta: 'ENABLED',
  configuraciones: [],
  confirmacionHumanaVigente: false,
  ...over,
});

describe('facturación mensual: sólo se interpreta cuando CONSTA que la cuenta está en ese régimen', () => {
  /**
   * La corrección que enseñó una cuenta real: una cuenta de autoservicio —tarjeta, pospago— devolvió
   * `billing_setup` APPROVED. Tomarlo por «lista para gastar» era un falso «sí», que es el error caro: un
   * falso «no» molesta a alguien, un falso «sí» empuja hacia el dinero de otro.
   */
  it('APPROVED sin evidencia del régimen NO basta: se pide confirmación humana', () => {
    const r = evaluarFacturacion(senales({ configuraciones: ['APPROVED'] }));
    expect(r.estado).toBe('PAYMENT_SETUP_REQUIRED');
    expect(r.observacion).toBe('SELF_SERVICE_PAYMENT_UNVERIFIABLE');
    expect(r.requiereConfirmacionHumana).toBe(true);
  });

  it('con evidencia positiva de facturación mensual, aprobada ⇒ lista', () => {
    const r = evaluarFacturacion(senales({ configuraciones: ['APPROVED'], facturacionMensualConfirmada: true }));
    expect(r.estado).toBe('READY');
    expect(r.observacion).toBe('MONTHLY_INVOICING_READY');
    expect(r.requiereConfirmacionHumana).toBe(false);
  });

  it('con evidencia positiva y en aprobación ⇒ esperar, sin pedirle nada a nadie', () => {
    for (const c of ['PENDING', 'APPROVED_HELD'] as const) {
      const r = evaluarFacturacion(senales({ configuraciones: [c], facturacionMensualConfirmada: true }));
      expect(r.estado, c).toBe('PENDING_PROVIDER');
      expect(r.observacion).toBe('MONTHLY_INVOICING_PENDING');
      expect(r.explicacion).toMatch(/no hace falta que hagas nada más/i);
    }
  });

  it('con evidencia positiva y cancelada ⇒ ese camino está bloqueado', () => {
    const r = evaluarFacturacion(senales({ configuraciones: ['CANCELLED'], facturacionMensualConfirmada: true }));
    expect(r.observacion).toBe('MONTHLY_INVOICING_BLOCKED');
    expect(r.estado).toBe('PAYMENT_SETUP_REQUIRED');
    expect(r.requiereConfirmacionHumana).toBe(true);
  });

  /** Y la red de seguridad: hoy nadie pasa esa bandera, así que ninguna cuenta real llega a READY sin persona. */
  it('sin la bandera, NINGUNA combinación de billing_setup produce READY', () => {
    const configs: Array<readonly ('APPROVED' | 'PENDING' | 'APPROVED_HELD' | 'CANCELLED' | 'UNKNOWN')[]> = [
      ['APPROVED'], ['PENDING'], ['APPROVED_HELD'], ['CANCELLED'], ['UNKNOWN'], ['APPROVED', 'CANCELLED'],
    ];
    for (const configuraciones of configs) {
      expect(evaluarFacturacion(senales({ configuraciones })).estado, JSON.stringify(configuraciones)).toBe('PAYMENT_SETUP_REQUIRED');
    }
  });
});

describe('autoservicio: la API no lo expone, y se dice', () => {
  /** El defecto corregido, fijado para que no vuelva. */
  it('sin filas de facturación NO se afirma que falte un método de pago', () => {
    const r = evaluarFacturacion(senales({ configuraciones: [] }));
    expect(r.observacion).toBe('SELF_SERVICE_PAYMENT_UNVERIFIABLE');
    expect(r.motivo).toBe('PAGO_NO_VERIFICABLE_POR_API');
    expect(r.estado).not.toBe('READY');
    // Lo que se le dice a la persona es lo que es cierto: que no podemos comprobarlo.
    expect(r.explicacion).toMatch(/no permite que SOEC compruebe/i);
    expect(r.explicacion).not.toMatch(/falta|no tienes|no has configurado/i);
    expect(r.requiereConfirmacionHumana).toBe(true);
  });

  it('una cuenta activa no es una cuenta con pago: ENABLED no prueba nada', () => {
    const r = evaluarFacturacion(senales({ estadoCuenta: 'ENABLED', configuraciones: [] }));
    expect(r.estado).not.toBe('READY');
  });

  it('haber gastado antes tampoco prueba que hoy se pueda cobrar', () => {
    const r = evaluarFacturacion(senales({ configuraciones: [], gastoHistoricoMinor: 2_500_000 }));
    expect(r.estado).not.toBe('READY');
    expect(r.requiereConfirmacionHumana).toBe(true);
  });

  it('la confirmación de la persona es lo único que cierra el paso', () => {
    const r = evaluarFacturacion(senales({ configuraciones: [], confirmacionHumanaVigente: true }));
    expect(r.estado).toBe('READY');
    expect(r.motivo).toBe('CONFIRMADO_POR_LA_PERSONA');
    // Y se sigue diciendo qué se observó de verdad: que no lo vimos, nos lo contaron.
    expect(r.observacion).toBe('SELF_SERVICE_PAYMENT_UNVERIFIABLE');
    expect(r.requiereConfirmacionHumana).toBe(false);
  });
});

describe('lo que nunca puede pasar', () => {
  it('una cuenta inactiva es un bloqueo externo, por encima de cualquier otra señal', () => {
    for (const estado of ['SUSPENDED', 'CANCELED', 'CLOSED']) {
      const r = evaluarFacturacion(senales({ estadoCuenta: estado, configuraciones: ['APPROVED'], confirmacionHumanaVigente: true }));
      expect(r.estado, estado).toBe('BLOCKED_EXTERNAL');
      expect(r.observacion).toBe('ACCOUNT_BLOCKED');
    }
  });

  it('si no se pudo consultar, no se concluye nada', () => {
    expect(evaluarFacturacion(senales({ configuraciones: null })).estado).toBe('RETRY_LATER');
    expect(evaluarFacturacion(senales({ estadoCuenta: null })).estado).toBe('RETRY_LATER');
    // Ni siquiera una confirmación humana convierte en «listo» algo que no se pudo mirar.
    expect(evaluarFacturacion(senales({ configuraciones: null, confirmacionHumanaVigente: true })).estado).toBe('RETRY_LATER');
  });

  it('NINGUNA combinación sin aprobación ni confirmación termina en READY', () => {
    const cuentas = ['ENABLED', 'SUSPENDED', 'CANCELED', 'CLOSED', 'UNKNOWN', 'RARO', null];
    const configs: Array<readonly ('PENDING' | 'APPROVED_HELD' | 'CANCELLED' | 'UNKNOWN')[] | null> = [
      [], ['PENDING'], ['APPROVED_HELD'], ['CANCELLED'], ['UNKNOWN'], ['PENDING', 'CANCELLED'], null,
    ];
    for (const estadoCuenta of cuentas) {
      for (const configuraciones of configs) {
        for (const gastoHistoricoMinor of [null, 0, 999_999]) {
          const r = evaluarFacturacion({ estadoCuenta, configuraciones, gastoHistoricoMinor, confirmacionHumanaVigente: false });
          expect(r.estado, `${estadoCuenta}/${JSON.stringify(configuraciones)}/${gastoHistoricoMinor}`).not.toBe('READY');
        }
      }
    }
  });

  it('ninguna explicación menciona jerga del proveedor ni datos de pago', () => {
    const combinaciones: SenalesFacturacion[] = [
      senales(), senales({ configuraciones: ['APPROVED'] }), senales({ configuraciones: ['PENDING'] }),
      senales({ estadoCuenta: 'SUSPENDED' }), senales({ configuraciones: null }), senales({ estadoCuenta: 'RARO' }),
      senales({ confirmacionHumanaVigente: true }),
    ];
    for (const s of combinaciones) {
      const t = evaluarFacturacion(s).explicacion;
      for (const jerga of ['billing_setup', 'BillingSetup', 'customer.status', 'APPROVED', 'PENDING', 'monthly invoicing', 'PAN', 'CVV']) {
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
