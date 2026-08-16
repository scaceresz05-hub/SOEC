/**
 * Meta read-only onboarding — modelo endurecido tras el discovery real (FASE 13). Sin red, sin tokens.
 */
import { describe, expect, it } from 'vitest';
import {
  refSecretoActivo,
  activosMetaDe,
  saludMetaDe,
  esOperacionLecturaPermitida,
  normalizarAccionMeta,
  esResultadoComercialMeta,
  clasificarFundacion,
  TOKEN_NO_CONECTADO,
  TIPOS_ACTIVO_META,
  type CapacidadesMeta,
} from '../src/acquisition/meta-assets';
import { descubrimientoMetaDe, ACTIVOS_EXTERNOS_NO_VINCULADOS } from '../src/acquisition/meta-discovery';
import { MetaWriteAdapter } from '../src/acquisition/meta-write-adapter';

describe('Meta assets · aislamiento por tenant y binding explícito', () => {
  it('refs de secreto distintas por org y por tipo (cross-tenant fail-closed)', () => {
    expect(refSecretoActivo('org-cyp', 'FACEBOOK_PAGE')).toBe('file:org-cyp/meta-page-token');
    expect(refSecretoActivo('org-cyp', 'FACEBOOK_PAGE')).not.toBe(refSecretoActivo('org-smileflow', 'FACEBOOK_PAGE'));
    expect(refSecretoActivo('org-cyp', 'META_AD_ACCOUNT')).not.toBe(refSecretoActivo('org-cyp', 'FACEBOOK_PAGE'));
  });

  it('BINDING_BY_NAME_PROHIBITED / EXISTING_ASSET != SOEC_CONNECTED: aun con externalId, SOEC no se vincula', () => {
    const activos = activosMetaDe('org-smileflow', 'smileflow-clinic', [
      { tipo: 'FACEBOOK_PAGE', externalId: '61570785690749', externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
    ]);
    const page = activos.find((a) => a.tipo === 'FACEBOOK_PAGE');
    expect(page?.externalStatus).toBe('EXISTS'); // existe en Meta
    expect(page?.estado).toBe('NOT_CONFIGURED'); // pero SOEC NO conectado
    expect(page?.requiresConfirmation).toBe(true); // binding exige confirmación humana
  });
});

describe('Meta assets · Instagram Profile ID ≠ IGSID (canónicos verificados)', () => {
  it('el profile id (UI) es DISTINTO del IGSID (Graph); ambos verificados por separado', () => {
    const d = descubrimientoMetaDe('org-smileflow');
    const profile = d?.activos.find((a) => a.tipo === 'INSTAGRAM_PROFILE');
    const igsid = d?.activos.find((a) => a.tipo === 'INSTAGRAM_BUSINESS_ACCOUNT');
    expect(profile?.externalId).toBe('33006160107'); // Profile ID (UI)
    expect(igsid?.externalId).toBe('17841432883225770'); // IGSID canónico (Graph)
    expect(profile?.externalId).not.toBe(igsid?.externalId); // NUNCA se confunden
  });
});

describe('Meta assets · capacidades independientes (Ads restringido no cascada)', () => {
  it('ADS_RESTRICTED_DOES_NOT_RESTRICT_ORGANIC / foundation FRAGMENTED_RESTRICTED_RECOVERABLE, no CLEAN_REBUILD', () => {
    const d = descubrimientoMetaDe('org-smileflow')!;
    expect(d.capacidades.META_ADS).toBe('RESTRICTED');
    expect(d.capacidades.ORGANIC_INSTAGRAM).toBe('AVAILABLE'); // NO se restringe por Ads
    expect(d.capacidades.ORGANIC_FACEBOOK).toBe('AVAILABLE');
    expect(d.claseFundacion).toBe('FRAGMENTED_RESTRICTED_RECOVERABLE');
    expect(d.claseFundacion).not.toBe('CLEAN_REBUILD');
  });

  it('CLEAN_REBUILD nunca se deriva sólo de una restricción de Ads', () => {
    const soloAdsRestringido: CapacidadesMeta = {
      ORGANIC_FACEBOOK: 'AVAILABLE',
      ORGANIC_INSTAGRAM: 'AVAILABLE',
      META_ADS: 'RESTRICTED',
      LEAD_ADS: 'RESTRICTED',
      API_READ: 'NOT_CONNECTED',
      API_WRITE: 'NOT_CONNECTED',
    };
    expect(clasificarFundacion(soloAdsRestringido)).not.toBe('CLEAN_REBUILD');
  });
});

describe('Meta assets · CYP ausente y SC Topografía no vinculada', () => {
  it('CYP_FOUNDATION_ABSENT bajo el perfil inspeccionado', () => {
    const d = descubrimientoMetaDe('org-cyp')!;
    expect(d.claseFundacion).toBe('FOUNDATION_ABSENT');
    expect(d.activos.every((a) => a.estado === 'NOT_CONFIGURED')).toBe(true);
    expect(d.soecGraphConnection).toBe('NOT_CONNECTED');
  });

  it('SC_TOPOGRAFIA_NOT_AUTO_BOUND: mismo humano ≠ tenant collision; DO_NOT_BIND', () => {
    const sc = ACTIVOS_EXTERNOS_NO_VINCULADOS.find((a) => a.pageId === '100095553750707');
    expect(sc?.binding).toBe('DO_NOT_BIND');
    expect(sc?.boundToSoecOrg).toBeNull();
    // Distintos negocios bajo el mismo admin NO colisionan: descubrimientos independientes.
    expect(descubrimientoMetaDe('org-smileflow')?.organizationId).toBe('org-smileflow');
    expect(descubrimientoMetaDe('org-cyp')?.organizationId).toBe('org-cyp');
  });
});

describe('Meta assets · App confirmada; Dataset aún sin distinguir', () => {
  it('App 972064645294895 OBSERVED; relación con Dataset REQUIRES_VERIFICATION', () => {
    const d = descubrimientoMetaDe('org-smileflow')!;
    expect(d.appDatasetColision).toBe('APP_CONFIRMED_DATASET_UNVERIFIED');
    const app = d.activos.find((a) => a.tipo === 'META_APP');
    expect(app?.externalId).toBe('972064645294895');
    expect(app?.procedencia).toBe('OBSERVED');
  });
});

describe('Meta assets · evidencia Graph verificada (discriminación de Pages)', () => {
  it('RESTRICTION_DOES_NOT_PROPAGATE_TO_GRAPH_READ: el nodo del negocio se lee (200) pese a la restricción', () => {
    const d = descubrimientoMetaDe('org-smileflow')!;
    expect(d.businessGraphReadable).toBe(true);
    expect(d.restrictionPropagatesToGraphRead).toBe('NO');
  });

  it('OWNED_PAGES_GRANTED_WITH_business_management', () => {
    const d = descubrimientoMetaDe('org-smileflow')!;
    expect(d.businessOwnedPageReadGate).toBe('GRANTED');
    expect(d.businessManagementStatus).toBe('GRANTED');
  });

  it('CANONICAL_PAGE_ID ≠ LEGACY_UI_ID: el Graph Page ID es 1066708446525633; el de UI NO se usa', () => {
    const d = descubrimientoMetaDe('org-smileflow')!;
    expect(d.smileflowGraphPageId).toBe('1066708446525633'); // canónico
    expect(d.smileflowLegacyPageUiId).toBe('61570785690749'); // id de UI (histórico)
    expect(d.smileflowGraphPageId).not.toBe(d.smileflowLegacyPageUiId);
    const page = d.activos.find((a) => a.tipo === 'FACEBOOK_PAGE');
    expect(page?.externalId).toBe('1066708446525633'); // se usa el canónico, no el de UI
  });

  it('READ_FOUNDATION = RECOVER_EXISTING_APP; ADS_READ = PASS pero write/lead LOCKED/NOT_TESTED', () => {
    const d = descubrimientoMetaDe('org-smileflow')!;
    expect(d.readFoundation).toBe('RECOVER_EXISTING_APP');
    expect(d.adsFoundation).toBe('RECOVER_EXISTING'); // ads_read PASS sobre la app existente
    expect(d.matrizLectura.INSTAGRAM_MEDIA_INSIGHTS).toBe('PASS');
    expect(d.matrizLectura.ADS_READ).toBe('PASS');
    expect(d.matrizLectura.LEAD_ADS_READ).toBe('NOT_TESTED'); // ads read ╪ lead retrieval
    expect(d.matrizLectura.INSTAGRAM_AUDIENCE_DEMOGRAPHICS).toBe('NO_DATA'); // no FAIL
    expect(d.matrizLectura.META_WRITE).toBe('LOCKED');
    expect(d.mediaCount).toBe(11);
  });
});

describe('Meta assets · NOT_CONNECTED/RESTRICTED/UNKNOWN ≠ 0 y token sin valor', () => {
  it('sin activos vinculados ⇒ NOT_CONNECTED (no 0); error/restricted no son "sin datos"', () => {
    expect(saludMetaDe(activosMetaDe('org-smileflow', 'smileflow-clinic'))).toBe('NOT_CONNECTED');
  });
  it('token model sin valor', () => {
    expect(TOKEN_NO_CONECTADO).toEqual({ tipo: 'NONE', issuedAt: null, expiresAt: null, estado: 'NONE' });
    expect(Object.keys(TOKEN_NO_CONECTADO)).not.toContain('valor');
  });
});

describe('Meta assets · allowlist de lectura y mapeo de acciones', () => {
  it('READ_ONLY_ALLOWLIST: sólo READ_* permitido; escritura ⇒ false', () => {
    expect(esOperacionLecturaPermitida('READ_PAGES')).toBe(true);
    expect(esOperacionLecturaPermitida('READ_LEAD_FORMS_METADATA')).toBe(true);
    expect(esOperacionLecturaPermitida('CREATE_CAMPAIGN')).toBe(false);
    expect(esOperacionLecturaPermitida('PUBLISH_POST')).toBe(false);
  });
  it('META_CLICK_NOT_LEAD / ENGAGEMENT_NOT_SALE / UNKNOWN_NOT_COMMERCIAL', () => {
    expect(normalizarAccionMeta('link_click')).toBe('LINK_CLICK');
    expect(esResultadoComercialMeta('LINK_CLICK')).toBe(false);
    expect(esResultadoComercialMeta('ENGAGEMENT')).toBe(false);
    expect(esResultadoComercialMeta(normalizarAccionMeta('lead'))).toBe(true);
    expect(normalizarAccionMeta('raro')).toBe('UNKNOWN');
    expect(esResultadoComercialMeta('UNKNOWN')).toBe(false);
  });
});

describe('Meta assets · escritura bloqueada + tipos completos', () => {
  it('WRITE_ADAPTER_REMAINS_LOCKED', () => {
    expect(new MetaWriteAdapter(null).estado()).toBe('NOT_READY');
    expect(MetaWriteAdapter.puedeEjecutarReal).toBe(false);
  });
  it('el modelo representa los activos distintos (Profile/IGSID/Dataset/App/WhatsApp/LeadForm separados)', () => {
    expect(TIPOS_ACTIVO_META).toContain('INSTAGRAM_PROFILE');
    expect(TIPOS_ACTIVO_META).toContain('INSTAGRAM_BUSINESS_ACCOUNT');
    expect(TIPOS_ACTIVO_META).toContain('DATASET');
    expect(TIPOS_ACTIVO_META).toContain('WHATSAPP_BUSINESS_ACCOUNT');
    expect(TIPOS_ACTIVO_META).toContain('LEAD_FORM');
  });
});
