'use client';

/**
 * Estado de una solicitud de eliminación de datos. Es la URL de seguimiento que devuelve el callback de Meta
 * (`/eliminacion-datos/estado?code=...`). Muestra el código de confirmación y el estado de la solicitud.
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function EstadoEliminacionPage(): React.ReactElement {
  return (
    <Suspense fallback={<div className="wrap legal"><h1>Solicitud de eliminación de datos</h1><p className="mut">Cargando…</p></div>}>
      <EstadoContenido />
    </Suspense>
  );
}

function EstadoContenido(): React.ReactElement {
  const params = useSearchParams();
  const code = params.get('code') ?? '';
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    void fetch(`/api/backend/meta/data-deletion/estado?code=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setEstado(j?.datos?.estado ?? 'RECIBIDA'))
      .catch(() => setEstado('RECIBIDA'));
  }, [code]);

  return (
    <div className="wrap legal">
      <h1>Solicitud de eliminación de datos</h1>
      {code ? (
        <>
          <p>Tu solicitud fue registrada. Código de confirmación:</p>
          <p><b style={{ fontFamily: 'monospace' }}>{code}</b></p>
          <p>Estado: <b>{estado ?? 'consultando…'}</b></p>
          <p className="mut">Eliminamos los datos de tu conexión con Meta (token cifrado y métricas almacenadas) en un plazo máximo de 30 días. Ante cualquier duda, escríbenos a <a href="/soporte">soporte</a>.</p>
        </>
      ) : (
        <p>Falta el código de confirmación. Si llegaste aquí desde Facebook, vuelve a intentar la eliminación o contáctanos en <a href="/soporte">soporte</a>.</p>
      )}
    </div>
  );
}
