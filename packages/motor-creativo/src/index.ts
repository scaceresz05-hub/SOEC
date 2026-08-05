/**
 * @soec/motor-creativo — Motor Creativo Estratégico (M6).
 *
 * PRODUCTOR de dirección creativa gobernada a partir del conocimiento evaluable de M5. Consume M5 solo
 * por `LecturaConocimiento`; reutiliza de M3 (`@soec/estrategia-creativa`) el validador A-3, las variantes
 * A/B, el calendario editorial y la aprobación (sin duplicarlos). No publica, no programa, no gasta.
 *
 * Aporta lo genuinamente nuevo: el CONTEXTO creativo (puente versionado desde M5 con obsolescencia), los
 * TERRITORIOS y MENSAJES tipados trazables a M5, la ABSTENCIÓN creativa de primera clase, la VALIDACIÓN
 * autoritativa (texto + respaldo epistémico) y los contratos de lectura `LecturaCreativa` para M7.
 */
export * from './dominio/abstencion';
export * from './dominio/contexto-creativo';
export * from './dominio/territorio';
export * from './dominio/indice-territorios';
export * from './dominio/mensaje';
export * from './dominio/validacion-autoritativa';
export * from './dominio/vigencia';
export * from './dominio/vigencia-creativa';
export * from './dominio/indice-piezas';
export * from './dominio/solicitud-aprobacion';
export * from './dominio/congelar';
export * from './dominio/errors';
export * from './contratos';
export {
  MotorCreativoService,
  type RolSolicitado,
  type MensajeARespaldar,
} from './app/motor-creativo-service';
export { GobernanzaCreativaService, type ObjetivoMaterializacion } from './app/gobernanza-creativa-service';
export { SolicitudAprobacionService } from './app/solicitud-aprobacion-service';
export { LecturaCreativaService } from './app/lectura-creativa-service';
export {
  PipelineCreativoService,
  type EntradaPipeline,
  type PlanCreativo,
  type EstadoPlan,
  type SolicitudesPlan,
  type ProductorPieza,
} from './app/pipeline-creativo-service';
