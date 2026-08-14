/**
 * @soec/autonomia — Política de autonomía y modo seguro (Bloque H del Director de Marketing
 * Autónomo V1). Es el guardián que gobierna las acciones con efecto de los Bloques C/D/E:
 * ninguna corre sin autorización válida; la PAUSA prevalece sobre toda aprobación; SOEC no
 * eleva su propia autonomía; las aprobaciones vencidas o de otra org no autorizan; una acción
 * iniciada antes de una pausa no continúa en silencio; y reanudar exige actor humano con traza.
 */
export * from './domain/autonomia';
export * from './domain/errors';
export * from './app/autonomia-service';

// ── Mandato de autonomía por organización + Modo Sombra (FASE A0) ──────────────
export * from './mandato/acciones';
export * from './mandato/mandato';
export * from './mandato/gates';
export * from './mandato/elegibilidad';
export * from './mandato/sombra';
