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
  console.log('=== Piloto Director de Marketing Autónomo V1 — SmileFlow ===');
  for (const [etapa, id] of cadena) {
    console.log(`  ${etapa.padEnd(22)} → ${id}`);
  }
  const roiIlustrativo = traza.resultado.roiEstimado;
  console.log(`  Clasificación ROI: ${traza.resultado.clasificacion} (ROI real: ${traza.resultado.roiReal ?? 'N/D — no hay campaña productiva'})`);
  if (roiIlustrativo !== null) console.log(`  ROI ilustrativo (NO real): ${roiIlustrativo}`);
  console.log(`  Próxima recomendación: ${traza.vista.proximaRecomendacion}`);
}

main().catch((e) => {
  console.error('El piloto falló:', e);
  process.exitCode = 1;
});
