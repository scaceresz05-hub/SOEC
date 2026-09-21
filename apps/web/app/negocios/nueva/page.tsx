'use client';

/**
 * NUEVA EMPRESA — alta en un paso, sin una línea de código.
 *
 * Preguntas de NEGOCIO, no de plataforma publicitaria: cómo se llama, a qué se dedica, dónde opera y qué
 * quiere conseguir. Nada de identificadores de cuentas, tokens, CPC ni etiquetas de conversión: eso pertenece
 * a conectar las cuentas, más adelante, y pedirlo aquí obligaría a saber marketing técnico para empezar.
 *
 * La empresa nace apagada: sin mutaciones externas, sin gasto y sin ejecución de campañas. Crear una empresa
 * nunca puede gastar dinero.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { crearNegocio, TIPOS_DE_NEGOCIO, type TipoNegocio } from '../../../lib/negocios-client';
import { fijarOrgActiva } from '../../../lib/org-activa';

const PAISES = [
  { codigo: 'CL', nombre: 'Chile', moneda: 'CLP', zona: 'America/Santiago' },
  { codigo: 'AR', nombre: 'Argentina', moneda: 'ARS', zona: 'America/Argentina/Buenos_Aires' },
  { codigo: 'MX', nombre: 'México', moneda: 'MXN', zona: 'America/Mexico_City' },
  { codigo: 'CO', nombre: 'Colombia', moneda: 'COP', zona: 'America/Bogota' },
  { codigo: 'PE', nombre: 'Perú', moneda: 'PEN', zona: 'America/Lima' },
  { codigo: 'ES', nombre: 'España', moneda: 'EUR', zona: 'Europe/Madrid' },
];

export default function NuevaEmpresaPage() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoNegocio>('SERVICIOS');
  const [pais, setPais] = useState('CL');
  const [moneda, setMoneda] = useState('CLP');
  const [zona, setZona] = useState('America/Santiago');
  const [sitio, setSitio] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  /** Al cambiar el país se proponen moneda y zona horaria; ambas siguen siendo editables. */
  function cambiarPais(codigo: string): void {
    const p = PAISES.find((x) => x.codigo === codigo);
    setPais(codigo);
    if (p) { setMoneda(p.moneda); setZona(p.zona); }
  }

  async function crear(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setCreando(true);
    try {
      const negocio = await crearNegocio({
        displayName: nombre,
        businessType: tipo,
        country: pais,
        currency: moneda,
        timezone: zona,
        website: sitio || null,
        description: descripcion || null,
        primaryObjective: objetivo || null,
      });
      fijarOrgActiva(negocio.perfil.organizationId); // queda como empresa activa: se abre su panel
      router.push('/negocios');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'no se pudo crear la empresa');
      setCreando(false);
    }
  }

  return (
    <main className="wrap" style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ marginBottom: 8 }}><Link href="/negocios">← Volver</Link></p>
      <h1 style={{ marginBottom: 4 }}>Nueva empresa</h1>
      <p style={{ color: 'var(--muted, #666)', marginBottom: 24 }}>
        Con esto basta para empezar. Las cuentas de publicidad y la medición se conectan después, cuando tú lo
        decidas: la empresa se crea sin permisos de gasto.
      </p>

      <form onSubmit={(e) => void crear(e)}>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Nombre comercial *</span>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Clínica CP" style={{ width: '100%', padding: 8 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>¿Qué tipo de negocio es? *</span>
          <select required value={tipo} onChange={(e) => setTipo(e.target.value as TipoNegocio)} style={{ width: '100%', padding: 8 }}>
            {TIPOS_DE_NEGOCIO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <label style={{ flex: '1 1 180px' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>País *</span>
            <select required value={pais} onChange={(e) => cambiarPais(e.target.value)} style={{ width: '100%', padding: 8 }}>
              {PAISES.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
            </select>
          </label>
          <label style={{ flex: '1 1 120px' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Moneda *</span>
            <input required value={moneda} onChange={(e) => setMoneda(e.target.value.toUpperCase())} maxLength={3} style={{ width: '100%', padding: 8 }} />
          </label>
          <label style={{ flex: '1 1 220px' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Zona horaria *</span>
            <input required value={zona} onChange={(e) => setZona(e.target.value)} style={{ width: '100%', padding: 8 }} />
          </label>
        </div>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Sitio web</span>
          <input value={sitio} onChange={(e) => setSitio(e.target.value)} placeholder="https://tuempresa.cl" style={{ width: '100%', padding: 8 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>¿A qué se dedica?</span>
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} placeholder="Una frase basta" style={{ width: '100%', padding: 8 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>¿Qué quieres conseguir?</span>
          <input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Por ejemplo: más pacientes nuevos" style={{ width: '100%', padding: 8 }} />
        </label>

        {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}

        <button type="submit" disabled={creando || nombre.trim() === ''} className="btn" style={{ padding: '10px 18px', fontWeight: 600 }}>
          {creando ? 'Creando…' : 'Crear empresa'}
        </button>
      </form>
    </main>
  );
}
