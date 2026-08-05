/**
 * @soec/crm-comercial · test · M5 · ampliaciones ADITIVAS del dominio comercial descriptivo.
 *
 * Cierra los pendientes descriptivos de la auditoría de cobertura de M5 SIN crear modelos paralelos:
 * Mercado (segmentos/tamaño/barreras), Competidor (diferenciadores/riesgos), y los nuevos perfiles
 * tipados Buyer Persona, Propuesta de Valor y KPI (meta/umbral/responsable). La EXISTENCIA canónica
 * sigue en `@soec/negocio` por el MISMO id (frontera SSOT H-3).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoService as NegocioConocimientoService } from '@soec/negocio';
import { ConocimientoComercialService } from '../src/app/conocimiento-service';
import { ESQUEMAS, claveValida, coberturaDe, raizEmpresa } from '../src/domain/perfiles';

const attr: Attribution = { source: 'crm', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

describe('M5 aditivos · esquemas ampliados', () => {
  it('Mercado incluye segmentos, tamaño y barreras; Competidor incluye diferenciadores y riesgos', () => {
    for (const k of ['segmentos', 'tamano', 'barreras']) expect(ESQUEMAS.MERCADO).toContain(k);
    for (const k of ['diferenciadores', 'riesgos']) expect(ESQUEMAS.COMPETIDOR).toContain(k);
  });

  it('nuevos perfiles tipados con sus campos mínimos del Bloque Maestro', () => {
    expect(ESQUEMAS.BUYER_PERSONA).toEqual(expect.arrayContaining(['rol', 'objetivos', 'dolores', 'objeciones', 'nivelDecision']));
    expect(ESQUEMAS.PROPUESTA_VALOR).toEqual(expect.arrayContaining(['beneficios', 'problemasResueltos', 'diferenciadores', 'prueba']));
    expect(ESQUEMAS.KPI).toEqual(expect.arrayContaining(['meta', 'umbral', 'responsable']));
  });

  it('claveValida respeta el esquema del nuevo tipo (acepta lo del esquema, rechaza lo ajeno)', () => {
    expect(claveValida('KPI', 'meta')).toBe(true);
    expect(claveValida('KPI', 'color_favorito')).toBe(false);
    expect(claveValida('BUYER_PERSONA', 'rol')).toBe(true);
  });
});

describe('M5 aditivos · frontera SSOT (crm tipado ↔ negocio canónico)', () => {
  it('registrar un Buyer Persona asegura su existencia canónica en @soec/negocio con el MISMO id', async () => {
    const store = new InMemoryEventStore();
    const crm = new ConocimientoComercialService(store);
    const c = ctx();
    await crm.registrarEntidad(c, 'bp-1', 'BUYER_PERSONA', 'Gerente Comercial', attr, O);
    await crm.establecerCampo(c, 'bp-1', 'rol', 'decisor de compra', 'DATO_DECLARADO_POR_USUARIO', attr, O);

    const state = await crm.cargar(c);
    const bp = state.entidades['bp-1'];
    expect(bp?.tipo).toBe('BUYER_PERSONA');
    const cob = coberturaDe(bp!);
    expect(cob.presentes).toContain('rol');
    expect(cob.completitud).toBeGreaterThan(0);

    // SSOT de existencia en negocio, mismo id, tipo mapeado (no una segunda base):
    const neg = await new NegocioConocimientoService(store).cargar(c);
    expect(neg.items['bp-1']?.tipo).toBe('BUYER_PERSONA');
  });

  it('la Empresa es la raíz singleton (raizEmpresa): null antes de registrar, la entidad después', async () => {
    const store = new InMemoryEventStore();
    const crm = new ConocimientoComercialService(store);
    const c = ctx();
    expect(raizEmpresa(await crm.cargar(c))).toBeNull(); // ausencia declarada, no conclusión
    await crm.registrarEntidad(c, 'empresa', 'EMPRESA', 'Acme SpA', attr, O);
    const raiz = raizEmpresa(await crm.cargar(c));
    expect(raiz?.tipo).toBe('EMPRESA');
    expect(raiz?.nombre).toBe('Acme SpA');
  });

  it('registrar un KPI con meta/umbral/responsable lo asienta como INDICADOR canónico', async () => {
    const store = new InMemoryEventStore();
    const crm = new ConocimientoComercialService(store);
    const c = ctx();
    await crm.registrarEntidad(c, 'kpi-cac', 'KPI', 'Costo de Adquisición', attr, O);
    await crm.establecerCampo(c, 'kpi-cac', 'meta', 'bajar a $30.000', 'DATO_DECLARADO_POR_USUARIO', attr, O);
    await crm.establecerCampo(c, 'kpi-cac', 'responsable', 'Jefatura Comercial', 'DATO_DECLARADO_POR_USUARIO', attr, O);
    const neg = await new NegocioConocimientoService(store).cargar(c);
    expect(neg.items['kpi-cac']?.tipo).toBe('INDICADOR');
    const kpi = (await crm.cargar(c)).entidades['kpi-cac'];
    expect(coberturaDe(kpi!).presentes).toEqual(expect.arrayContaining(['meta', 'responsable']));
  });
});
