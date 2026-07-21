/**
 * @soec/models — Núcleo ejecutable de los Modelos MED y MDM.
 *
 * Realiza los contratos de #9/#10/#11 sin redefinirlos: anatomía común de Modelo,
 * afirmaciones y evidencias de primera clase, separación verificable MED ╪ MDM,
 * enlaces explícitos entre representaciones, e historia inmutable con
 * reconstrucción temporal. No integra comprensión (eso es el ECE, #12).
 */
export * from './domain/model';
export * from './domain/errors';
export * from './app/services';
export * from './app/link-service';
export * from './projections/projection';
