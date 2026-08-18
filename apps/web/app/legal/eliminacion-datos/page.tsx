/**
 * Instrucciones de eliminación de datos — superficie pública requerida por Meta App Review.
 * Describe cómo un usuario solicita la eliminación de sus datos y cómo funciona el callback de Meta.
 */
export const metadata = { title: 'Eliminación de datos · SOEC' };

export default function EliminacionDatosPage(): React.ReactElement {
  return (
    <div className="wrap legal">
      <h1>Eliminación de datos</h1>
      <p className="mut">Servicio operado por <b>SC INNOVATION SPA</b>. Última actualización: 2026-08-18.</p>

      <h2>Cómo eliminar tus datos</h2>
      <p>Tienes dos formas de solicitar la eliminación de los datos que SOEC guarda sobre ti y sobre tu conexión con Meta:</p>
      <ol>
        <li><b>Desde SOEC:</b> revoca la conexión con Meta en la sección <i>Conexión Meta</i> y solicita la eliminación de tu cuenta escribiéndonos a <a href="/soporte">soporte</a>. Eliminamos tus datos de conexión (tokens y métricas almacenadas) en un plazo máximo de 30 días.</li>
        <li><b>Desde Facebook:</b> si eliminas la app SOEC desde la configuración de tu cuenta de Facebook, Meta nos envía automáticamente una solicitud de eliminación. Procesamos esa solicitud y podrás consultar su estado con el código de confirmación que se genera.</li>
      </ol>

      <h2>Qué eliminamos</h2>
      <p>Eliminamos el token de acceso cifrado y las métricas de tu conexión con Meta almacenadas en SOEC. SOEC no almacena datos personales de terceros ni mensajes privados.</p>

      <h2>Callback de eliminación</h2>
      <p>La solicitud automática de Meta se procesa en nuestro endpoint de eliminación de datos, que verifica la firma de Meta y registra la solicitud con un código de confirmación. El estado puede consultarse en la URL de seguimiento que devuelve ese proceso.</p>

      <p className="mut" style={{ marginTop: 24 }}><i>Documento en preparación para revisión legal final antes de la publicación definitiva.</i></p>
    </div>
  );
}
