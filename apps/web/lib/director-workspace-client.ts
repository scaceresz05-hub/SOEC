import type { CategoriaJustificacion, WorkspaceEstado } from './director-workspace-types';

async function json(res: Response): Promise<WorkspaceEstado> {
  if (!res.ok) throw new Error('fallo de servicio del Director Workspace');
  return (await res.json()) as WorkspaceEstado;
}

export async function obtenerWorkspace(
  org: string,
  departamento: string,
  evaluacionId: string,
): Promise<WorkspaceEstado> {
  const q = `org=${encodeURIComponent(org)}&departamento=${encodeURIComponent(departamento)}&evaluacionId=${encodeURIComponent(evaluacionId)}`;
  return json(await fetch(`/api/director-workspace/estado?${q}`, { cache: 'no-store' }));
}

export interface DecidirInput {
  org: string;
  departamento: string;
  evaluacionId: string;
  decisionId: string;
  resultado: 'ACEPTADO' | 'RECHAZADO';
  objetivoId?: string | null;
  justificacion: { texto: string; categoria: CategoriaJustificacion };
}

export async function decidirWorkspace(input: DecidirInput): Promise<WorkspaceEstado> {
  return json(
    await fetch('/api/director-workspace/decidir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function revocarWorkspace(
  org: string,
  departamento: string,
  evaluacionId: string,
  decisionId: string,
  motivo: string,
): Promise<WorkspaceEstado> {
  return json(
    await fetch('/api/director-workspace/revocar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org, departamento, evaluacionId, decisionId, motivo }),
    }),
  );
}
