import type { OrgLista, ProgramaLista, RespuestaAutonomia, VistaPrograma } from './programas-types';

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fallo de servicio (${res.status})`);
  return (await res.json()) as T;
}
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { mensaje?: string; error?: string };
    throw new Error(c.mensaje ?? c.error ?? `fallo (${res.status})`);
  }
  return (await res.json()) as T;
}

export const listarOrganizaciones = (): Promise<OrgLista> => jget('/api/programas');
export const listarProgramas = (org: string): Promise<ProgramaLista> => jget(`/api/programas/${encodeURIComponent(org)}/programas`);
export const obtenerPrograma = (org: string, prog: string): Promise<VistaPrograma> => jget(`/api/programas/${encodeURIComponent(org)}/programas/${encodeURIComponent(prog)}`);
export const ejecutarCiclo = (org: string, prog: string): Promise<VistaPrograma> => jpost(`/api/programas/${encodeURIComponent(org)}/programas/${encodeURIComponent(prog)}/ejecutar-ciclo`, {});
export const pausar = (org: string, prog: string): Promise<RespuestaAutonomia> => jpost(`/api/programas/${encodeURIComponent(org)}/programas/${encodeURIComponent(prog)}/pausar`, { motivo: 'pausa desde la UI' });
export const reanudar = (org: string, prog: string, actorHumano: string): Promise<RespuestaAutonomia> => jpost(`/api/programas/${encodeURIComponent(org)}/programas/${encodeURIComponent(prog)}/reanudar`, { actorHumano, motivo: 'reanudación desde la UI' });

/** Configura el programa de DEMOSTRACIÓN SmileFlow vía los endpoints reales (datos sintéticos). */
export async function configurarSmileFlowDemo(): Promise<{ org: string; programaId: string }> {
  const ORG = 'smileflow-clinic-pilot';
  const PROG = 'captacion-smileflow-v1';
  const base = `/api/programas`;
  await jpost(base, { org: ORG, negocio: { nombre: 'SmileFlow Clinic', descripcion: 'gestión de clínicas dentales', industria: 'salud dental', pais: 'CL', moneda: 'CLP', zonaHoraria: 'America/Santiago' }, perfil: { problemas: ['agenda desordenada', 'inasistencias'], propuestaValor: 'plataforma única de gestión dental', capacidadesVerificadas: ['agenda', 'pacientes', 'finanzas'], restricciones: ['no es consejo médico'], diferenciadores: ['adaptada a clínicas dentales'], informacionFaltante: ['tamaño de mercado'] } });
  await jpost(`${base}/${ORG}/programas`, { programaId: PROG, nombre: 'Programa de captación SmileFlow V1', objetivoPrincipal: 'generar oportunidades de clínicas interesadas', objetivosSecundarios: ['conocimiento de marca', 'solicitudes de demo'], presupuestoTotalSimulado: 300000, moneda: 'CLP' });
  const segs = [
    { id: 'pequena', nombre: 'Clínica pequeña', descripcion: '1-3 profesionales', problemas: ['agenda manual'], necesidades: ['reducir inasistencias'], criterios: ['1-3 boxes'], prioridad: 1 },
    { id: 'crecimiento', nombre: 'Clínica en crecimiento', descripcion: 'varios boxes', problemas: ['coordinación'], necesidades: ['control agenda/finanzas'], criterios: ['varios odontólogos'], prioridad: 2 },
    { id: 'multisede', nombre: 'Centro multi-sede', descripcion: 'varias sedes', problemas: ['centralización'], necesidades: ['roles y reportes'], criterios: ['multi-clínica'], prioridad: 3 },
  ];
  const hips = [
    { id: 'h-agenda', segmentoId: 'pequena', problema: 'agenda desordenada', propuesta: 'una sola plataforma', mensaje: 'Tu clínica no debería depender de una agenda desordenada', canalSimulado: 'correo', accionEsperada: 'solicitar demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'señal positiva simulada' },
    { id: 'h-control', segmentoId: 'crecimiento', problema: 'falta de visibilidad', propuesta: 'visibilidad integrada', mensaje: 'Conoce qué ocurre en tu clínica sin planillas aisladas', canalSimulado: 'correo', accionEsperada: 'solicitar demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'señal positiva simulada' },
    { id: 'h-crecer', segmentoId: 'multisede', problema: 'pérdida de control al crecer', propuesta: 'operación multi-sede', mensaje: 'Crece sin perder control sobre la operación', canalSimulado: 'correo', accionEsperada: 'solicitar demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'señal positiva simulada' },
  ];
  for (const s of segs) await jpost(`${base}/${ORG}/programas/${PROG}/segmentos`, s);
  for (const h of hips) await jpost(`${base}/${ORG}/programas/${PROG}/hipotesis`, h);
  const camps = [
    { nombre: 'Agenda bajo control', segmentoId: 'pequena', hipotesisId: 'h-agenda', publico: 'clínicas pequeñas', propuesta: 'orden de agenda', mensaje: 'Agenda bajo control', canal: 'correo', presupuestoSimulado: 120000, duracionHipotetica: '14 días' },
    { nombre: 'Control administrativo', segmentoId: 'crecimiento', hipotesisId: 'h-control', publico: 'clínicas en crecimiento', propuesta: 'control administrativo', mensaje: 'Control administrativo', canal: 'correo', presupuestoSimulado: 100000, duracionHipotetica: '14 días' },
    { nombre: 'Crecimiento multi-clínica', segmentoId: 'multisede', hipotesisId: 'h-crecer', publico: 'centros multi-sede', propuesta: 'crecer con control', mensaje: 'Crecimiento multi-clínica', canal: 'correo', presupuestoSimulado: 80000, duracionHipotetica: '14 días' },
  ];
  for (let i = 0; i < camps.length; i++) {
    await jpost(`${base}/${ORG}/programas/${PROG}/campanias`, camps[i]);
    const campaignId = `${PROG}-c${i + 1}`;
    for (const cuerpo of ['Anuncio corto simulado.', 'Publicación educativa simulada.', 'Correo comercial simulado.']) {
      await jpost(`${base}/${ORG}/programas/${PROG}/contenidos`, { campaignId, contenido: { canal: 'correo', cuerpo, marcaId: 'smileflow', productoServicio: 'software de gestión dental', llamadaAccion: 'Solicita una demostración', idioma: 'es' } });
    }
  }
  await jpost(`${base}/${ORG}/programas/${PROG}/listo`, {});
  return { org: ORG, programaId: PROG };
}
