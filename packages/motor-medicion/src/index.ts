/**
 * @soec/motor-medicion — M8 · Motor de Medición, Aprendizaje y Conocimiento Operacional.
 *
 * Transforma los resultados operacionales de M7 (`LecturaOperativa`) en observación, medición, evaluación
 * de resultado e hipótesis, atribución cauta, aprendizaje canónico (@soec/aprendizaje) y recomendaciones
 * explicables — para que M9 decida. M8 NO ejecuta, NO modifica la historia y NO optimiza automáticamente.
 * Separa: esperado ╪ ejecutado ╪ observado ╪ medido ╪ atribuible ╪ inferido ╪ aprendido ╪ desconocido.
 * Todo SIMULADO/ESTIMADO — nunca REAL; `AUTONOMOUS_REAL` bloqueado. Reutiliza @soec/medicion,
 * @soec/aprendizaje y las hipótesis/epistemología de @soec/motor-estrategico; no crea máquinas paralelas.
 */
export * from './dominio/observacion';
export * from './dominio/evaluacion-resultado';
export * from './dominio/evaluacion-hipotesis';
export * from './dominio/atribucion-op';
export * from './dominio/recomendacion';
export * from './dominio/consolidacion';
export * from './dominio/evaluacion-operacion';
export * from './dominio/errors';
export * from './contratos';
export * from './app/observacion-service';
export * from './app/evaluacion-service';
export * from './app/aprendizaje-op-service';
export * from './app/lectura-m9-service';
export * from './app/reconciliador-medicion-service';
