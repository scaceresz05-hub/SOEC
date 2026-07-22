/**
 * Roles y permisos (F2-CTRL-01 §20). Frontera de autorización de la experiencia de
 * control. No es una administración completa de usuarios: es la matriz mínima que
 * gobierna quién puede ver, aprobar, pausar o cambiar políticas.
 */
export type Rol = 'propietario' | 'supervisor' | 'observador' | 'operador_tecnico';

export type Permiso =
  | 'ver'
  | 'aprobar_decision'
  | 'aprobar_alto_riesgo'
  | 'pausar'
  | 'reanudar'
  | 'cambiar_politica'
  | 'definir_objetivos'
  | 'habilitar_modo_real'
  | 'resolver_excepcion'
  | 'reconciliar';

const MATRIZ: Readonly<Record<Rol, ReadonlySet<Permiso>>> = {
  propietario: new Set<Permiso>(['ver', 'aprobar_decision', 'aprobar_alto_riesgo', 'pausar', 'reanudar', 'cambiar_politica', 'definir_objetivos', 'habilitar_modo_real', 'resolver_excepcion', 'reconciliar']),
  supervisor: new Set<Permiso>(['ver', 'aprobar_decision', 'pausar', 'reanudar', 'resolver_excepcion']),
  observador: new Set<Permiso>(['ver']),
  operador_tecnico: new Set<Permiso>(['ver', 'reconciliar']),
};

export function puede(rol: Rol, permiso: Permiso): boolean {
  return MATRIZ[rol]?.has(permiso) ?? false;
}
