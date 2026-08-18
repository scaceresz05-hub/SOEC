/**
 * Contacto / Soporte — superficie pública requerida por Meta App Review.
 */
export const metadata = { title: 'Soporte · SOEC' };

export default function SoportePage(): React.ReactElement {
  return (
    <div className="wrap legal">
      <h1>Soporte y contacto</h1>
      <p className="mut">SOEC es un servicio de <b>SC INNOVATION SPA</b> (Chile).</p>

      <h2>Contacto</h2>
      <p>Para soporte, preguntas sobre privacidad o solicitudes de eliminación de datos, escríbenos a: <b>contacto.soec@gmail.com</b>.</p>
      <p>Respondemos en un plazo razonable, normalmente dentro de 2 días hábiles.</p>

      <h2>Enlaces útiles</h2>
      <ul>
        <li><a href="/legal/privacidad">Política de Privacidad</a></li>
        <li><a href="/legal/terminos">Términos de Servicio</a></li>
        <li><a href="/legal/eliminacion-datos">Eliminación de datos</a></li>
      </ul>

      <p className="mut" style={{ marginTop: 24 }}><i>La dirección de contacto puede actualizarse antes de la publicación definitiva.</i></p>
    </div>
  );
}
