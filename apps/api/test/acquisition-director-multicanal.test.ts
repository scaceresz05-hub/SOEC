/**
 * Director multicanal SHADOW — objective-first, channel-second, no Meta por defecto (FASE 9-11).
 */
import { describe, expect, it } from 'vitest';
import { razonarAdquisicionShadow } from '../src/adquisicion/director-multicanal';
import type { EntradaPlanner } from '@soec/adquisicion';

const SMILEFLOW: EntradaPlanner = {
  organizationId: 'org-smileflow',
  objetivo: 'GENERATE_LEADS',
  medicionEvaluable: true,
  canales: [
    { canal: 'GOOGLE_SEARCH', estado: 'CONNECTED_READ_ONLY' },
    { canal: 'META_INSTAGRAM', estado: 'NOT_CONFIGURED' },
    { canal: 'ORGANIC_INSTAGRAM', estado: 'NOT_CONFIGURED' },
  ],
  tieneBrandPolicy: true,
  tieneStopLoss: true,
  tieneMandatoPresupuesto: false,
};

const CYP: EntradaPlanner = {
  organizationId: 'org-cyp',
  objetivo: 'GENERATE_SALES',
  medicionEvaluable: false,
  canales: [
    { canal: 'META_INSTAGRAM', estado: 'NOT_CONFIGURED' },
    { canal: 'WEBSITE', estado: 'NOT_CONFIGURED' },
  ],
  tieneBrandPolicy: false,
  tieneStopLoss: false,
  tieneMandatoPresupuesto: false,
};

describe('Director multicanal SHADOW', () => {
  it('DIRECTOR_OBJECTIVE_FIRST_CHANNEL_SECOND: veredicto de negocio + detalle por canal', () => {
    const v = razonarAdquisicionShadow(SMILEFLOW);
    expect(v.objetivo).toBe('GENERATE_LEADS');
    expect(v.veredicto).toBe('APPROVAL_REQUIRED'); // Google conectado, sin mandato de presupuesto
    expect(v.porCanal.find((c) => c.canal === 'GOOGLE_SEARCH')?.tieneLectura).toBe(true);
    expect(v.recomendacion).toBeNull();
    expect(v.naturaleza).toBe('SHADOW');
  });

  it('no recomienda Meta por defecto: Meta aparece NOT_CONFIGURED sin lectura', () => {
    const v = razonarAdquisicionShadow(SMILEFLOW);
    const meta = v.porCanal.find((c) => c.canal === 'META_INSTAGRAM');
    expect(meta?.estado).toBe('NOT_CONFIGURED');
    expect(meta?.tieneLectura).toBe(false);
    expect(meta?.naturaleza).toBe('PAID');
  });

  it('CYP sin medición ⇒ FOUNDATION_REQUIRED (no fuerza campaña Meta)', () => {
    const v = razonarAdquisicionShadow(CYP);
    expect(v.veredicto).toBe('FOUNDATION_REQUIRED');
    expect(v.recomendacion).toBeNull();
  });
});
