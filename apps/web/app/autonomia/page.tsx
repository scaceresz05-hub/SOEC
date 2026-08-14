import CapacidadesCIA from './CapacidadesCIA';
import { Badge, Callout, PageHeader } from '../../components/ui';

export const dynamic = 'force-dynamic';

const NIVELES = [
  { n: 1, t: 'Solo observar', s: 'SOEC mira tus datos y aprende. No propone cambios.' },
  { n: 2, t: 'Recomendar', s: 'SOEC te trae propuestas. Vos decidís todo.' },
  { n: 3, t: 'Ejecutar con mi aprobación', s: 'SOEC prepara los cambios y espera tu confirmación antes de aplicarlos.', actual: true },
  { n: 4, t: 'Automático', s: 'SOEC puede actuar solo, dentro de los límites que vos definas.' },
];

export default function Autonomia() {
  return (
    <div className="dash panel">
      <PageHeader eyebrow="Nivel de control" title="¿Cuánto dejás que SOEC decida solo?" />
      <p className="lede">
        Vos fijás el límite y podés cambiarlo cuando quieras. SOEC nunca cruza el nivel que elegiste.
      </p>

      <div role="radiogroup" aria-label="Nivel de control" style={{ maxWidth: 720 }}>
        {NIVELES.map((n) => (
          <div className={`lvl ${n.actual ? 'on' : ''}`} key={n.n} role="radio" aria-checked={n.actual ? 'true' : 'false'} tabIndex={0}>
            <span className="radio" aria-hidden="true" />
            <span>
              <span className="lt">
                {n.n}. {n.t}
              </span>
              <span className="ls">{n.s}</span>
            </span>
            {n.actual && <Badge tono="ok">Nivel actual</Badge>}
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 720, marginTop: 16 }}>
        <Callout tono="warn" ico="🔒">
          <b>Aunque el nivel diga «ejecutar», los cambios reales están desactivados.</b> Hoy SOEC solo
          simula: prepara cada cambio, te lo muestra y espera tu aprobación. Nada se publica, se gasta
          ni se modifica de verdad todavía. Cuando eso se habilite, será una decisión explícita tuya.
        </Callout>
      </div>

      <CapacidadesCIA />
    </div>
  );
}
