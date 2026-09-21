/**
 * apps/api · CONEXIONES COMO DATO · migración de las conexiones y capacidades históricas.
 *
 * SmileFlow, C Y P y CP Odontología tenían sus fuentes, sus credenciales y sus experiencias habilitadas
 * dentro de módulos TypeScript. Aquí pasan a ser filas, SIN cambiar nada de lo que hoy hacen:
 *
 *  · las credenciales NO se mueven ni se re-cifran: se conserva su REFERENCIA tal cual (`env:…`). Mover un
 *    secreto en una migración automática es exactamente el tipo de operación que puede dejar a una empresa
 *    sin ingesta sin que nadie se dé cuenta; el token se traslada al depósito cifrado cuando una persona
 *    vuelve a guardar la conexión desde la interfaz;
 *  · sólo se crean conexiones para fuentes que HOY están conectadas u observadas. Una fuente declarada y no
 *    configurada (GA4 de CP, Google Ads de CP) no se convierte en conexión: no lo es;
 *  · las capacidades se siembran con el valor EXACTO de hoy. Nada se enciende de más: CP no adquiere pausa
 *    automática ni ciclo de director, porque hoy no los tiene.
 *
 * IDEMPOTENTE: corre en cada arranque y nunca sobrescribe una fila existente. Lo que una persona cambie desde
 * la interfaz manda para siempre sobre lo que diga el módulo histórico.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { configuracionHistorica, organizacionesHistoricas } from '../plataforma/registro';
import type { EstadoFuente, FuenteRegistrada } from '../plataforma/tipos';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioConexiones } from './conexion-pg';
import { CAPACIDAD_DE_EXPERIENCIA, type CapacidadNegocio, type EstadoConexion, type ProveedorConexion } from './conexion-tipos';

export interface ResultadoMigracionConexiones {
  readonly conexiones: readonly string[];
  readonly capacidades: readonly string[];
  readonly omitidas: readonly string[];
  readonly yaEstaban: readonly string[];
}

/** Estado de conexión equivalente al estado histórico de la fuente. `null` ⇒ no es una conexión. */
export function estadoDeConexionDesdeFuente(e: EstadoFuente): EstadoConexion | null {
  switch (e) {
    case 'CONNECTED_READ_ONLY':
    case 'OBSERVED':
      return 'CONNECTED';
    case 'PENDING':
      return 'PENDING';
    case 'CREDENTIALS_REQUIRED':
    case 'PARTIAL_CONFIGURATION':
      return 'NOT_CONNECTED';
    default:
      // NOT_CONFIGURED, NOT_CONNECTED, NOT_APPLICABLE, CONNECTED_UNKNOWN: declaradas, no conectadas.
      return null;
  }
}

/** Proveedor canónico de una fuente histórica. `null` ⇒ la fuente no se modela como conexión todavía. */
export function proveedorDeFuente(f: FuenteRegistrada): ProveedorConexion | null {
  if (f.tipo === 'GROWTH') return 'GROWTH_M2M';
  if (f.provider === 'google-ads') return 'GOOGLE_ADS';
  if (f.provider.startsWith('meta')) return 'META_ADS';
  if (f.provider === 'ga4') return 'GA4';
  if (f.provider.startsWith('woocommerce')) return 'WOOCOMMERCE';
  return null;
}

export async function migrarConexionesDelRegistro(
  pool: Pool,
  ahora: () => string = () => new Date().toISOString(),
): Promise<ResultadoMigracionConexiones> {
  const repo = new RepositorioConexiones(pool);
  const negocios = new RepositorioNegocios(pool);
  const conexiones: string[] = [];
  const capacidades: string[] = [];
  const omitidas: string[] = [];
  const yaEstaban: string[] = [];

  for (const org of organizacionesHistoricas()) {
    const cfg = configuracionHistorica(org);
    if (cfg === null) continue;
    // Sin perfil persistido no hay a qué colgar la conexión (la clave foránea lo exige). No es un fallo del
    // arranque: es una migración de Fase A que no corrió, y se dice en el log en lugar de tumbar el proceso.
    if ((await negocios.perfil(org)) === null) {
      omitidas.push(`${org}: sin perfil persistido (business_profile)`);
      continue;
    }

    for (const f of cfg.fuentes) {
      const provider = proveedorDeFuente(f);
      const estado = estadoDeConexionDesdeFuente(f.estado);
      if (provider === null || estado === null) continue;
      const growth = f.growth ?? null;
      const cred = growth
        ? f.credenciales.find((c) => c.nombreLogico === growth.nombreLogicoCredencial) ?? f.credenciales[0] ?? null
        : f.credenciales[0] ?? null;
      const ads = provider === 'GOOGLE_ADS' ? cfg.perfil?.externalResourceRefs.googleAds ?? null : null;
      const configuracion: Record<string, unknown> = growth
        ? {
            provider: f.provider,
            baseUrl: growth.baseUrl,
            hostsAutorizados: [...growth.hostsAutorizados],
            rutaIngesta: growth.rutaIngesta,
            nombreLogicoCredencial: growth.nombreLogicoCredencial,
            baseUrlEnvOverride: growth.baseUrlEnvOverride ?? null,
            sourceId: f.sourceId,
          }
        : ads
          ? { ...ads, sourceId: f.sourceId }
          : { provider: f.provider, sourceId: f.sourceId };

      const creada = await repo.insertarSiFalta(pool, {
        organizationId: org,
        provider,
        id: randomUUID(),
        estado,
        externalAccountId: f.externalAccountId ?? ads?.customerId ?? null,
        loginAccountId: ads?.loginCustomerId ?? null,
        externalAccountName: ads?.nombreCampania ?? null,
        configuracion,
        // REFERENCIA intacta: la migración no toca secretos ni los vuelve a cifrar.
        secretRef: cred?.secretRef ?? null,
        validadaEn: null,
        origen: 'MIGRACION',
      });
      if (creada) conexiones.push(`${org}:${provider}`);
      else yaEstaban.push(`${org}:${provider}`);
    }

    // ── CAPACIDADES: el valor EXACTO de hoy, ni una más ──
    const habilitadas = new Set<CapacidadNegocio>(
      cfg.negocio.experienciasHabilitadas.map((e) => CAPACIDAD_DE_EXPERIENCIA[e]),
    );
    const tieneGrowthConectado = cfg.fuentes.some((f) => f.tipo === 'GROWTH' && estadoDeConexionDesdeFuente(f.estado) === 'CONNECTED');
    if (tieneGrowthConectado) habilitadas.add('INGESTA_GROWTH'); // hoy se ingiere: se conserva
    // El monitor de seguridad corre hoy sólo para quien declaró pausa automática. CP no la tiene y no la gana.
    if (cfg.negocio.politicaSeguridad?.pausaAutomatica === true) habilitadas.add('MONITOR_SEGURIDAD');
    // El ciclo del director corre hoy sólo para quien tiene la experiencia del director real.
    if (cfg.negocio.experienciasHabilitadas.includes('director-real')) habilitadas.add('CICLO_DIRECTOR');

    for (const cap of [
      'MEDICION_REAL', 'DIRECTOR_REAL', 'AUTONOMIA_ADS', 'PILOTO_DECISION',
      'INGESTA_GROWTH', 'MONITOR_SEGURIDAD', 'CICLO_DIRECTOR',
    ] as CapacidadNegocio[]) {
      const creada = await repo.fijarCapacidadSiFalta(pool, {
        organizationId: org,
        capacidad: cap,
        habilitada: habilitadas.has(cap),
        origen: 'MIGRACION',
        nota: `estado vigente al migrar (${ahora()})`,
        actor: 'migracion-connections-as-data',
      });
      if (creada && habilitadas.has(cap)) capacidades.push(`${org}:${cap}`);
    }
  }

  return { conexiones, capacidades, omitidas, yaEstaban };
}
