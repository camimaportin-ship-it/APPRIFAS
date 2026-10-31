// seguridad.js
// -----------------------------------------------------------------------------
// Utilidades de seguridad compartidas por el servidor:
//  - Lista blanca de imágenes (bloquea SVG/HTML disfrazado: XSS almacenado).
//  - Saneamiento de nombres de archivo.
//  - Verificación de la firma de eventos de Wompi (evita webhooks falsos que
//    marcarían pagos como aprobados).
// -----------------------------------------------------------------------------
const crypto = require('crypto');

// Solo formatos raster: SVG puede contener JavaScript y ejecutarse inline.
const IMAGENES_PERMITIDAS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_IMAGEN_PERMITIDA = /\.(jpe?g|png|webp|gif)$/i;

function esImagenPermitida(file) {
  if (!file) return false;
  const mime = String(file.mimetype || '').toLowerCase();
  const nombre = String(file.originalname || '');
  return IMAGENES_PERMITIDAS.has(mime) && EXT_IMAGEN_PERMITIDA.test(nombre);
}

function nombreArchivoSeguro(nombre) {
  const limpio = String(nombre || '')
    .replace(/[^\w.\- ]+/g, '_') // separadores y símbolos fuera
    .replace(/\.{2,}/g, '.')     // colapsa ".." (evita rutas relativas)
    .replace(/^\.+/, '')         // sin punto inicial (archivos ocultos)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return limpio || 'archivo';
}

// Wompi: checksum = SHA-256( valores de signature.properties + timestamp + secreto )
// La comparación es en tiempo constante para no filtrar información.
function firmaWompiValida(cuerpo, secreto) {
  try {
    const propiedades = cuerpo?.signature?.properties;
    const checksum = cuerpo?.signature?.checksum;
    if (!Array.isArray(propiedades) || !checksum || !secreto) return false;

    const valores = propiedades.map((ruta) => {
      let valor = cuerpo;
      for (const parte of String(ruta).split('.')) {
        valor = valor == null ? undefined : valor[parte];
      }
      return valor == null ? '' : String(valor);
    });
    const base = valores.join('') + String(cuerpo?.timestamp ?? '') + String(secreto);
    const calculado = crypto.createHash('sha256').update(base).digest('hex');
    const a = Buffer.from(calculado);
    const b = Buffer.from(String(checksum).toLowerCase());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

module.exports = { IMAGENES_PERMITIDAS, esImagenPermitida, nombreArchivoSeguro, firmaWompiValida };
