/**
 * Adaptador de canal SIMULADO y determinista. No abre conexiones ni SDK reales: dado un
 * escenario, devuelve siempre el mismo resultado (sin azar ni reloj). El escenario se resuelve
 * de la petición o, si no viene, del valor por defecto configurado para el canal. Este es el
 * único punto por donde "sale" una ejecución, y siempre está etiquetado como simulado.
 */
import { type EscenarioEjecucion, type ResultadoEjecucion, resultadoDeEscenario, esReintentable } from './ejecucion';

export interface PeticionAdaptador {
  readonly canal: string;
  readonly contenidoId: string;
  readonly idempotencyKey: string;
  /** Escenario explícito; si se omite, el adaptador usa su escenario por defecto. */
  readonly escenario?: EscenarioEjecucion;
}

export interface RespuestaAdaptador {
  readonly adaptador: string;
  readonly escenario: EscenarioEjecucion;
  readonly resultado: ResultadoEjecucion;
  readonly reintentable: boolean;
  readonly simulado: true;
  readonly mensaje: string;
}

export interface AdaptadorCanalSimulado {
  readonly nombre: string;
  publicar(peticion: PeticionAdaptador): RespuestaAdaptador;
}

/** Adaptador determinista con escenarios configurables por canal (y override por petición). */
export class AdaptadorSimuladoDeterminista implements AdaptadorCanalSimulado {
  readonly nombre: string;
  private readonly porDefecto: EscenarioEjecucion;
  private readonly porCanal: Readonly<Record<string, EscenarioEjecucion>>;

  constructor(nombre = 'adaptador-simulado', porDefecto: EscenarioEjecucion = 'SUCCESS', porCanal: Record<string, EscenarioEjecucion> = {}) {
    this.nombre = nombre;
    this.porDefecto = porDefecto;
    this.porCanal = porCanal;
  }

  publicar(peticion: PeticionAdaptador): RespuestaAdaptador {
    const escenario = peticion.escenario ?? this.porCanal[peticion.canal] ?? this.porDefecto;
    const resultado = resultadoDeEscenario(escenario);
    return {
      adaptador: this.nombre,
      escenario,
      resultado,
      reintentable: esReintentable(escenario),
      simulado: true,
      mensaje: `[SIMULADO] ${this.nombre} · canal ${peticion.canal} · escenario ${escenario} · resultado ${resultado}`,
    };
  }
}
