import CapacidadesCIA from './CapacidadesCIA';
import { Badge, Callout, PageHeader } from '../../components/ui';

export const dynamic = 'force-dynamic';

const NIVELES = [
  { n: 1, t: 'Solo observar', s: 'SOEC mira tus datos y aprende. No propone cambios.' },
  { n: 2, t: 'Recomendar', s: 'SOEC te trae propuestas. Vos decidís todo.' },
  { n: 3, t: 'Ejecutar con mi aprobación', s: 'SOEC prepara los cambios y espera tu confirmación antes de aplicarlos.', actual: true },
  { n: 4, t: 'Piloto automático', s: 'SOEC puede realizar cambios dentro de los límites que vos autorizás, sin pedirte permiso por cada uno.' },
];

export default function Autonomia() {
  return (
    <div className="dash panel">
      <PageHeader eyebrow="Nivel de control" title="¿Cuánto dejás que SOEC decida solo?" />
      <p className="lede">
        Vos fijás el límite y podés cambiarlo cuando quieras. SOEC nunca cruza el nivel que elegiste.
      </p>

      <div className="grid g-2" style={{ maxWidth: 720, marginBottom: 18 }}>
        <div className="card pad-sm">
          <div className="mlabel" style={{ marginBottom: 4 }}>Nivel que preferís</div>
          <div style={{ fontWeight: 750, fontSize: 16 }}>Ejecutar con mi aprobación</div>
          <div className="s" style={{ marginTop: 2 }}>SOEC prepara los cambios y espera tu confirmación.</div>
        </div>
        <div className="card pad-sm">
          <div className="mlabel" style={{ marginBottom: 4 }}>Lo que SOEC puede hacer hoy</div>
          <div style={{ fontWeight: 750, fontSize: 16 }}>Modo seguro (solo simulación)</div>
          <div className="s" style={{ marginTop: 2 }}>La escritura real está desactivada: ningún cambio externo puede ocurrir todavía.</div>
        </div>
      </div>

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

      <div className="section" style={{ maxWidth: 720 }}>Piloto automático en prueba</div>
      <div className="card" style={{ maxWidth: 720 }}>
        <p className="s" style={{ marginTop: 0 }}>
          <b>SOEC está aprendiendo a administrar tus campañas en modo de prueba (modo sombra).</b> Con
          tus datos reales, decide qué haría —usando exactamente los mismos controles de seguridad que
          usaría de verdad— pero <b>todavía no modifica ninguna plataforma externa</b>.
        </p>
        <div className="grid g-2" style={{ marginTop: 10 }}>
          <div>
            <div className="mlabel" style={{ marginBottom: 6 }}>Mis límites (por empresa)</div>
            <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Presupuesto máximo y aumento máximo</li>
              <li>Cambios máximos por día y enfriamiento</li>
              <li>Acciones permitidas, con aprobación o prohibidas</li>
            </ul>
          </div>
          <div>
            <div className="mlabel" style={{ marginBottom: 6 }}>Seguridad</div>
            <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Interruptor de emergencia (global, empresa y cuenta)</li>
              <li>Cada acción exige evidencia suficiente y un plan de reversión</li>
              <li>El mandato tiene fecha de vencimiento y podés revocarlo cuando quieras</li>
            </ul>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Una empresa sin fundamentos (por ejemplo, sin medición ni márgenes) no es elegible para
          piloto automático: SOEC lo bloquea hasta tener con qué decidir.
        </p>
      </div>

      <div className="section" style={{ maxWidth: 720 }}>Qué podría y qué no (cuando un negocio es elegible)</div>
      <div className="card" style={{ maxWidth: 720 }}>
        <p className="small muted" style={{ marginTop: 0 }}>
          «Preparado técnicamente» no significa «puede hacer cualquier cambio». Aun elegible, SOEC solo
          toca lo reversible y de bajo riesgo dentro de tu mandato.
        </p>
        <div className="grid g-2" style={{ marginTop: 6 }}>
          <div>
            <div className="mlabel" style={{ marginBottom: 6, color: 'var(--ok)' }}>Capacidades disponibles</div>
            <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Acciones reversibles dentro del mandato (p. ej. excluir una búsqueda irrelevante, pausar un anuncio)</li>
            </ul>
          </div>
          <div>
            <div className="mlabel" style={{ marginBottom: 6, color: 'var(--warn)' }}>Todavía bloqueadas</div>
            <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Aumentar el presupuesto</li>
              <li>Acciones financieras sin límites o sin economía conocida</li>
              <li>Cualquier acción fuera del mandato</li>
            </ul>
          </div>
        </div>
        <p style={{ marginTop: 12, marginBottom: 0, fontWeight: 750 }}>
          <span className="badge warn"><span className="bdot" aria-hidden="true" /> Cambios reales: DESACTIVADOS</span>
        </p>
      </div>

      <CapacidadesCIA />
    </div>
  );
}
