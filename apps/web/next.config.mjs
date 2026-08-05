/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Los errores de tipos SÍ deben detener el build.
  typescript: { ignoreBuildErrors: false },
  // Los motores M5–M9 se publican como TypeScript (./src/index.ts); Next debe transpilarlos.
  transpilePackages: [
    '@soec/contracts', '@soec/event-store', '@soec/motor-estrategico', '@soec/motor-creativo',
    '@soec/estrategia-creativa', '@soec/contenido', '@soec/motor-operacion', '@soec/motor-medicion',
    '@soec/motor-optimizacion',
  ],
  // PCE-1: la navegación por MOTORES desaparece del producto. El usuario nunca ve módulos internos;
  // cualquier ruta de módulo redirige a la experiencia de Director. (Las páginas quedan inaccesibles.)
  async redirects() {
    const modulos = ['/evaluacion', '/director-workspace', '/control', '/piloto', '/marketing', '/contenido', '/canales', '/medicion', '/historial'];
    return [
      ...modulos.map((source) => ({ source, destination: '/', permanent: false })),
      { source: '/director-autonomo/:path*', destination: '/', permanent: false },
      { source: '/analisis/:path*', destination: '/', permanent: false },
    ];
  },
};

export default nextConfig;
