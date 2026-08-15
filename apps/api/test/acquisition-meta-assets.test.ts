/**
 * Meta read-only onboarding — preparación sin conexión: aislamiento, allowlist, mapeo de acciones,
 * NOT_CONNECTED≠0 (FASE 37). Sin red, sin tokens, sin efectos.
 */
import { describe, expect, it } from 'vitest';
import {
  refSecretoActivo,
  activosMetaDe,
  saludMetaDe,
  esOperacionLecturaPermitida,
  normalizarAccionMeta,
  esResultadoComercialMeta,
  TOKEN_NO_CONECTADO,
  TIPOS_ACTIVO_META,
} from '../src/acquisition/meta-assets';
import { MetaWriteAdapter } from '../src/acquisition/meta-write-adapter';

describe('Meta assets · aislamiento por tenant y binding explícito', () => {
  it('META_AUTH_TENANT_SCOPED / CYP_CANNOT_BIND_SMILEFLOW_PAGE: refs de secreto distintas por org', () => {
    expect(refSecretoActivo('org-cyp', 'FACEBOOK_PAGE')).toBe('file:org-cyp/meta-page-token');
    expect(refSecretoActivo('org-smileflow', 'FACEBOOK_PAGE')).toBe('file:org-smileflow/meta-page-token');
    expect(refSecretoActivo('org-cyp', 'FACEBOOK_PAGE')).not.toBe(refSecretoActivo('org-smileflow', 'FACEBOOK_PAGE'));
    // Distintos por tipo también.
    expect(refSecretoActivo('org-cyp', 'META_AD_ACCOUNT')).not.toBe(refSecretoActivo('org-cyp', 'FACEBOOK_PAGE'));
  });

  it('META_ASSET_NOT_AUTO_SELECTED_BY_NAME: sin binding ⇒ todos NOT_CONFIGURED (no se inventan activos)', () => {
    const activos = activosMetaDe('org-cyp', 'distribuidora-cyp');
    expect(activos).toHaveLength(TIPOS_ACTIVO_META.length);
    expect(activos.every((a) => a.estado === 'NOT_CONFIGURED' && a.externalId === null)).toBe(true);
    expect(activos.every((a) => a.credentialRefs.length === 0)).toBe(true);
  });

  it('META_ASSET_BINDING_EXPLICIT: sólo con externalId explícito pasa a PENDING_BINDING', () => {
    const activos = activosMetaDe('org-cyp', 'distribuidora-cyp', [{ tipo: 'FACEBOOK_PAGE', externalId: 'page_123', displayName: 'CYP' }]);
    expect(activos.find((a) => a.tipo === 'FACEBOOK_PAGE')?.estado).toBe('PENDING_BINDING');
    expect(activos.find((a) => a.tipo === 'INSTAGRAM_ACCOUNT')?.estado).toBe('NOT_CONFIGURED');
  });
});

describe('Meta assets · NOT_CONNECTED ≠ ZERO y token sin valor', () => {
  it('META_NOT_CONNECTED_IS_NOT_ZERO: sin activos vinculados ⇒ salud NOT_CONNECTED (no 0)', () => {
    expect(saludMetaDe(activosMetaDe('org-cyp', 'distribuidora-cyp'))).toBe('NOT_CONNECTED');
  });

  it('el modelo de token no contiene valor y arranca sin conexión', () => {
    expect(TOKEN_NO_CONECTADO).toEqual({ tipo: 'NONE', issuedAt: null, expiresAt: null, estado: 'NONE' });
    // Sólo metadatos de vigencia; ninguna clave que contenga el valor del token.
    expect(Object.keys(TOKEN_NO_CONECTADO)).not.toContain('valor');
    expect(Object.keys(TOKEN_NO_CONECTADO)).not.toContain('value');
  });
});

describe('Meta assets · allowlist de lectura (default-deny)', () => {
  it('READ_ADAPTER_ONLY_ALLOWLISTED_OPERATIONS: sólo READ_* permitido; escritura ⇒ false', () => {
    expect(esOperacionLecturaPermitida('READ_PAGES')).toBe(true);
    expect(esOperacionLecturaPermitida('READ_AD_INSIGHTS')).toBe(true);
    expect(esOperacionLecturaPermitida('CREATE_CAMPAIGN')).toBe(false);
    expect(esOperacionLecturaPermitida('PUBLISH_POST')).toBe(false);
    expect(esOperacionLecturaPermitida('EDIT_BUDGET')).toBe(false);
  });
});

describe('Meta assets · normalización de acciones (nunca suma-todo)', () => {
  it('META_CLICK_NOT_LEAD / META_ENGAGEMENT_NOT_SALE / UNKNOWN_NOT_COMMERCIAL', () => {
    expect(normalizarAccionMeta('link_click')).toBe('LINK_CLICK');
    expect(esResultadoComercialMeta('LINK_CLICK')).toBe(false);
    expect(normalizarAccionMeta('post_engagement')).toBe('ENGAGEMENT');
    expect(esResultadoComercialMeta('ENGAGEMENT')).toBe(false);
    expect(normalizarAccionMeta('lead')).toBe('LEAD');
    expect(esResultadoComercialMeta('LEAD')).toBe(true);
    expect(normalizarAccionMeta('purchase')).toBe('PURCHASE');
    expect(esResultadoComercialMeta('PURCHASE')).toBe(true);
    // Acción desconocida NO es comercial (no se cuenta como conversión).
    expect(normalizarAccionMeta('algun_action_type_raro')).toBe('UNKNOWN');
    expect(esResultadoComercialMeta('UNKNOWN')).toBe(false);
  });

  it('no suma todas las acciones: cada action_type mapea individualmente', () => {
    const acciones = ['link_click', 'post_engagement', 'lead', 'purchase', 'raro'];
    const comerciales = acciones.map(normalizarAccionMeta).filter(esResultadoComercialMeta);
    expect(comerciales).toEqual(['LEAD', 'PURCHASE']); // sólo 2 comerciales de 5 acciones
  });
});

describe('Meta assets · escritura sigue bloqueada', () => {
  it('WRITE_ADAPTER_REMAINS_LOCKED / AUTONOMOUS_REAL_FALSE_BLOCKS_META_WRITE', () => {
    expect(new MetaWriteAdapter(null).estado()).toBe('NOT_READY');
    expect(MetaWriteAdapter.puedeEjecutarReal).toBe(false);
  });
});
