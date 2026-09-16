/**
 * CP Odontología · Growth fase 5.1: alcance comercial 9/9 vs ejecución Google Ads 6/9.
 *
 *  · la regla pura de ejecución en Google Ads (`validarSegmentacionGoogleAdsCp`);
 *  · los 4 borradores versionados llevan el requisito geográfico canónico, y nada más cambió;
 *  · la arquitectura Search sólo segmenta las 6 comunas ejecutables, con Fonasa negativa y sin
 *    bloquear blanqueamiento;
 *  · corregir el requisito por la API gobernada (PATCH) añade un evento y no toca el resto.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { campaniaStreamId } from '@soec/campanias';
import { buildApp } from '../src/app';
import { ALCANCE_COMERCIAL_CP_ODONTOLOGIA } from '../src/plataforma/negocios/org-cp-odontologia';
import {
  COMUNAS_EJECUTABLES_GOOGLE_ADS_CP,
  COMUNAS_NO_EJECUTABLES_GOOGLE_ADS_CP,
  REQUISITO_GEO_GOOGLE_ADS_CP,
  validarSegmentacionGoogleAdsCp,
  type UbicacionGoogleAds,
} from '../src/plataforma/negocios/org-cp-odontologia-google-ads';

const CP = 'org-cp-odontologia';
const leer = (r: string) => JSON.parse(readFileSync(join(__dirname, '../../..', r), 'utf8'));
type Borrador = { campaniaId: string; campania: Record<string, unknown> & { requisitosPrevios: string[] }; decision: Record<string, unknown> };
const ESPEC = leer('docs/growth/cp-odontologia-borradores.json') as { borradores: Borrador[] };
const SEARCH = leer('docs/growth/cp-odontologia-google-search.json') as {
  campania: { segmentacionGeografica: { comunasEjecutablesGoogleAds: string[]; criterioUbicacion: string; unidadesMayoresPermitidas: boolean }; negativasCampania: string[]; grupos: { negativasGrupo: string[] }[] };
};
const comuna = (nombre: string): UbicacionGoogleAds => ({ tipo: 'COMUNA', nombre });

describe('regla geográfica · alcance comercial 9/9, ejecución Google Ads 6/9', () => {
  it('alcance comercial de CP: Provincia de Curicó, 9/9 comunas, presencia', () => {
    expect(ALCANCE_COMERCIAL_CP_ODONTOLOGIA.provincia).toBe('Provincia de Curicó');
    expect([...ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas].sort()).toEqual(
      ['Curicó', 'Teno', 'Romeral', 'Rauco', 'Molina', 'Sagrada Familia', 'Hualañé', 'Licantén', 'Vichuquén'].sort(),
    );
    expect(ALCANCE_COMERCIAL_CP_ODONTOLOGIA.criterioUbicacion).toBe('PRESENCIA');
  });

  it('ejecutable en Google Ads: exactamente 6/9, y las 3 restantes completan la provincia', () => {
    expect([...COMUNAS_EJECUTABLES_GOOGLE_ADS_CP]).toEqual(['Curicó', 'Molina', 'Teno', 'Sagrada Familia', 'Rauco', 'Licantén']);
    expect([...COMUNAS_NO_EJECUTABLES_GOOGLE_ADS_CP]).toEqual(['Romeral', 'Hualañé', 'Vichuquén']);
    expect([...COMUNAS_EJECUTABLES_GOOGLE_ADS_CP, ...COMUNAS_NO_EJECUTABLES_GOOGLE_ADS_CP].sort()).toEqual([...ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas].sort());
    const r = validarSegmentacionGoogleAdsCp(COMUNAS_EJECUTABLES_GOOGLE_ADS_CP.map(comuna), 'PRESENCIA');
    expect(r).toEqual({ ok: true, rechazadas: [], criterioInvalido: false });
  });

  it('Talca (y otras comunas fuera de la provincia) → rechazado', () => {
    for (const ajena of ['Talca', 'Linares', 'Cauquenes', 'Constitución', 'San Fernando']) {
      const r = validarSegmentacionGoogleAdsCp([comuna('Curicó'), comuna(ajena)], 'PRESENCIA');
      expect(r.ok, ajena).toBe(false);
      expect(r.rechazadas).toEqual([{ ubicacion: comuna(ajena), motivo: 'FUERA_DE_LA_PROVINCIA' }]);
    }
  });

  it('Región del Maule completa (o provincia, país, radio) → rechazado', () => {
    for (const u of [
      { tipo: 'REGION', nombre: 'Región del Maule' },
      { tipo: 'PROVINCIA', nombre: 'Provincia de Curicó' },
      { tipo: 'PAIS', nombre: 'Chile' },
      { tipo: 'RADIO', nombre: 'Curicó +30 km' },
    ] as UbicacionGoogleAds[]) {
      const r = validarSegmentacionGoogleAdsCp([u], 'PRESENCIA');
      expect(r.ok, u.nombre).toBe(false);
      expect(r.rechazadas[0]!.motivo).toBe('UNIDAD_MAYOR_QUE_COMUNA');
    }
  });

  it('Romeral, Hualañé y Vichuquén no se añaden a la ejecución Google (están en el alcance comercial)', () => {
    for (const n of ['Romeral', 'Hualañé', 'Vichuquén']) {
      expect(ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas).toContain(n);
      const r = validarSegmentacionGoogleAdsCp([...COMUNAS_EJECUTABLES_GOOGLE_ADS_CP.map(comuna), comuna(n)], 'PRESENCIA');
      expect(r.ok, n).toBe(false);
      expect(r.rechazadas).toEqual([{ ubicacion: comuna(n), motivo: 'NO_EJECUTABLE_EN_GOOGLE_ADS' }]);
    }
  });

  it('sin ubicaciones o con «presencia o interés» → rechazado', () => {
    expect(validarSegmentacionGoogleAdsCp([], 'PRESENCIA').ok).toBe(false);
    expect(validarSegmentacionGoogleAdsCp([comuna('Molina')], 'PRESENCIA_O_INTERES')).toMatchObject({ ok: false, criterioInvalido: true });
  });
});

describe('borradores versionados · requisito geográfico canónico', () => {
  it('los 4 llevan exactamente un requisito territorial, coherente con 9/9 y 6/9; ninguno pide segmentar 9 comunas', () => {
    expect(ESPEC.borradores).toHaveLength(4);
    for (const b of ESPEC.borradores) {
      const geo = b.campania.requisitosPrevios.filter((r) => /segment|comunas|Territorio/i.test(r));
      expect(geo, b.campaniaId).toHaveLength(1);
      expect(geo[0]).toContain(REQUISITO_GEO_GOOGLE_ADS_CP);
      expect(b.campania.requisitosPrevios.join(' ')).not.toMatch(/por las 9 comunas/i);
      expect(b.campania['alcanceGeografico']).toEqual(ALCANCE_COMERCIAL_CP_ODONTOLOGIA);
      expect(b.campania['presupuesto']).toBeNull();
    }
    const carillas = ESPEC.borradores.find((b) => b.campaniaId === 'cp-carillas-estetica-provincia-curico')!;
    expect(carillas.campania['canal']).toBe('ORGANIC_INSTAGRAM');
  });

  it('el requisito canónico nombra las 6 ejecutables y excluye explícitamente las 3 restantes', () => {
    for (const n of COMUNAS_EJECUTABLES_GOOGLE_ADS_CP) expect(REQUISITO_GEO_GOOGLE_ADS_CP).toContain(n);
    expect(REQUISITO_GEO_GOOGLE_ADS_CP).toMatch(/9\/9/);
    expect(REQUISITO_GEO_GOOGLE_ADS_CP).toMatch(/6\/9/);
    expect(REQUISITO_GEO_GOOGLE_ADS_CP).toMatch(/Romeral, Hualañé y Vichuquén no se segmentan/);
    expect(REQUISITO_GEO_GOOGLE_ADS_CP).toMatch(/nunca se segmenta fuera de la Provincia de Curicó/);
  });
});

describe('arquitectura Search · geo, Fonasa y blanqueamiento', () => {
  const c = SEARCH.campania;

  it('la segmentación declarada pasa la regla y no permite unidades mayores', () => {
    const geo = c.segmentacionGeografica;
    expect(validarSegmentacionGoogleAdsCp(geo.comunasEjecutablesGoogleAds.map(comuna), geo.criterioUbicacion).ok).toBe(true);
    expect(geo.unidadesMayoresPermitidas).toBe(false);
  });

  it('FONASA → negativa de campaña', () => {
    for (const n of ['fonasa', 'bono fonasa', 'dentista fonasa', 'dental fonasa']) expect(c.negativasCampania).toContain(n);
  });

  it('blanqueamiento → NO es negativa en ningún nivel', () => {
    const todas = [...c.negativasCampania, ...c.grupos.flatMap((g) => g.negativasGrupo)];
    expect(todas.some((n) => /blanqueamiento/i.test(n))).toBe(false);
  });
});

describe('PATCH gobernado · corregir sólo el requisito geográfico', () => {
  const cab = { 'x-organization-id': CP, 'x-actor-id': 'owner', 'x-scope': 'events:read,events:append', 'x-permissions': 'campaign.manage,campaign.read' };
  const ctx: RequestContext = { organizationId: OrganizationId(CP), actor: ActorId('owner'), scope: { organizationId: OrganizationId(CP), permissions: ['events:read'] }, correlationId: 't' };

  it('reemplaza el requisito, sube la versión con un evento nuevo y deja el resto intacto', async () => {
    const store = new InMemoryEventStore();
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    // Estado anterior tal como estaba en producción: el requisito histórico de «9 comunas».
    const b = ESPEC.borradores.find((x) => x.campaniaId === 'cp-implantes-provincia-curico')!;
    const historicos = b.campania.requisitosPrevios.map((r) =>
      r.includes(REQUISITO_GEO_GOOGLE_ADS_CP)
        ? 'Segmentación geográfica de Google Ads por las 9 comunas de la Provincia de Curicó, con la opción de presencia (personas ubicadas o habitualmente presentes), nunca «presencia o interés».'
        : r,
    );
    const creada = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab, payload: { ...b, campania: { ...b.campania, requisitosPrevios: historicos } } });
    expect(creada.statusCode, creada.body).toBe(201);
    const antes = creada.json().campania;

    const r = await app.inject({ method: 'PATCH', url: `/campanias/${b.campaniaId}/borrador`, headers: cab, payload: { requisitosPrevios: b.campania.requisitosPrevios } });
    expect(r.statusCode, r.body).toBe(200);
    const despues = r.json().campania;

    expect(despues.requisitosPrevios).toEqual(b.campania.requisitosPrevios);
    expect(despues.version).toBe(antes.version + 1);
    const resto = (c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'requisitosPrevios' && k !== 'version'));
    expect(resto(despues)).toEqual(resto(antes));
    expect(despues.estado).toBe('BORRADOR');
    expect(despues.presupuesto).toBeNull();
    expect(r.json().decision.estado).toBe('NO_EVALUABLE');

    // El evento de creación sigue intacto; la corrección es un evento NUEVO.
    const eventos = await store.readStream(ctx, campaniaStreamId(CP, b.campaniaId));
    expect(eventos).toHaveLength(2);
    expect((eventos[0]!.payload as { requisitosPrevios: string[] }).requisitosPrevios).toEqual(historicos);
    await app.close();
  });
});
