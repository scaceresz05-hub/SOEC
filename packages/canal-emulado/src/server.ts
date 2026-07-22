/**
 * Arranque autónomo del proveedor de canal emulado (solo desarrollo/pruebas).
 * Escucha en EMU_PORT (por defecto 4600). No es una plataforma pública real.
 */
import { buildEmulador } from './emulador';

const port = Number(process.env.EMU_PORT ?? 4600);
const { app } = buildEmulador();
app
  .listen({ port, host: '127.0.0.1' })
  .then((addr) => console.log(JSON.stringify({ emulador: addr })))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
