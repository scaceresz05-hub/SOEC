/**
 * LISTADO de campañas de UNA organización, leído del EventStore existente. No hay read-model propio ni
 * persistencia paralela: la fuente de verdad son los streams `campania:<org>:<id>` que ya escribe
 * `@soec/campanias`, y cada campaña se reconstruye después con `CampaniaService.cargar`.
 *
 * Por qué hace falta: el puerto `EventStore` sólo lee un stream por id; no enumera. Las campañas en
 * borrador de CP existían en PostgreSQL pero no había forma gobernada de descubrirlas sin conocer su id.
 *
 * Dos implementaciones, elegidas por el TIPO REAL del store y no por la mera presencia de un pool:
 *   · PostgreSQL: el mismo patrón de prefijo que usan los projection-runners del repo
 *     (`stream_id like 'prefijo:%'`), acotado además por `organization_id`.
 *   · En memoria: a partir del log exportado del store (pruebas y desarrollo).
 * Si el store es otro, no se lista: se responde que el listado no está disponible, nunca una lista vacía
 * que parezca "no hay campañas".
 *
 * AISLAMIENTO: la organización la aporta el llamante desde el contexto autenticado. El filtro es doble
 * —`organization_id` y el prefijo del stream, que lleva la organización— y la carga posterior vuelve a
 * leer dentro de esa organización.
 */
import type { Pool } from 'pg';
import type { EventStore } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { PgEventStore } from '@soec/event-store/pg';
import { campaniaStreamId } from '@soec/campanias';

export interface ListadorCampanias {
  /** Ids de campaña de la organización, ordenados. */
  idsDe(organizacionId: string): Promise<readonly string[]>;
}

/** Escapa los comodines de LIKE para que un id de organización nunca actúe como patrón. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function listadorCampaniasPg(pool: Pool): ListadorCampanias {
  return {
    async idsDe(organizacionId) {
      const prefijo = campaniaStreamId(organizacionId, '');
      const { rows } = await pool.query<{ stream_id: string }>(
        `select distinct stream_id from events
          where organization_id = $1 and stream_id like $2 escape '\\'
          order by stream_id`,
        [organizacionId, `${escaparLike(prefijo)}%`],
      );
      return rows.map((r) => r.stream_id.slice(prefijo.length)).filter((id) => id.length > 0);
    },
  };
}

export function listadorCampaniasEnMemoria(store: InMemoryEventStore): ListadorCampanias {
  return {
    async idsDe(organizacionId) {
      // Las claves del log son `<org>::<streamId>`.
      const prefijo = `${organizacionId}::${campaniaStreamId(organizacionId, '')}`;
      return Object.keys(store.exportar())
        .filter((k) => k.startsWith(prefijo))
        .map((k) => k.slice(prefijo.length))
        .filter((id) => id.length > 0)
        .sort();
    },
  };
}

/**
 * Elige la implementación coherente con el store que usa la app. Con un `PgEventStore`, el pool es el de
 * la app (el mismo con el que se construyó el store en `server.ts`). `null` ⇒ listado no disponible.
 */
export function crearListadorCampanias(store: EventStore, pool: Pool | undefined): ListadorCampanias | null {
  if (store instanceof PgEventStore && pool) return listadorCampaniasPg(pool);
  if (store instanceof InMemoryEventStore) return listadorCampaniasEnMemoria(store);
  return null;
}
