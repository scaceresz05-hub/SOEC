/**
 * Verifica que los avisos permanentes de la vista de Programas contienen los conceptos
 * inequívocos exigidos por la auditoría (piloto, sin autenticación multi-tenant, simulado, pausa
 * por organización), sin snapshots frágiles de la página.
 */
import { describe, it, expect } from 'vitest';
import { AVISO_PAUSA_ORG, AVISO_PILOTO_SIN_AUTH, AVISO_SIMULACION, MSG_ORG_PAUSADA, MSG_ORG_REANUDADA } from './programas-avisos';

describe('avisos permanentes de Programas', () => {
  it('el aviso de piloto declara "piloto" y la ausencia de autenticación multi-tenant', () => {
    const t = AVISO_PILOTO_SIN_AUTH.toLowerCase();
    expect(t).toContain('piloto');
    expect(t).toContain('autenticación multi-tenant'); // "no dispone de autenticación multi-tenant"
  });

  it('el aviso de simulación declara que todo es simulado y sin gasto real', () => {
    expect(AVISO_SIMULACION.toLowerCase()).toContain('simulados');
    expect(AVISO_SIMULACION.toLowerCase()).toContain('no se realiza gasto real');
  });

  it('el aviso de pausa deja claro que la autonomía es por organización', () => {
    expect(AVISO_PAUSA_ORG.toLowerCase()).toContain('por organización');
    expect(AVISO_PAUSA_ORG.toLowerCase()).toContain('todos los programas');
  });

  it('los mensajes de confirmación hablan de la organización, no del programa', () => {
    expect(MSG_ORG_PAUSADA).toBe('Organización pausada');
    expect(MSG_ORG_REANUDADA).toBe('Organización reanudada');
    expect(MSG_ORG_PAUSADA.toLowerCase()).not.toContain('programa');
  });
});
