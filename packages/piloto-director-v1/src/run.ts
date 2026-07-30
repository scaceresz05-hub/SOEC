/**
 * Runner reproducible del piloto: ejecuta el ciclo completo e imprime la traza encadenada.
 * Uso: `pnpm -C packages/piloto-director-v1 piloto`. Sin efectos externos reales.
 */
import { InMemoryEventStore } from '@soec/event-store';
import { ejecutarPiloto } from './piloto';

async function main(): Promise<void> {
  const traza = await ejecutarPiloto(new InMemoryEventStore());
  const cadena: Array<[string, string]> = [
    ['objetivo', traza.objetivoId],
    ['decisión', traza.decisionId],
    ['campaña', traza.campaignId],
    ['contenido', traza.contentId],
    ['autorización', traza.approvalId],
    ['ejecución(simulada)', traza.executionId],
    ['medición', traza.measurementId],
    ['experimento', traza.experimentId],
    ['aprendizaje', traza.learningId],
    ['siguiente decisión', traza.nextDecisionId],
  ];
  // eslint-disable-next-line no-console
  console.log('=== Piloto Director de Marketing Autónomo V1 — SmileFlow ===');
  for (const [etapa, id] of cadena) {
    // eslint-disable-next-line no-console
    console.log(`  ${etapa.padEnd(22)} → ${id}`);
  }
  // eslint-disable-next-line no-console
  console.log(`  ROI (${traza.vista.resultado.naturaleza}): ${traza.resultado.roiReal ?? traza.resultado.roiEstimado ?? 'n/d'}`);
  // eslint-disable-next-line no-console
  console.log(`  Próxima recomendación: ${traza.vista.proximaRecomendacion}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('El piloto falló:', e);
  process.exitCode = 1;
});
