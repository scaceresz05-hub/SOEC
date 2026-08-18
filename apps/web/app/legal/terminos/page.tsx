/**
 * Términos de Servicio — superficie pública requerida por Meta App Review.
 */
export const metadata = { title: 'Términos de Servicio · SOEC' };

export default function TerminosPage(): React.ReactElement {
  return (
    <div className="wrap legal">
      <h1>Términos de Servicio</h1>
      <p className="mut">Servicio operado por <b>SC INNOVATION SPA</b> (Chile). Última actualización: 2026-08-18.</p>

      <h2>1. Objeto</h2>
      <p>SOEC te ayuda a observar y dirigir el marketing digital de tu negocio. Al usar SOEC aceptas estos términos.</p>

      <h2>2. Conexión con Meta</h2>
      <p>La conexión con Meta (Facebook/Instagram) es voluntaria. Tú eliges qué activos conectar. SOEC accede a esos datos según los permisos que apruebes y siempre a través de las APIs oficiales de Meta.</p>

      <h2>3. Control del presupuesto y autonomía</h2>
      <ul>
        <li>Tú fijas un <b>presupuesto máximo autorizado</b>. SOEC opera siempre dentro de ese tope y <b>nunca lo aumenta</b> por su cuenta.</li>
        <li>Cualquier propuesta que implique más dinero queda pendiente de tu aprobación explícita.</li>
        <li>Puedes pausar o revocar la autonomía en cualquier momento, con efecto inmediato.</li>
      </ul>

      <h2>4. Uso aceptable</h2>
      <p>Te comprometes a usar SOEC conforme a la ley y a las políticas de Meta. SOEC no realiza prácticas que imiten actividad humana ni que evadan los controles de Meta.</p>

      <h2>5. Sin garantías de resultados</h2>
      <p>SOEC no garantiza resultados comerciales específicos. Las recomendaciones se basan en los datos observados y se presentan como tales.</p>

      <h2>6. Responsabilidad</h2>
      <p>En la máxima medida permitida por la ley, SC INNOVATION SPA no será responsable por daños indirectos derivados del uso del servicio.</p>

      <h2>7. Contacto</h2>
      <p>Dudas sobre estos términos: <a href="/soporte">soporte</a>.</p>

      <p className="mut" style={{ marginTop: 24 }}><i>Documento en preparación para revisión legal final antes de la publicación definitiva.</i></p>
    </div>
  );
}
