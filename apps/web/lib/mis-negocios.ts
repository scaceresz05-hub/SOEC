/**
 * MIS NEGOCIOS · desde el plano de IDENTIDAD (organizaciones del usuario autenticado, por membresía).
 *
 * El selector superior y la home "Mis empresas" listaban desde el registro ESTÁTICO del despliegue
 * (org-smileflow/org-cyp), gated por una sesión que el proxy de plataforma no reenvía. Eso mostraba
 * "No hay empresas registradas" a un owner ya autenticado. Aquí la lista proviene de `/auth/me`
 * (proxy `/api/backend`, que sí reenvía la cookie) y por tanto está FILTRADA POR MEMBRESÍA.
 *
 * Un tenant recién creado todavía no tiene modelo de negocio, mercado ni métricas: se declaran
 * vacíos (desconocido ≠ cero), nunca inventados. El enriquecimiento comercial es trabajo aparte.
 */
import { yo } from './auth-client';

export interface Negocio {
  organizationId: string;
  displayName: string;
  estado: string;
  modeloDeNegocio: string;
  mercado: string;
}

/** Lista los negocios del usuario autenticado. Sin sesión (401) ⇒ lista vacía. */
export async function listarMisNegocios(): Promise<Negocio[]> {
  const sesion = await yo();
  if (!sesion) return [];
  return sesion.organizaciones.map((o) => ({
    organizationId: o.slug,
    displayName: o.name,
    // Tenant nuevo sin fuentes conectadas: "Configurando" es honesto; no es un estado observado.
    estado: 'CREATED',
    modeloDeNegocio: '',
    mercado: '',
  }));
}
