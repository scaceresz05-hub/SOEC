/**
 * apps/api · PUENTE entre la conexión OAuth de Google Ads y el SSOT OPERATIVO del negocio.
 *
 * SOEC tenía dos verdades sobre «esta empresa tiene su cuenta conectada»:
 *
 *   `google_ads_connection`  — el estado del PROVEEDOR: OAuth, credencial, cuenta elegida, frescura.
 *   `business_connection`    — el SSOT que lee TODO lo demás: prerrequisitos de ejecución, composición del
 *                              cliente de escritura, proyección del runtime, preparación comercial.
 *
 * Elegir cuenta escribía sólo la primera. El resultado era absurdo y difícil de ver: una empresa terminaba su
 * OAuth, elegía su cuenta, veía «conectada» en pantalla, y el motor de campañas seguía diciendo «conecta tu
 * cuenta de Google Ads». Las empresas históricas no lo notaban porque su fila en `business_connection` la
 * había creado la migración del registro; una empresa NUEVA no podía llegar nunca a ejecutar.
 *
 * Este módulo cierra esa grieta sin crear una tercera fuente: el proveedor sigue mandando en su ciclo de vida
 * OAuth y, cuando hay una cuenta VALIDADA, se proyecta al SSOT operativo. Fail-closed: si la cuenta no sirve
 * para operar —sin moneda, sin zona horaria, administradora o de prueba—, no se escribe `CONNECTED`.
 *
 * Lo que este puente NO hace, por diseño: no enciende la capacidad de escritura, no abre el gobierno, no crea
 * mandato y no autoriza gasto. Conectar una cuenta es decir DÓNDE; gastar en ella es otra decisión, de una
 * persona, en otro sitio.
 */
import type { Pool, PoolClient } from 'pg';
import { RepositorioConexiones } from './conexion-pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { normalizarMoneda } from '../dinero';

/** Cuenta ya validada contra Google: lo que el puente necesita saber para proyectarla. */
export interface CuentaSeleccionada {
  readonly customerId: string;
  readonly loginCustomerId: string | null;
  readonly descriptiveName: string | null;
  readonly currencyCode: string | null;
  readonly timeZone: string | null;
  readonly manager: boolean;
  readonly testAccount: boolean;
}

export type MotivoRechazo =
  | 'SIN_MONEDA'        // la cuenta no declara moneda: todo importe sería una suposición
  | 'SIN_ZONA_HORARIA'  // sin zona horaria no se sabe cuándo empieza «hoy» para el gasto diario
  | 'CUENTA_MANAGER'    // una cuenta administradora (MCC) no aloja campañas: aloja otras cuentas
  | 'CUENTA_DE_PRUEBA'; // una cuenta de prueba no sirve el anuncio a nadie real

export type ResultadoPuente =
  | { readonly ok: true; readonly moneda: string; readonly zonaHoraria: string }
  | { readonly ok: false; readonly motivo: MotivoRechazo; readonly explicacion: string };

/**
 * ¿Esta cuenta sirve para operar de verdad? Se responde ANTES de escribir nada. Cada motivo tiene su frase en
 * lenguaje de negocio: quien lo lea tiene que entender qué elegir la próxima vez, no qué campo falló.
 */
export function evaluarCuentaParaOperar(c: CuentaSeleccionada): ResultadoPuente {
  if (c.manager) {
    return { ok: false, motivo: 'CUENTA_MANAGER', explicacion: 'esa es una cuenta administradora: no aloja campañas. Elige la cuenta de publicidad de tu empresa.' };
  }
  if (c.testAccount) {
    return { ok: false, motivo: 'CUENTA_DE_PRUEBA', explicacion: 'esa cuenta es de prueba: sus anuncios no se muestran a nadie. Elige la cuenta real de tu empresa.' };
  }
  const moneda = normalizarMoneda(c.currencyCode);
  if (moneda === null) {
    return { ok: false, motivo: 'SIN_MONEDA', explicacion: 'esa cuenta no declara en qué moneda factura, y sin moneda ningún presupuesto significa nada.' };
  }
  const zona = (c.timeZone ?? '').trim();
  if (zona === '') {
    return { ok: false, motivo: 'SIN_ZONA_HORARIA', explicacion: 'esa cuenta no declara su zona horaria, y sin ella no se sabe cuándo empieza el día de gasto.' };
  }
  return { ok: true, moneda, zonaHoraria: zona };
}

export interface OpcionesPuente {
  readonly pool: Pool;
  readonly ahora: () => string;
  readonly actor?: string;
  readonly log?: (info: Record<string, unknown>) => void;
}

async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Proyecta la cuenta elegida al SSOT operativo, en UNA transacción: conexión + capacidades de LECTURA + huella
 * de auditoría. Idempotente por construcción —`business_connection` tiene clave única por (empresa, proveedor)
 * y las capacidades se fijan sólo si faltan—, así que reelegir la misma cuenta no duplica nada y cambiar de
 * cuenta actualiza la misma fila, con su rastro.
 *
 * Devuelve el resultado de la evaluación: si la cuenta no sirve para operar, NO se escribe nada.
 */
export async function proyectarCuentaGoogleAds(
  org: string,
  cuenta: CuentaSeleccionada,
  o: OpcionesPuente,
): Promise<ResultadoPuente> {
  const veredicto = evaluarCuentaParaOperar(cuenta);
  if (!veredicto.ok) {
    o.log?.({ puenteGoogleAds: 'rechazada', org, customerId: cuenta.customerId, motivo: veredicto.motivo });
    return veredicto;
  }

  const conexiones = new RepositorioConexiones(o.pool);
  const negocios = new RepositorioNegocios(o.pool);
  const ahora = o.ahora();
  const actor = o.actor ?? 'google-ads-oauth';
  const previa = await conexiones.buscar(org, 'GOOGLE_ADS');

  await enTransaccion(o.pool, async (tx) => {
    await conexiones.guardar(tx, {
      organizationId: org,
      provider: 'GOOGLE_ADS',
      id: `${org}:GOOGLE_ADS`,
      estado: 'CONNECTED',
      externalAccountId: cuenta.customerId,
      externalAccountName: cuenta.descriptiveName,
      loginAccountId: cuenta.loginCustomerId ?? cuenta.customerId,
      // Configuración PÚBLICA: identificadores y hechos de la cuenta. Ningún secreto vive aquí; el refresh
      // token sigue siendo una referencia opaca del depósito cifrado del proveedor.
      configuracion: {
        customerId: cuenta.customerId,
        loginCustomerId: cuenta.loginCustomerId ?? cuenta.customerId,
        moneda: veredicto.moneda,
        zonaHoraria: veredicto.zonaHoraria,
        esManager: cuenta.manager,
        esCuentaDePrueba: cuenta.testAccount,
        seleccionadaEn: ahora,
      },
      secretRef: null, // la credencial vive en el depósito del proveedor; aquí no se copia ni se referencia
      ultimoError: null,
      validadaEn: ahora, // Google acaba de confirmar que este token accede a esta cuenta
      origen: 'OAUTH',
    });

    // CAPACIDADES DE LECTURA. `fijarCapacidadSiFalta` respeta lo que la empresa ya decidió: si alguien la
    // apagó a mano, conectar no vuelve a encenderla. Y nada de lo que se fija aquí autoriza gasto.
    await conexiones.fijarCapacidadSiFalta(tx, {
      organizationId: org, capacidad: 'MEDICION_REAL', habilitada: true, origen: 'SISTEMA',
      nota: 'derivada: la cuenta de Google Ads quedó conectada y se puede leer', actor,
    });

    await negocios.registrarAuditoria(tx, {
      organizationId: org,
      actor,
      action: previa === null ? 'GOOGLE_ADS_ACCOUNT_LINKED' : 'GOOGLE_ADS_ACCOUNT_CHANGED',
      changedFields: {
        customerId: cuenta.customerId,
        anterior: (previa?.configuracion as { customerId?: string } | undefined)?.customerId ?? previa?.externalAccountId ?? null,
        moneda: veredicto.moneda,
        zonaHoraria: veredicto.zonaHoraria,
        at: ahora,
      },
    });
  });

  o.log?.({ puenteGoogleAds: 'proyectada', org, customerId: cuenta.customerId, moneda: veredicto.moneda });
  return veredicto;
}
