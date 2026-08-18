/**
 * Política de Privacidad — superficie pública requerida por Meta App Review.
 * Describe qué datos procesa SOEC (SC INNOVATION SPA), incluido lo que llega desde Meta.
 */
export const metadata = { title: 'Política de Privacidad · SOEC' };

export default function PrivacidadPage(): React.ReactElement {
  return (
    <div className="wrap legal">
      <h1>Política de Privacidad</h1>
      <p className="mut">SOEC es un servicio de <b>SC INNOVATION SPA</b> (Chile). Última actualización: 2026-08-18.</p>

      <h2>1. Quiénes somos</h2>
      <p>SOEC es una plataforma que ayuda a pequeños negocios a dirigir su marketing digital. El responsable del tratamiento de datos es SC INNOVATION SPA. Puedes contactarnos en <a href="/soporte">soporte</a>.</p>

      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li><b>Datos de tu cuenta SOEC:</b> correo electrónico y datos de la organización que registras.</li>
        <li><b>Datos que autorizas desde Meta:</b> cuando conectas voluntariamente tu cuenta de Meta (Facebook/Instagram), accedemos <b>en modo lectura</b> a métricas de tus páginas, cuentas publicitarias y publicaciones (por ejemplo, impresiones, clics, alcance). No accedemos a mensajes privados ni a datos personales de terceros.</li>
        <li><b>Tokens de acceso de Meta:</b> se guardan cifrados (cifrado de sobre con clave gestionada) y nunca se exponen en la interfaz ni en registros.</li>
      </ul>

      <h2>3. Para qué los usamos</h2>
      <p>Usamos estos datos para mostrarte el estado de tu marketing, generar recomendaciones y —solo si tú lo autorizas explícitamente y dentro de un presupuesto máximo que tú fijas— preparar y gestionar campañas. SOEC nunca aumenta tu presupuesto autorizado por su cuenta.</p>

      <h2>4. Con quién los compartimos</h2>
      <p>No vendemos tus datos. Los compartimos únicamente con la API oficial de Meta para las operaciones que autorizas, y con proveedores de infraestructura que procesan datos por cuenta nuestra bajo acuerdos de confidencialidad.</p>

      <h2>5. Cuánto tiempo los conservamos</h2>
      <p>Conservamos los datos mientras mantengas tu cuenta activa. Puedes solicitar su eliminación en cualquier momento (ver <a href="/legal/eliminacion-datos">Eliminación de datos</a>).</p>

      <h2>6. Tus derechos</h2>
      <p>Puedes acceder, rectificar o eliminar tus datos, y revocar la conexión con Meta cuando quieras. Al revocar, dejamos de acceder a tus datos de Meta.</p>

      <h2>7. Seguridad</h2>
      <p>Aplicamos cifrado en tránsito y en reposo para las credenciales, aislamiento estricto entre organizaciones (multi-tenant) y acceso mínimo. Las escrituras hacia Meta ocurren solo a través de las APIs oficiales.</p>

      <p className="mut" style={{ marginTop: 24 }}><i>Documento en preparación para revisión legal final antes de la publicación definitiva.</i></p>
    </div>
  );
}
