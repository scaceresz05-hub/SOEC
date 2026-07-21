/**
 * Instanciación sintética del PRIMER DOMINIO real: una pyme de servicios genérica.
 *
 * INSTANCIACIÓN, no arquitectura (#10 §2 · #17 §5): las entidades concretas
 * (unidades, procesos, ofertas… / normas, mercado) son contenido —tipos de
 * instancia—, no conceptos de primer nivel. Datos exclusivamente sintéticos.
 * Emitido bajo docs/decisions/instanciacion-estrategica-primer-dominio.md.
 */
import type { Attribution, RequestContext } from '@soec/contracts';
import type { MedService, MdmService } from '@soec/models';

export const IDS = {
  med: 'pyme-servicios-01',
  mdm: 'mundo-pyme-01',
  ece: 'ece-pyme-01',
  capacidad: 'comprender-el-estado',
  /** Elemento del ECE (contradicción intra-MED) que la capacidad esclarece. */
  contradiccion: 'der:contradiccion:MED:pyme-servicios-01:a-cobertura',
} as const;

const ambitoMed = {
  proposito: 'representar la estructura y operación de una pyme de servicios',
  representa: 'unidades, procesos, ofertas, recursos y objetivos declarados',
  excluye: 'el entorno de mercado y las normas (eso es el MDM)',
  supuestos: ['pyme sintética; ningún dato real'],
};
const ambitoMdm = {
  proposito: 'representar el entorno relevante de la pyme de servicios',
  representa: 'demanda del mercado, competencia y normas externas',
  excluye: 'la configuración interna de la pyme (eso es el MED)',
  supuestos: ['acceso mediado; datos sintéticos'],
};
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

export interface SeedDeps {
  readonly med: MedService;
  readonly mdm: MdmService;
}
export interface SeedOpts {
  readonly attribution: Attribution;
  readonly occurredAt: string;
}

/** Crea el MED sintético de la pyme: entidades por dimensión y afirmaciones con evidencia. */
export async function sembrarMed(ctx: RequestContext, med: MedService, o: SeedOpts): Promise<void> {
  const c = { attribution: o.attribution, occurredAt: o.occurredAt };
  await med.crear(ctx, { instanceId: IDS.med, ambito: ambitoMed, vigencia, ...c });

  // Lo que la empresa ES / HACE / TIENE / QUIERE.
  await med.registrarEntidad(ctx, { instanceId: IDS.med, entidadId: 'u-operaciones', dimension: 'es', tipo: 'unidad', atributos: { nombre: 'Operaciones' }, ...c });
  await med.registrarEntidad(ctx, { instanceId: IDS.med, entidadId: 'u-comercial', dimension: 'es', tipo: 'unidad', atributos: { nombre: 'Comercial' }, ...c });
  await med.registrarEntidad(ctx, { instanceId: IDS.med, entidadId: 'r-equipo', dimension: 'tiene-debe', tipo: 'recurso', atributos: { nombre: 'Equipo técnico', personas: 6 }, ...c });
  await med.registrarEntidad(ctx, { instanceId: IDS.med, entidadId: 'of-mantencion', dimension: 'hace', tipo: 'oferta', atributos: { nombre: 'Servicio de mantención' }, ...c });
  await med.registrarEntidad(ctx, { instanceId: IDS.med, entidadId: 'p-atencion', dimension: 'hace', tipo: 'proceso', atributos: { nombre: 'Atención de solicitudes' }, ...c });
  await med.registrarEntidad(ctx, { instanceId: IDS.med, entidadId: 'ob-crecer', dimension: 'quiere-ir', tipo: 'objetivo', atributos: { nombre: 'Crecer 20% anual' }, ...c });
  await med.registrarRelacionInterna(ctx, { instanceId: IDS.med, relId: 'rel-op-atencion', desde: 'u-operaciones', hasta: 'p-atencion', naturaleza: 'ejecuta', ...c });

  // Afirmación COHERENTE (respaldada por evidencia).
  await med.emitirAfirmacion(ctx, { instanceId: IDS.med, afirmacionId: 'a-turno', enunciado: 'la atención opera en turno diurno', dimension: 'hace', incertidumbre: 'baja', ...c });
  await med.incorporarEvidencia(ctx, { instanceId: IDS.med, evidenciaId: 'ev-turno', afirmacionId: 'a-turno', relacion: 'sostiene', procedencia: 'bitácora de turnos', contenido: 'registro observado', ...c });
  await med.revisarAfirmacion(ctx, { instanceId: IDS.med, afirmacionId: 'a-turno', nuevoEstado: 'respaldada', motivo: 'evidencia suficiente', ...c });

  // Afirmación CONTRADICTORIA (evidencia que la sostiene y la debilita).
  await med.emitirAfirmacion(ctx, { instanceId: IDS.med, afirmacionId: 'a-cobertura', enunciado: 'la unidad comercial cubre toda la demanda', dimension: 'hace', incertidumbre: 'alta', ...c });
  await med.incorporarEvidencia(ctx, { instanceId: IDS.med, evidenciaId: 'ev-cob-si', afirmacionId: 'a-cobertura', relacion: 'sostiene', procedencia: 'reporte comercial', contenido: 'metas cumplidas', ...c });
  await med.incorporarEvidencia(ctx, { instanceId: IDS.med, evidenciaId: 'ev-cob-no', afirmacionId: 'a-cobertura', relacion: 'debilita', procedencia: 'solicitudes sin atender', contenido: 'cola de espera creciente', ...c });

  // Afirmación con AUSENCIA (pendiente, sin evidencia → no evaluable).
  await med.emitirAfirmacion(ctx, { instanceId: IDS.med, afirmacionId: 'a-satisfaccion', enunciado: 'la satisfacción de clientes es alta', dimension: 'hace', incertidumbre: 'alta', limitacion: 'sin medición sistemática', ...c });
}

/** Crea el MDM sintético del entorno de la pyme. */
export async function sembrarMdm(ctx: RequestContext, mdm: MdmService, o: SeedOpts): Promise<void> {
  const c = { attribution: o.attribution, occurredAt: o.occurredAt };
  await mdm.crear(ctx, { instanceId: IDS.mdm, ambito: ambitoMdm, vigencia, ...c });
  await mdm.registrarEntidad(ctx, { instanceId: IDS.mdm, entidadId: 'ext-competidor', dimension: 'actores-externos', tipo: 'competidor', atributos: { nombre: 'Competidor local' }, ...c });
  await mdm.emitirAfirmacion(ctx, { instanceId: IDS.mdm, afirmacionId: 'b-demanda', enunciado: 'la demanda de servicios de mantención crece', dimension: 'economico', incertidumbre: 'media', ...c });
  await mdm.incorporarEvidencia(ctx, { instanceId: IDS.mdm, evidenciaId: 'ev-demanda', afirmacionId: 'b-demanda', relacion: 'sostiene', procedencia: 'informe sectorial sintético', contenido: 'tendencia al alza', ...c });
  await mdm.revisarAfirmacion(ctx, { instanceId: IDS.mdm, afirmacionId: 'b-demanda', nuevoEstado: 'respaldada', motivo: 'evidencia sectorial', ...c });
  await mdm.emitirAfirmacion(ctx, { instanceId: IDS.mdm, afirmacionId: 'b-norma', enunciado: 'una nueva norma de facturación rige desde enero', dimension: 'normativo', incertidumbre: 'alta', ...c });
  await mdm.registrarObservacion(ctx, { instanceId: IDS.mdm, observacionId: 'o-precio', entidadId: 'ext-competidor', contenido: 'el competidor bajó precios', ...c });
  await mdm.registrarCambioExterno(ctx, { instanceId: IDS.mdm, cambioId: 'c-mercado', descripcion: 'aumento de solicitudes en el mercado', ...c });
}

export async function sembrarDominio(ctx: RequestContext, deps: SeedDeps, o: SeedOpts): Promise<void> {
  await sembrarMed(ctx, deps.med, o);
  await sembrarMdm(ctx, deps.mdm, o);
}
