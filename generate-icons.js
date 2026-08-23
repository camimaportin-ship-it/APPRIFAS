// Genera iconos PNG 192x192 y 512x512 para la PWA usando puro Node.js (sin dependencias)
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c = 0xffffffff;
  const tbl = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    tbl[n] = v;
  }
  for (let i = 0; i < buf.length; i++) c = tbl[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makePNG(w, h, pixels) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const body = Buffer.concat([typeB, data]);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crcB]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw image data with filter bytes
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const idx = y * (1 + w * 3) + 1 + x * 3;
      const pIdx = (y * w + x) * 3;
      raw[idx] = pixels[pIdx];
      raw[idx + 1] = pixels[pIdx + 1];
      raw[idx + 2] = pixels[pIdx + 2];
    }
  }

  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function generateIcon(size) {
  const pixels = Buffer.alloc(size * size * 3);
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.38;
  const cornerR = size * 0.16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pIdx = (y * size + x) * 3;

      // Rounded rectangle background
      let inside = false;
      if (x >= cornerR && x <= size - cornerR && y >= 0 && y <= size) inside = true;
      if (x >= 0 && x <= size && y >= cornerR && y <= size - cornerR) inside = true;
      // Corners
      const corners = [
        [cornerR, cornerR], [size - cornerR, cornerR],
        [cornerR, size - cornerR], [size - cornerR, size - cornerR]
      ];
      for (const [ccx, ccy] of corners) {
        const dx = x - ccx, dy = y - ccy;
        if (dx * dx + dy * dy <= cornerR * cornerR) inside = true;
      }

      if (inside) {
        // Background: #0B1229
        pixels[pIdx] = 0x0B;
        pixels[pIdx + 1] = 0x12;
        pixels[pIdx + 2] = 0x29;

        // Letter "R" in gold #D4A017
        const lx = x - cx, ly = y - cy;
        const ls = size / 100;
        const inR =
          // Vertical stem
          (lx >= -18 * ls && lx <= -10 * ls && ly >= -22 * ls && ly <= 22 * ls) ||
          // Top bar
          (lx >= -18 * ls && lx <= 8 * ls && ly >= -22 * ls && ly <= -14 * ls) ||
          // Middle bar
          (lx >= -18 * ls && lx <= 4 * ls && ly >= -4 * ls && ly <= 4 * ls) ||
          // Diagonal leg
          (lx >= -6 * ls && lx <= 14 * ls && ly >= 4 * ls && ly <= 22 * ls &&
           lx >= (-6 + (ly - 4 * ls) * 20 / 18) * ls - 4 * ls);

        if (inR) {
          pixels[pIdx] = 0xD4;
          pixels[pIdx + 1] = 0xA0;
          pixels[pIdx + 2] = 0x17;
        }
      } else {
        // Transparent area → white (PNG doesn't support alpha in RGB mode)
        pixels[pIdx] = 0xF5;
        pixels[pIdx + 1] = 0xF6;
        pixels[pIdx + 2] = 0xF9;
      }
    }
  }
  return pixels;
}

const outDir = path.join(__dirname, 'frontend', 'icons');

console.log('Generando icon-192.png...');
const px192 = generateIcon(192);
fs.writeFileSync(path.join(outDir, 'icon-192.png'), makePNG(192, 192, px192));

console.log('Generando icon-512.png...');
const px512 = generateIcon(512);
fs.writeFileSync(path.join(outDir, 'icon-512.png'), makePNG(512, 512, px512));

console.log('OK: iconos generados en', outDir);
