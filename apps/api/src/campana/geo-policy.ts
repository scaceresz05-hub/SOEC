/**
 * apps/api · campana · POLÍTICA GEOGRÁFICA (material) del plan V2. Decisión comercial HUMANA aprobada: la campaña
 * se dirige SOLAMENTE a cuatro regiones positivas (no "Chile menos RM"); la Región Metropolitana queda además
 * EXCLUIDA explícitamente como defensa. Matching por PRESENCIA (positiveGeoTargetType/negativeGeoTargetType).
 *
 * Los `criterionId` reales NO se hardcodean: se resuelven en runtime vía GeoTargetConstantService
 * (SuggestGeoTargetConstants, countryCode=CL), verificando country=Chile + targetable + nivel región.
 */
export interface GeoRegion {
  /** Nombre a resolver contra Google (SuggestGeoTargetConstants). */
  readonly nombre: string;
  /** true ⇒ CampaignCriterion location NEGATIVA (excluir). */
  readonly negativa: boolean;
}

export interface GeoPolicy {
  readonly countryCode: 'CL';
  readonly positiveGeoTargetType: 'PRESENCE';
  readonly negativeGeoTargetType: 'PRESENCE';
  readonly regiones: readonly GeoRegion[];
}

/** GEO V1 aprobada para SmileFlow: 4 regiones positivas + RM negativa explícita. NO agregar otras regiones. */
export const GEO_SMILEFLOW_V2: GeoPolicy = {
  countryCode: 'CL',
  positiveGeoTargetType: 'PRESENCE',
  negativeGeoTargetType: 'PRESENCE',
  regiones: [
    { nombre: 'Tarapacá', negativa: false },
    { nombre: 'Antofagasta', negativa: false },
    { nombre: 'La Araucanía', negativa: false },
    { nombre: 'Los Lagos', negativa: false },
    { nombre: 'Región Metropolitana de Santiago', negativa: true },
  ],
};

/** Región con su criterionId ya resuelto por Google (runtime). */
export interface GeoRegionResuelta extends GeoRegion {
  readonly criterionId: string;
  readonly canonicalName: string;
}
