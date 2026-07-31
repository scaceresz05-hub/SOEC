/**
 * @soec/contenido-gobernado — Gobierno del contenido por el contexto de campaña (Bloque D del
 * Director de Marketing Autónomo V1). No duplica la fábrica de contenido (`@soec/contenido`):
 * reutiliza su contrato de brief y le impone separación de organización, prohibición de
 * programar/publicar contenido rechazado, versión que preserva la trazabilidad, y publicación
 * estrictamente simulada. Base para la ejecución simulada (Bloque E).
 */
export * from './domain/contenido-gobernado';
export * from './domain/errors';
export * from './app/contenido-gobernado-service';
