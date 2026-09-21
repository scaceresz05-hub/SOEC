/**
 * apps/api · CONEXIONES COMO DATO · snapshot del runtime y descubrimiento por capacidad.
 *
 * El servidor proyecta la base a la puerta de resolución de la plataforma al arrancar y cada minuto. Ése es
 * el mecanismo por el que una empresa creada y conectada desde la interfaz queda operativa sin desplegar: no
 * hay que reiniciar el proceso ni tocar código, sólo esperar el siguiente refresco (o el que dispara la
 * propia mutación, que es inmediato).
 *
 * SI LA BASE FALLA, NO SE CAMBIA NADA: el snapshot anterior sigue en pie. Un fallo de lectura jamás debe
 * dejar a las empresas sin configuración —eso apagaría la medición y el monitor de seguridad—, así que el
 * refresco es la única operación que puede fallar y su fallo se registra sin efectos.
 */
import type { Pool } from 'pg';
import { fijarNegociosDelRuntime, type ConfiguracionConProcedencia } from '../plataforma/registro';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioConexiones } from './conexion-pg';
import { construirSnapshotDeNegocios, type DetalleProyeccion } from './proyeccion';
import type { CapacidadNegocio } from './conexion-tipos';

export interface ResumenRefresco {
  readonly organizaciones: number
  readonly at: string;
  readonly detalle: readonly DetalleProyeccion[];
}

/**
 * Lee la base, proyecta y FIJA la configuración del runtime. Devuelve el detalle de procedencia para que el
 * arranque lo deje por escrito: cuántas empresas operan con datos y cuáles siguen tocando el módulo histórico.
 */
export async function refrescarNegociosDelRuntime(pool: Pool): Promise<ResumenRefresco> {
  const snap = await construirSnapshotDeNegocios(pool);
  const porOrg = new Map(snap.detalle.map((d) => [d.org, d]));
  const entradas: ConfiguracionConProcedencia[] = snap.configs.map((config) => {
    const d = porOrg.get(config.negocio.organizationId);
    return {
      config,
      origen: d?.origen ?? 'REGISTRO',
      camposDelRegistro: d?.camposDelRegistro ?? ['todo'],
      faltantesDePerfil: d?.faltantesDePerfil ?? [],
    };
  });
  const { organizaciones } = fijarNegociosDelRuntime(entradas, snap.at);
  return { organizaciones, at: snap.at, detalle: snap.detalle };
}

/** Bucle de refresco. `unref()` para no retener el proceso; sin solapes y sin propagar fallos. */
export function iniciarRefrescoDeNegocios(
  pool: Pool,
  intervaloMs: number,
  log?: (info: Record<string, unknown>) => void,
): { readonly detener: () => void } {
  let corriendo = false;
  const tick = async (): Promise<void> => {
    if (corriendo) return;
    corriendo = true;
    try {
      const r = await refrescarNegociosDelRuntime(pool);
      log?.({ negociosDelRuntime: 'refrescado', organizaciones: r.organizaciones, at: r.at });
    } catch (e) {
      // El snapshot vigente se conserva: un fallo de lectura no puede desconfigurar a nadie.
      log?.({ negociosDelRuntime: 'refresco_fallido', error: e instanceof Error ? e.message : String(e) });
    } finally {
      corriendo = false;
    }
  };
  const timer = setInterval(() => void tick(), intervaloMs);
  timer.unref?.();
  return { detener: () => clearInterval(timer) };
}

/**
 * Organizaciones con una CAPACIDAD habilitada. Es el descubrimiento que sustituye a la organización fijada en
 * código en los bucles de fondo (monitor de seguridad, ciclo del director).
 */
export function crearDescubridorPorCapacidad(pool: Pool, capacidad: CapacidadNegocio): () => Promise<readonly string[]> {
  const repo = new RepositorioConexiones(pool);
  return () => repo.organizacionesCon(capacidad);
}

/**
 * Elegibilidad por capacidad CON compatibilidad acotada: además de quien la tiene habilitada, se admite a las
 * empresas MIGRADAS que todavía no tienen ninguna fila de capacidades (una migración que no corrió no puede
 * apagarle la ingesta a una empresa que hoy ingiere). Una empresa creada desde la interfaz NO entra por esa
 * puerta: su capacidad tiene que estar habilitada explícitamente.
 *
 * Se aplica sólo a capacidades de LECTURA. Ninguna capacidad que produzca una mutación externa usa esto.
 */
export async function elegiblesPorCapacidad(pool: Pool, capacidad: CapacidadNegocio): Promise<ReadonlySet<string>> {
  const repoC = new RepositorioConexiones(pool);
  const repoN = new RepositorioNegocios(pool);
  const [habilitadas, todasLasFilas, perfiles] = await Promise.all([
    repoC.organizacionesCon(capacidad),
    repoC.todasLasCapacidades(),
    repoN.listarTodos(),
  ]);
  const conFilas = new Set(todasLasFilas.map((c) => c.organizationId));
  const migradasSinFilas = perfiles
    .filter((p) => p.origen === 'MIGRACION' && !conFilas.has(p.organizationId))
    .map((p) => p.organizationId);
  return new Set([...habilitadas, ...migradasSinFilas]);
}

export function crearElegiblesPorCapacidad(pool: Pool, capacidad: CapacidadNegocio): () => Promise<ReadonlySet<string>> {
  return () => elegiblesPorCapacidad(pool, capacidad);
}
