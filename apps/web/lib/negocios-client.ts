/**
 * Cliente de NEGOCIOS (negocio como dato). Habla con la MISMA API que cualquier otro consumidor: crear una
 * empresa desde la interfaz no usa ningún atajo privado.
 */
export type TipoNegocio = 'CLINICA' | 'SAAS' | 'ECOMMERCE' | 'SERVICIOS' | 'LOCAL' | 'OTRO';

/** Etiquetas en lenguaje de negocio: el usuario elige lo que ES, no cómo lo clasifica el sistema. */
export const TIPOS_DE_NEGOCIO: ReadonlyArray<{ valor: TipoNegocio; etiqueta: string }> = [
  { valor: 'SERVICIOS', etiqueta: 'Servicios profesionales' },
  { valor: 'CLINICA', etiqueta: 'Clínica o consulta de salud' },
  { valor: 'LOCAL', etiqueta: 'Negocio local con atención presencial' },
  { valor: 'ECOMMERCE', etiqueta: 'Tienda online / e-commerce' },
  { valor: 'SAAS', etiqueta: 'Software o plataforma (SaaS)' },
  { valor: 'OTRO', etiqueta: 'Otro' },
];

export interface PerfilNegocio {
  organizationId: string;
  businessKey: string;
  displayName: string;
  businessType: TipoNegocio;
  country: string;
  currency: string;
  timezone: string;
  website: string | null;
  description: string | null;
  primaryObjective: string | null;
  status: string;
}

export interface NegocioCompleto {
  perfil: PerfilNegocio;
  gobierno: { externalMutations: boolean; autonomousSpend: boolean; automaticSafetyPause: boolean; campaignExecution: boolean };
}

export interface EntradaNuevoNegocio {
  displayName: string;
  businessType: TipoNegocio;
  country: string;
  currency: string;
  timezone: string;
  website?: string | null;
  description?: string | null;
  primaryObjective?: string | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function crearNegocio(entrada: EntradaNuevoNegocio): Promise<NegocioCompleto> {
  return json<NegocioCompleto>(
    await fetch('/api/backend/negocios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entrada) }),
  );
}

/** Empresas del usuario autenticado (filtradas por membresía en el servidor). */
export async function listarNegocios(): Promise<PerfilNegocio[]> {
  const r = await fetch('/api/backend/negocios', { cache: 'no-store' });
  if (r.status === 401) return [];
  const v = await json<{ negocios: PerfilNegocio[] }>(r);
  return v.negocios;
}
