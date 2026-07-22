import { describe, expect, it } from 'vitest';
import {
  ProveedorGenerativoDeterminista,
  validarRespuesta,
  type ProveedorGenerativo,
  type RespuestaGenerativa,
  type SolicitudGenerativa,
} from '../src';
import { ctxFor } from './helpers';

const ctx = ctxFor('orgA');

function solicitud(over: Partial<SolicitudGenerativa> = {}): SolicitudGenerativa {
  return {
    tarea: 'adaptacion_canal',
    contexto: { formato: 'post_social', mensaje: 'mantención confiable', propuestaValor: 'respuesta en 24h', llamadaAccion: 'Solicita cotización' },
    esquemaSalida: ['cuerpo', 'llamadaAccion'],
    idioma: 'es',
    limiteCaracteres: 0,
    evitar: [],
    promptRef: 'prompt:adapt@v1#h',
    trazabilidad: 't',
    ...over,
  };
}

describe('Producción generativa (proveedor determinista)', () => {
  it('es determinista: mismas entradas → misma salida', async () => {
    const p = new ProveedorGenerativoDeterminista();
    const a = await p.generar(ctx, solicitud());
    const b = await p.generar(ctx, solicitud());
    expect(a.salida).toEqual(b.salida);
    expect(a.estado).toBe('valida');
  });

  it('produce salida estructurada que valida contra el esquema', async () => {
    const p = new ProveedorGenerativoDeterminista();
    const r = await p.generar(ctx, solicitud());
    expect(validarRespuesta(r, ['cuerpo', 'llamadaAccion'], 0).valida).toBe(true);
  });

  it('detecta salida malformada, timeout y error como no válidos', async () => {
    const p = new ProveedorGenerativoDeterminista();
    const malformada = await p.generar(ctx, solicitud({ contexto: { _forzar: 'malformada' } }));
    expect(validarRespuesta(malformada, ['cuerpo'], 0).valida).toBe(false);
    const timeout = await p.generar(ctx, solicitud({ contexto: { _forzar: 'timeout' } }));
    expect(timeout.estado).toBe('timeout');
    const error = await p.generar(ctx, solicitud({ contexto: { _forzar: 'error' } }));
    expect(error.estado).toBe('error');
  });

  it('respeta el límite de caracteres del canal', async () => {
    const p = new ProveedorGenerativoDeterminista();
    const r = await p.generar(ctx, solicitud({ limiteCaracteres: 20 }));
    expect((r.salida?.campos['cuerpo'] ?? '').length).toBeLessThanOrEqual(20);
  });

  it('la lista "evitar" elimina un gancho prohibido en el anuncio', async () => {
    const p = new ProveedorGenerativoDeterminista();
    const conGancho = await p.generar(ctx, solicitud({ contexto: { formato: 'anuncio', ganchoPromocional: 'Oferta imperdible', propuestaValor: 'respuesta 24h', llamadaAccion: 'cta' } }));
    expect((conGancho.salida?.campos['cuerpo'] ?? '').toLowerCase()).toContain('oferta imperdible');
    const corregido = await p.generar(ctx, solicitud({ evitar: ['oferta imperdible'], contexto: { formato: 'anuncio', ganchoPromocional: 'Oferta imperdible', propuestaValor: 'respuesta 24h', llamadaAccion: 'cta' } }));
    expect((corregido.salida?.campos['cuerpo'] ?? '').toLowerCase()).not.toContain('oferta imperdible');
  });

  it('el proveedor es reemplazable por otro que cumpla el puerto', async () => {
    const alterno: ProveedorGenerativo = {
      nombre: 'alterno',
      version: '9',
      async generar(): Promise<RespuestaGenerativa> {
        return { estado: 'valida', salida: { campos: { cuerpo: 'x', llamadaAccion: 'y' }, listas: {} }, proveedorLogico: 'alterno', modeloLogico: 'alterno@9', generadoEn: '2020-01-01T00:00:00.000Z', uso: { unidades: 0, costoEstimado: 0 }, advertencias: [], promptRef: 'p' };
      },
    };
    const r = await alterno.generar(ctx, solicitud());
    expect(r.proveedorLogico).toBe('alterno');
    expect(validarRespuesta(r, ['cuerpo'], 0).valida).toBe(true);
  });
});
