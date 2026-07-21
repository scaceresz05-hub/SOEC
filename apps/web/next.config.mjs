/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Los errores de tipos SÍ deben detener el build.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
