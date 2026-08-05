import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function Onboarding() {
  return (
    <div className="wrap panel">
      <p className="eyebrow">Poner a SOEC a trabajar</p>
      <h1 className="voice">Cuéntame lo justo. El resto lo descubro yo.</h1>
      <p className="lede">Sólo te pregunto lo que nunca podría averiguar solo. Segmentos, mensajes, calendario, métricas y experimentos los aprendo yo.</p>
      <form className="card">
        <div className="q"><p className="ask">¿Cómo se llama tu empresa y qué vendes?</p><p className="hint">Con esto empiezo a construir tu contexto.</p>
          <input className="field" name="empresa" placeholder="Ej.: Aurora — software para ordenar la operación de pymes" /></div>
        <div className="q"><p className="ask">¿Cuál es tu objetivo ahora?</p><p className="hint">Trabajo para cumplir objetivos, no para lanzar campañas.</p>
          <input className="field" name="objetivo" placeholder="Ej.: darme a conocer entre pymes" /></div>
        <div className="q"><p className="ask">¿Cuánto presupuesto le asignas?</p><p className="hint">Lo respeto siempre; si algo no cabe, me abstengo.</p>
          <input className="field" name="presupuesto" placeholder="Ej.: 500 / mes (simulado por ahora)" /></div>
        <div className="q"><p className="ask">¿Hay algo que NO deba hacer?</p><p className="hint">Tus restricciones son ley para mí.</p>
          <input className="field" name="restricciones" placeholder="Ej.: no prometer resultados; no usar ‘garantizado’" /></div>
        <div className="q"><p className="ask">¿Qué me autorizas a hacer solo, y qué quieres aprobar tú?</p><p className="hint">Esto fija tu nivel de autonomía; lo cambias cuando quieras.</p>
          <input className="field" name="autonomia" placeholder="Ej.: ejecutar con mi aprobación" /></div>
      </form>
      <div className="foot" style={{ borderTop: 'none', marginTop: 16 }}>
        <Link href="/" className="btn primary">Empezar a trabajar</Link>
      </div>
      <p className="sim">Cinco preguntas. Nada de configurar módulos: SOEC no te pide lo que puede <b>obtener, inferir, aprender, medir o descubrir</b> por sí mismo.</p>
    </div>
  );
}
