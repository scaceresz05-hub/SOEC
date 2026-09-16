/**
 * SOEC · CP Odontología · CONTRATO DEL TRASLADO A PRODUCCIÓN CON `www`.
 *
 * Fija lo único que cambia en SOEC antes del cutover: `www.dentistaclaudiapacheco.cl` queda
 * AUTORIZADO, pero el origen efectivo sigue siendo el staging. Autorizar no es apuntar.
 *
 * Lo que de verdad protege esta prueba es que añadir un host a la allowlist no haya aflojado el
 * default-deny: un override hacia cualquier otro host —incluido el ápice, que conserva el correo—
 * tiene que seguir rechazándose sin tocar la red.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { SolicitudAdaptador } from '@soec/adaptadores';
import { SecretStoreEnv } from '@soec/secretos';
import { ESQUEMA_EGRESS_GROWTH, crearGrowthAdapter } from '../src/ingesta/growth-adapter';
import { getFuenteGrowth } from '../src/plataforma';
import {
  ORG_CP_ODONTOLOGIA,
  BASE_URL_GROWTH_CP_ODONTOLOGIA,
  BASE_URL_WWW_CP_ODONTOLOGIA,
  HOST_GROWTH_CP_ODONTOLOGIA,
  HOST_WWW_CP_ODONTOLOGIA,
} from '../src/plataforma/negocios/org-cp-odontologia';

const TOKEN = 'token-de-prueba-cp';
const ENV_BASE = { CP_ODONTOLOGIA_GROWTH_TOKEN: TOKEN } as const;

/** El almacen real de secretos por entorno, igual que en el resto de la suite. */
const secretStore = () => new SecretStoreEnv(ENV_BASE);

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('prueba-cutover'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: 'prueba-cutover',
  };
}

/** Misma forma que usa el resto de la suite: la peticion viaja dentro de `peticion`. */
function solicitud(cursor = '0'): SolicitudAdaptador {
  return {
    solicitudId: 's-cutover',
    capacidadId: 'ingesta-growth',
    peticion: { operacion: 'growth-events', parametros: { cursor, limit: '50' } },
  };
}

/** Adaptador con el entorno indicado; devuelve también la URL que se intentó y si hubo red. */
function adaptadorCon(env: Record<string, string | undefined>) {
  let url: string | null = null;
  let llamadas = 0;
  const fetchFn = (async (input: string | URL) => {
    llamadas += 1;
    url = String(input);
    return new Response('{"datos":[],"next_cursor":null}', { status: 200 });
  }) as typeof fetch;
  const adaptador = crearGrowthAdapter(getFuenteGrowth(ORG_CP_ODONTOLOGIA), {
    secretStore: secretStore(),
    esquemaEgress: ESQUEMA_EGRESS_GROWTH,
    env,
    fetchFn,
  });
  return { adaptador, url: () => url, llamadas: () => llamadas };
}

describe('CP Odontología · traslado a producción con www', () => {
  it('www está autorizado, y el staging sigue siendo el primero', () => {
    const fuente = getFuenteGrowth(ORG_CP_ODONTOLOGIA);
    expect(fuente.hostsAutorizados).toContain(HOST_WWW_CP_ODONTOLOGIA);
    expect(fuente.hostsAutorizados[0]).toBe(HOST_GROWTH_CP_ODONTOLOGIA);
  });

  it('el ápice NO está autorizado: conserva el correo y sigue sirviendo el sitio antiguo', () => {
    const fuente = getFuenteGrowth(ORG_CP_ODONTOLOGIA);
    expect(fuente.hostsAutorizados).not.toContain('dentistaclaudiapacheco.cl');
  });

  it('sin la variable, el origen efectivo SIGUE siendo el staging (autorizar no es apuntar)', async () => {
    const fuente = getFuenteGrowth(ORG_CP_ODONTOLOGIA);
    expect(fuente.baseUrl).toBe(BASE_URL_GROWTH_CP_ODONTOLOGIA);
    const a = adaptadorCon({ ...ENV_BASE });
    const res = await a.adaptador.ejecutar(ctx(ORG_CP_ODONTOLOGIA), solicitud());
    expect(res.estado).toBe('OK');
    expect(a.url()).toContain(HOST_GROWTH_CP_ODONTOLOGIA);
    expect(a.url()).not.toContain(HOST_WWW_CP_ODONTOLOGIA);
  });

  it('con la variable apuntando a www, el origen pasa a www sin tocar código', async () => {
    const a = adaptadorCon({ ...ENV_BASE, CP_ODONTOLOGIA_M2M_URL: BASE_URL_WWW_CP_ODONTOLOGIA });
    const res = await a.adaptador.ejecutar(ctx(ORG_CP_ODONTOLOGIA), solicitud());
    expect(res.estado).toBe('OK');
    expect(a.url()).toBe(
      'https://www.dentistaclaudiapacheco.cl/integrations/soec/growth-events?cursor=0&limit=50',
    );
  });

  it('DEFAULT-DENY INTACTO: un override al ápice se rechaza y no sale ni una petición', async () => {
    const a = adaptadorCon({ ...ENV_BASE, CP_ODONTOLOGIA_M2M_URL: 'https://dentistaclaudiapacheco.cl' });
    const res = await a.adaptador.ejecutar(ctx(ORG_CP_ODONTOLOGIA), solicitud());
    expect(res.estado).toBe('ERROR');
    expect(a.llamadas()).toBe(0);
  });

  it('DEFAULT-DENY INTACTO: un override a un host cualquiera se rechaza sin red', async () => {
    const a = adaptadorCon({ ...ENV_BASE, CP_ODONTOLOGIA_M2M_URL: 'https://recolector-de-tokens.example' });
    const res = await a.adaptador.ejecutar(ctx(ORG_CP_ODONTOLOGIA), solicitud());
    expect(res.estado).toBe('ERROR');
    expect(a.llamadas()).toBe(0);
  });
});
