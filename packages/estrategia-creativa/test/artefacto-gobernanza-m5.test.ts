/**
 * @soec/estrategia-creativa · test · M6 · ampliación ADITIVA de gobernanza M5 sobre el artefacto de
 * estrategia creativa (reutilizar y ampliar, sin segundo modelo). Verifica que el vínculo M5 se adjunta
 * sin alterar el contenido canónico (B-1) y que exige un artefacto existente.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  ArtefactoCreativoNoEncontradoError,
  EstrategiaCreativaArtefactoService,
  type ContenidoArtefacto,
  contenidoArtefactoCanonico,
} from '../src/index';

const attr: Attribution = { source: 't', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('d'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}
const contenido: ContenidoArtefacto = {
  programaId: 'p', objetivoId: 'o', segmentoId: 's', hipotesisId: 'h', briefId: 'b',
  concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta',
  objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false,
  afirmacionesPermitidas: ['x'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1',
};

describe('artefacto · gobernanza M5 (M6)', () => {
  it('vincula gobernanza M5 sin alterar el contenido canónico (B-1)', async () => {
    const svc = new EstrategiaCreativaArtefactoService(new InMemoryEventStore());
    const c = ctx();
    const st0 = await svc.establecer(c, 'estcr-1', contenido, attr, O);
    const canon0 = contenidoArtefactoCanonico(st0.artefacto!);
    const st1 = await svc.vincularGobernanzaM5(c, 'estcr-1', {
      afirmacionesProhibidas: ['no prometer resultados'],
      referenciasM5: [{ afirmacionId: 'af-1', version: 2 }],
      estadoGobernanza: 'VIGENTE',
      contextoCreativoId: 'ctx-1',
    }, attr, O);
    expect(st1.artefacto?.afirmacionesProhibidas).toEqual(['no prometer resultados']);
    expect(st1.artefacto?.referenciasM5).toEqual([{ afirmacionId: 'af-1', version: 2 }]);
    expect(st1.artefacto?.estadoGobernanza).toBe('VIGENTE');
    expect(st1.artefacto?.contextoCreativoId).toBe('ctx-1');
    // El contenido canónico (B-1) NO cambió: la gobernanza es aditiva, no versiona el contenido.
    expect(contenidoArtefactoCanonico(st1.artefacto!)).toBe(canon0);
  });

  it('vincular gobernanza a un artefacto inexistente lanza', async () => {
    const svc = new EstrategiaCreativaArtefactoService(new InMemoryEventStore());
    await expect(
      svc.vincularGobernanzaM5(ctx(), 'noexiste', { afirmacionesProhibidas: [], referenciasM5: [], estadoGobernanza: 'BORRADOR' }, attr, O),
    ).rejects.toBeInstanceOf(ArtefactoCreativoNoEncontradoError);
  });
});
