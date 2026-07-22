/**
 * Capacidades de canal (F2-CHAN-01 §4). No todos los proveedores funcionan igual:
 * el contrato de capacidades expresa qué soporta cada canal. El adaptador no debe
 * suponer que todos los proveedores hacen lo mismo.
 */
export interface CanalCapabilities {
  readonly canal: string;
  readonly publicaTexto: boolean;
  readonly publicaImagen: boolean;
  readonly publicaVideo: boolean;
  readonly soportaBorradores: boolean;
  readonly soportaProgramacion: boolean;
  readonly soportaEdicion: boolean;
  readonly soportaEliminacion: boolean;
  readonly soportaConsulta: boolean;
  readonly soportaWebhooks: boolean;
  /** Si el canal exige un archivo real (no una especificación) para publicar con imagen. */
  readonly exigeArchivoRealParaImagen: boolean;
  readonly limiteCuerpo: number;
  readonly estadosRemotos: readonly string[];
}
