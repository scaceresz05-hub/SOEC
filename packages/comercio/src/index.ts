/**
 * @soec/comercio — MODELO GENÉRICO DE COMERCIO ELECTRÓNICO para SOEC.
 *
 * Nace para que SOEC pueda entender un e-commerce sin quedar atado a una empresa ni a una
 * plataforma. Distribuidora C Y P (WooCommerce) es su primer consumidor; una tercera organización
 * de comercio debe poder reutilizarlo tal cual.
 *
 * Lo que el paquete garantiza POR TIPO, no por convención:
 *   · el SKU NUNCA es clave: la identidad es `organizationId + source + externalId`;
 *   · «desconocido» ╪ «cero» (`DesconocidoOValor`, precios `null`, `NOT_INSTRUMENTED`);
 *   · una relación que la fuente no demuestra queda `NO_DEMOSTRABLE`, no se inventa;
 *   · las fuentes de catálogo son SÓLO LECTURA: el contrato no expone ninguna escritura.
 *
 * Sin red, sin reloj, sin aleatoriedad: el instante de observación se inyecta.
 */
export * from './dominio/catalogo';
export * from './dominio/pedido';
export * from './dominio/embudo';
export * from './dominio/calidad';
export * from './dominio/snapshot';
export * from './dominio/venta';
export * from './dominio/ventas-resumen';
export * from './puertos';
export * from './app/catalogo-service';
export * from './app/ventas-service';
