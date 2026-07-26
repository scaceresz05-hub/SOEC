/**
 * @soec/evaluacion — Captura real del Director (F2-DISC-03).
 *
 * Reemplaza el diagnóstico sembrado por la captura gobernada de respuestas a las preguntas
 * del rubro: aggregate event-sourced por Organización + Departamento, borrador durable y
 * reanudable, normalización SEGURA (nunca asume booleanos ambiguos), evidencia original
 * conservada, y generaciones de comprensión congeladas (proyección a `RespuestasDiagnostico`
 * + huella) que alimentan Diagnóstico→Estrategia sin alterar la procedencia de decisiones
 * ya congeladas. No ejecuta Diagnóstico/Estrategia (eso es la capa de experiencia).
 */
export * from './domain/evaluacion';
export * from './domain/errors';
export * from './app/evaluacion-service';
