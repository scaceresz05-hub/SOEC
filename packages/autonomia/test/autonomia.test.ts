/**
 * Autonomía y modo seguro (Bloque H, crítico). Verifica cada invariante de seguridad:
 *   - ninguna acción gobernada procede sin autorización válida (las 6 acciones);
 *   - la PAUSA prevalece incluso sobre una aprobación previa;
 *   - SOEC no puede elevar su propia autonomía;
 *   - una aprobación vencida no autoriza;
 *   - una aprobación de otra organización no autoriza;
 *   - una acción iniciada antes de una PAUSA no puede continuar tras ella;
 *   - reanudar exige actor humano y deja traza.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import {
  AutonomiaService,
  AutonomiaNoAutoElevableError,
  AutonomiaInvalidaError,
  ReanudacionSinActorHumanoError,
  ACCIONES_GOBERNADAS,
  type AccionGobernada,
} from '../src/index';

const t0 = '2026-07-30T00:00:00.000Z';
const futuro = '2026-08-30T00:00:00.000Z';
const pasado = '2026-06-30T00:00:00.000Z';
const ahora = '2026-07-30T12:00:00.000Z';
const attr: Attribution = { source: 'autonomia', purpose: 'gobernar', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
const ORG = 'smileflow';

function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('soec-director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `c-${org}` };
}

const montar = () => new AutonomiaService(new InMemoryEventStore());

async function autorizar(svc: AutonomiaService, org: string, accion: AccionGobernada, entidadRef: string, expiraEn = futuro): Promise<void> {
  await svc.otorgarAutorizacion(ctx(org), { accion, entidadRef, actorHumano: 'director-humano', otorgadaEn: t0, expiraEn }, attr, t0);
}

describe('@soec/autonomia · autorización obligatoria', () => {
  it('ninguna de las 6 acciones gobernadas procede sin autorización', async () => {
    const svc = montar();
    for (const accion of ACCIONES_GOBERNADAS) {
      const v = await svc.puedeEjecutar(ctx(), accion, 'c1', ahora);
      expect(v.permitida).toBe(false);
    }
  });

  it('con autorización válida, la acción procede', async () => {
    const svc = montar();
    await autorizar(svc, ORG, 'PUBLICAR_SIMULADO', 'c1');
    const v = await svc.puedeEjecutar(ctx(), 'PUBLICAR_SIMULADO', 'c1', ahora);
    expect(v.permitida).toBe(true);
  });
});

describe('@soec/autonomia · modo seguro (PAUSA)', () => {
  it('la PAUSA prevalece incluso sobre una aprobación previa', async () => {
    const svc = montar();
    await autorizar(svc, ORG, 'PROGRAMAR', 'c1');
    expect((await svc.puedeEjecutar(ctx(), 'PROGRAMAR', 'c1', ahora)).permitida).toBe(true);
    await svc.pausar(ctx(), 'anomalía detectada', attr, ahora);
    const v = await svc.puedeEjecutar(ctx(), 'PROGRAMAR', 'c1', ahora);
    expect(v.permitida).toBe(false);
    expect(v.motivo).toContain('MODO_SEGURO');
  });

  it('una acción iniciada antes de la PAUSA no puede continuar tras ella', async () => {
    const svc = montar();
    await autorizar(svc, ORG, 'PUBLICAR_SIMULADO', 'c1');
    await svc.iniciarAccion(ctx(), 'acc1', 'PUBLICAR_SIMULADO', 'c1', ahora, attr, ahora);
    expect((await svc.puedeContinuar(ctx(), 'acc1')).permitida).toBe(true);
    await svc.pausar(ctx(), 'stop', attr, ahora);
    const v = await svc.puedeContinuar(ctx(), 'acc1');
    expect(v.permitida).toBe(false);
    // Y ni siquiera tras reanudar debe continuar en silencio: hubo una pausa de por medio.
    await svc.reanudar(ctx(), 'director-humano', 'revisado', attr, ahora);
    expect((await svc.puedeContinuar(ctx(), 'acc1')).permitida).toBe(false);
  });
});

describe('@soec/autonomia · límites de elevación y reanudación', () => {
  it('SOEC no puede elevar su propia autonomía', async () => {
    const svc = montar();
    await svc.establecerPolitica(ctx(), 1, attr, t0);
    await expect(svc.cambiarNivel(ctx(), 3, 'soec', attr, ahora)).rejects.toBeInstanceOf(AutonomiaNoAutoElevableError);
    // Un humano sí puede.
    const s = await svc.cambiarNivel(ctx(), 3, 'humano', attr, ahora);
    expect(s.nivel).toBe(3);
  });

  it('reanudar exige un actor humano y deja traza', async () => {
    const svc = montar();
    await svc.pausar(ctx(), 'stop', attr, ahora);
    await expect(svc.reanudar(ctx(), '', 'sin responsable', attr, ahora)).rejects.toBeInstanceOf(ReanudacionSinActorHumanoError);
    const s = await svc.reanudar(ctx(), 'director-humano', 'incidente resuelto', attr, ahora);
    expect(s.pausado).toBe(false);
    expect(s.reanudaciones[0]!.actorHumano).toBe('director-humano');
    expect(s.reanudaciones[0]!.motivo).toBe('incidente resuelto');
  });
});

describe('@soec/autonomia · vencimiento y separación', () => {
  it('una aprobación vencida no autoriza', async () => {
    const svc = montar();
    await autorizar(svc, ORG, 'REINTENTAR', 'c1', pasado); // ya vencida
    const v = await svc.puedeEjecutar(ctx(), 'REINTENTAR', 'c1', ahora);
    expect(v.permitida).toBe(false);
  });

  it('una aprobación de otra organización no autoriza', async () => {
    const store: EventStore = new InMemoryEventStore();
    const svc = new AutonomiaService(store);
    await autorizar(svc, 'otra-org', 'AUMENTAR_PRESUPUESTO', 'c1'); // autorización en otra org
    // En la org propia no existe autorización → rechazada.
    const v = await svc.puedeEjecutar(ctx(ORG), 'AUMENTAR_PRESUPUESTO', 'c1', ahora);
    expect(v.permitida).toBe(false);
  });

  it('iniciar una acción sin autorización se rechaza', async () => {
    const svc = montar();
    await expect(svc.iniciarAccion(ctx(), 'acc1', 'MODIFICAR_CAMPANA_ACTIVA', 'c1', ahora, attr, ahora)).rejects.toBeInstanceOf(AutonomiaInvalidaError);
  });
});
