/**
 * Cliente de la superficie AUTENTICADA del conocimiento comercial (CRM) vía proxy /api/backend/*. Permite
 * poblar el cerebro comercial (empresa/producto/ICP/hipótesis) antes de generar. Sesión en cookie httpOnly;
 * organización en x-organization-slug (el gateway la valida contra la membresía). Todo SIMULADO.
 */
export interface CoberturaComercial {
  empresa: boolean;
  productoOServicio: boolean;
  icps: number;
  hipotesisConSegmento: number;
  listoParaGenerar: boolean;
  faltantes: string[];
}
export interface EntidadCrm {
  id: string;
  tipo: string;
  nombre: string;
  campos: Record<string, { valor: string; origen: string }>;
}
export interface HipotesisCrm {
  id: string;
  enunciado: string;
  contexto: string;
  estado: string;
  segmentoId: string | null;
  evidencias: number;
}

const BASE = 'commercial-knowledge';
const headers = (org: string) => ({ 'content-type': 'application/json', 'x-organization-slug': org });

async function jget<T>(org: string, ruta: string): Promise<T> {
  const res = await fetch(`/api/backend/${ruta}`, { headers: headers(org), cache: 'no-store' });
  if (!res.ok) throw new Error(await msg(res));
  return (await res.json()) as T;
}
async function jpost<T>(org: string, ruta: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(`/api/backend/${ruta}`, { method, headers: headers(org), body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(await msg(res));
  return (await res.json()) as T;
}
async function msg(res: Response): Promise<string> {
  const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (res.status === 401) return 'Necesitas iniciar sesión.';
  if (res.status === 403) return 'Tu rol no puede editar el conocimiento comercial.';
  if (res.status === 404) return 'No encontrado en tu organización.';
  return c.message ?? c.error ?? `error ${res.status}`;
}

export const cobertura = (org: string): Promise<CoberturaComercial> => jget(org, `${BASE}/coverage`);
export const listarEntidades = (org: string): Promise<{ entidades: EntidadCrm[] }> => jget(org, BASE);
export const listarHipotesis = (org: string): Promise<{ hipotesis: HipotesisCrm[] }> => jget(org, `${BASE}/hypotheses`);

export const crearEntidad = (org: string, id: string, tipo: string, nombre: string) => jpost(org, `${BASE}/entities`, 'POST', { id, tipo, nombre });
export const establecerCampo = (org: string, id: string, clave: string, valor: string) => jpost(org, `${BASE}/entities/${encodeURIComponent(id)}`, 'PATCH', { clave, valor });
export const crearHipotesis = (org: string, id: string, enunciado: string, contexto: string, segmentoId?: string) =>
  jpost(org, `${BASE}/hypotheses`, 'POST', { id, enunciado, contexto, ...(segmentoId ? { segmentoId } : {}) });
export const agregarEvidencia = (org: string, id: string, descripcion: string) => jpost(org, `${BASE}/hypotheses/${encodeURIComponent(id)}/evidence`, 'POST', { descripcion, origen: 'DATO_IMPORTADO', aFavor: true });
export const asociarSegmento = (org: string, id: string, segmentoId: string) => jpost(org, `${BASE}/hypotheses/${encodeURIComponent(id)}/segment`, 'POST', { segmentoId });
