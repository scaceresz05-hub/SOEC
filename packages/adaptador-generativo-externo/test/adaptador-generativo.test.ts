/**
 * @soec/adaptador-generativo-externo · M4-C-B · la carcasa vive fuera del dominio, se declara honestamente,
 * produce salida sintética, NO soporta REAL y queda gobernada por el sandbox (que fija identidad/modo).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import { Sandbox, estadoInicialAdaptador, OrquestadorAdaptadores, CIRCUIT_BREAKER_CERRADO, crearDescriptor, type RegistroAdaptador } from '@soec/adaptadores';
import { AdaptadorGenerativoExternoDesactivado, DESCRIPTOR_GENERATIVO_EXTERNO, CONTENIDO_DESCRIPTOR_GENERATIVO } from '../src/index';

const O = '2026-08-02T00:00:00.000Z';
const ctx = (): RequestContext => {
  const o = OrganizationId('org-a');
  return { organizationId: o, actor: ActorId('s'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'req-1' };
};
const solicitud = { solicitudId: 'sol-1', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: {} } };
const cap = (): CapacidadState => ({
  organizationId: 'org-a', capacidadId: 'gen', tipo: 'g', version: 5, existe: true, estado: 'EN_USO', modo: 'REAL', salud: 'SALUDABLE',
  politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:GEN', alternativaCapacidadId: null, cacheRef: null, configVersion: 3, reemplazadaPor: null, terminada: false,
});

describe('@soec/adaptador-generativo-externo · carcasa desactivada', () => {
  const ad = new AdaptadorGenerativoExternoDesactivado();

  it('declara su contrato/versión/capacidades honestamente y NO soporta REAL', () => {
    expect(ad.descriptor()).toBe(DESCRIPTOR_GENERATIVO_EXTERNO);
    expect(ad.soportaReal()).toBe(false);
    expect(ad.capacidad).toBe('generacion-contenido');
    expect(ad.nombre).not.toMatch(/openai|anthropic|google|gpt|gemini/i); // sin nombre comercial
  });

  it('salud sintética SALUDABLE (sin red)', async () => {
    expect(await ad.salud(ctx())).toEqual({ estado: 'SALUDABLE', detalle: 'carcasa-sintetica' });
  });

  it('a través del sandbox en SIMULADO produce salida sintética con identidad autoritativa', async () => {
    const { resultado } = await new Sandbox().ejecutar(ad, ctx(), solicitud, cap(), O);
    expect(resultado.estado).toBe('OK');
    expect(resultado.salida?.texto).toContain('[SIMULADO]');
    expect(resultado.modoEjecutado).toBe('SIMULADO');
    expect(resultado.adaptador).toBe('generacion-externa-carcasa');
  });

  it('no puede ejecutar REAL sin estado de frontera habilitado → NO_AUTORIZADO', async () => {
    const { resultado } = await new Sandbox().ejecutar(ad, ctx(), solicitud, cap(), O, { modoDeseado: 'REAL', estadoAdaptador: estadoInicialAdaptador() });
    expect(resultado.estado).toBe('ERROR');
    expect(resultado.error?.clase).toBe('NO_AUTORIZADO');
  });

  it('vía orquestador: descriptor soportaReal=false + monkey-patch de la instancia → NO_AUTORIZADO (el descriptor persistido gobierna)', async () => {
    const descriptor = crearDescriptor(CONTENIDO_DESCRIPTOR_GENERATIVO, 1);
    const reg: RegistroAdaptador = {
      organizationId: 'org-a', adaptadorId: ad.nombre, capacidadId: 'generacion-contenido', contratoId: 'generacion', contratoVersion: '1.0.0', implementacionVersion: '0.1.0',
      estado: 'AUTORIZADO', modo: 'REAL', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: null, limites: null, circuitBreaker: CIRCUIT_BREAKER_CERRADO,
      expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor, nivelActivacion: 'SIMULADO', creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4,
    };
    // Ataque: monkey-patch de la instancia para intentar habilitar REAL.
    (ad as unknown as { soportaReal: () => boolean }).soportaReal = () => true;
    const r = await new OrquestadorAdaptadores().orquestar(ad, ctx(), solicitud, cap(), reg, {
      observadoEn: O,
      politicaBreaker: { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' },
      modoSolicitado: 'REAL',
    });
    expect(r.resultado).toBeNull();
    expect(r.evidenciaOperativa.codigoError).toBe('NO_AUTORIZADO');
    expect(r.evidenciaOperativa.gateRechazo).toBe('MODO_REAL');
    expect(r.evidenciaOperativa.soportaReal).toBe(false); // autoridad = descriptor, no la instancia
  });
});
