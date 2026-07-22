/**
 * Proveedor generativo DETERMINISTA (F2-CONT-01 §9.2) — el proveedor por defecto
 * de las pruebas y del flujo local. Reproducible (sin azar), sin internet ni
 * credenciales. NO es "IA real": es un fixture que realiza el puerto generativo y
 * permite escenarios válidos, malformados, con afirmación prohibida, timeout y error.
 *
 * Modela la desconfianza del §9: su salida puede violar restricciones (p. ej. un
 * gancho promocional prohibido en un anuncio); es el sistema, no el proveedor, quien
 * valida. La lista `evitar` de la solicitud permite a la revisión guiar una nueva pasada.
 */
import type { RequestContext } from '@soec/contracts';
import type {
  ProveedorGenerativo,
  RespuestaGenerativa,
  SalidaGenerada,
  SolicitudGenerativa,
} from '../domain/generative';

const TIEMPO_LOGICO = '2020-01-01T00:00:00.000Z'; // marca de tiempo lógica del fixture (no azar, no Date.now)

/** Glosario mínimo es→en para demostrar localización que preserva el significado. */
const GLOSARIO_EN: Readonly<Record<string, string>> = {
  mantención: 'maintenance',
  'mantención preventiva': 'preventive maintenance',
  edificios: 'buildings',
  administradores: 'managers',
  cotización: 'quote',
  confiable: 'reliable',
  respuesta: 'response',
  servicio: 'service',
  solicita: 'request',
  ahora: 'now',
};

function acorta(texto: string, limite: number): string {
  if (limite <= 0 || texto.length <= limite) return texto;
  return `${texto.slice(0, Math.max(0, limite - 1)).trimEnd()}…`;
}

function traducir(texto: string): string {
  let out = texto;
  for (const [es, en] of Object.entries(GLOSARIO_EN)) {
    out = out.replace(new RegExp(es, 'gi'), en);
  }
  return out;
}

/** Une segmentos descartando los que contengan una subcadena a evitar (case-insensitive). */
function ensamblar(segmentos: readonly string[], evitar: readonly string[]): string {
  const limpio = segmentos
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !evitar.some((e) => e && s.toLowerCase().includes(e.toLowerCase())));
  return limpio.join(' ');
}

export class ProveedorGenerativoDeterminista implements ProveedorGenerativo {
  readonly nombre = 'determinista';
  readonly version = '0.1.0';

  async generar(_ctx: RequestContext, s: SolicitudGenerativa, signal?: AbortSignal): Promise<RespuestaGenerativa> {
    const base = {
      proveedorLogico: this.nombre,
      modeloLogico: `${this.nombre}@${this.version}`,
      generadoEn: TIEMPO_LOGICO,
      promptRef: s.promptRef,
      uso: { unidades: 1, costoEstimado: 1 },
    };

    if (signal?.aborted) return { ...base, estado: 'error', salida: null, advertencias: ['cancelada'] };

    // Escenarios controlados para pruebas de robustez (§23.2).
    const forzar = s.contexto['_forzar'];
    if (forzar === 'timeout') return { ...base, estado: 'timeout', salida: null, advertencias: ['tiempo de espera agotado (simulado)'] };
    if (forzar === 'error') return { ...base, estado: 'error', salida: null, advertencias: ['fallo del proveedor (simulado)'] };
    if (forzar === 'malformada') {
      // Falta un campo del esquema → el sistema debe rechazarla.
      return { ...base, estado: 'valida', salida: { campos: {}, listas: {} }, advertencias: ['salida incompleta (simulado)'] };
    }

    const c = s.contexto;
    const evitar = s.evitar;
    const lim = s.limiteCaracteres;
    let salida: SalidaGenerada;

    if (s.tarea === 'pieza_fuente') {
      const audiencia = c['audiencia'] ?? 'la audiencia';
      const problema = c['problemaCliente'] ?? '';
      const valor = c['propuestaValor'] ?? '';
      const producto = c['productoServicio'] ?? '';
      const mensaje = c['mensajePrincipal'] ?? valor;
      const cta = c['llamadaAccion'] ?? 'Solicita más información';
      const cuerpo = ensamblar(
        [
          `Para ${audiencia}, ${problema ? `${problema}.` : ''}`,
          `${producto} ofrece ${valor}.`,
          mensaje ? `${mensaje}.` : '',
        ],
        evitar,
      );
      salida = {
        campos: {
          tituloInterno: acorta(`${producto} para ${audiencia}`, 0),
          tesis: acorta(mensaje, 0),
          mensaje: acorta(mensaje, 0),
          cuerpo,
          llamadaAccion: cta,
        },
        listas: {
          estructura: ['apertura', 'problema', 'propuesta', 'cierre'],
          hechos: producto ? [producto] : [],
        },
      };
    } else if (s.tarea === 'adaptacion_canal') {
      const formato = c['formato'] ?? 'post_social';
      const titulo = c['titulo'] ?? c['tituloInterno'] ?? '';
      const mensaje = c['mensaje'] ?? '';
      const valor = c['propuestaValor'] ?? '';
      const cta = c['llamadaAccion'] ?? 'Solicita una cotización';
      const gancho = c['ganchoPromocional'] ?? ''; // en anuncios puede violar la política (desconfianza)
      const segmentos = formato === 'anuncio' ? [gancho, valor, cta] : [mensaje || valor, valor, cta];
      const cuerpo = acorta(ensamblar(segmentos, evitar), lim);
      const hashtagsRaw = c['hashtags'] ? c['hashtags'].split(',').map((x) => x.trim()).filter(Boolean) : [];
      salida = {
        campos: {
          titulo: acorta(titulo, 0),
          cuerpo,
          descripcion: acorta(valor, 160),
          llamadaAccion: cta,
        },
        listas: { hashtags: hashtagsRaw },
      };
    } else if (s.tarea === 'traduccion') {
      const cuerpo = c['cuerpo'] ?? '';
      const titulo = c['titulo'] ?? '';
      const cta = c['llamadaAccion'] ?? '';
      salida = {
        campos: {
          titulo: traducir(titulo),
          cuerpo: acorta(traducir(cuerpo), lim),
          llamadaAccion: traducir(cta),
        },
        listas: {},
      };
    } else {
      const mensaje = c['mensajePrincipal'] ?? c['propuestaValor'] ?? '';
      salida = { campos: { mensaje: acorta(mensaje, lim) }, listas: {} };
    }

    return { ...base, estado: 'valida', salida, advertencias: [] };
  }
}
