/**
 * @soec/diagnostico — Motor de Diagnóstico (F2-DISC-01, paso 2).
 *
 * Reutiliza la capacidad neutral «Comprender el estado» (@soec/capacidades) sobre una
 * evidencia sintética derivada de respuestas estructuradas, e inyecta el conocimiento
 * del rubro exclusivamente por `RubroKnowledgePort`. Produce una comprensión evaluable
 * (hechos, faltantes, contradicciones) con procedencia. No genera estrategia, no registra
 * objetivos, no toca Preparación/Operación; sin efectos reales; el `EventStore` se inyecta.
 */
export type {
  Respuesta,
  RespuestasDiagnostico,
  HechoComprendido,
  FaltanteDiagnostico,
  ContradiccionDiagnostico,
  OperacionEjecutada,
  ComprensionEvaluable,
} from './domain/tipos';
export type { MotorDiagnostico, MotorDiagnosticoDeps, OpcionesComprender } from './app/motor';
export { crearMotorDiagnostico, componerMotorDiagnostico } from './app/motor';
