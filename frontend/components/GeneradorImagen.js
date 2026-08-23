/**
 * GeneradorImagen.js
 * Genera piezas publicitarias de una rifa 100% en el navegador con canvas.
 *   - Post cuadrado  1080x1080 (escala 2x → 2160x2160)
 *   - Historia vertical 1080x1920 (escala 2x → 2160x3840)
 *
 * Orden de elementos:
 *   1. Logo (arriba-izquierda, opcional)
 *   2. Imagen del premio (recuadro + insignia GRAN PREMIO)
 *   3. Titulo de la rifa
 *   4. Pildora "BOLETA $X"
 *   5. Fecha del sorteo
 *   6. Responsables (empresa)
 *   7. Mensaje promocional (descripcion)
 *   8. Barra de progreso + texto vendidos/quedan
 *   9. QR de verificacion (caja blanca)
 *  10. Pie: telefono + logo
 *
 * Principio de layout: cada bloque declara su altura exacta y se dibuja
 * centrado. Nada se superpone y todo queda dentro de su contenedor.
 */
class GeneradorImagen {
  constructor(datos) {
    this.datos = datos;
  }

  static _cargarImagen(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Carga una imagen vía fetch con el token de sesión (para rutas que requieren auth,
  // ya que un <img> normal no puede enviar el header Authorization).
  static _cargarImagenAuth(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      let token = null;
      try { token = localStorage.getItem('rifassyc_token'); } catch (e) {}
      const opts = token ? { headers: { Authorization: 'Bearer ' + token } } : {};
      fetch(url, opts)
        .then(r => (r.ok ? r.blob() : Promise.reject()))
        .then(blob => {
          const img = new Image();
          img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
          img.onerror = () => { URL.revokeObjectURL(img.src); resolve(null); };
          img.src = URL.createObjectURL(blob);
        })
        .catch(() => resolve(null));
    });
  }

  static _formatoCOP(valor) {
    return '$' + Number(valor || 0).toLocaleString('es-CO');
  }

  static _formatoFecha(iso) {
    if (!iso) return '';
    const f = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''));
    return f.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  static _fechaSorteo(d) {
    let txt = GeneradorImagen._formatoFecha(d.fecha_sorteo);
    if (d.hora_sorteo) txt += ' \u00b7 ' + d.hora_sorteo;
    return txt;
  }

  static _rr(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  static _destello(ctx, x, y, r) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#E8B923';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const radio = i % 2 === 0 ? r : r * 0.3;
      const px = x + Math.cos(ang) * radio;
      const py = y + Math.sin(ang) * radio;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  static _rayos(ctx, w, h, alpha = 0.1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#E8B923';
    const cx = w / 2, cy = -60;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + 0.4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(h, -20);
      ctx.lineTo(h, 20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  static _fondo(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0B1229');
    grad.addColorStop(0.55, '#16213F');
    grad.addColorStop(1, '#0C1330');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w / 2, -80, 20, w / 2, -80, h * 0.55);
    glow.addColorStop(0, 'rgba(212,160,23,0.28)');
    glow.addColorStop(1, 'rgba(212,160,23,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    GeneradorImagen._rayos(ctx, w, h);

    const estrellas = [
      [64, 130, 14], [w - 90, 180, 11], [120, 360, 8],
      [w - 120, 390, 13], [200, 580, 9], [w - 170, 575, 8],
      [90, 720, 10], [w - 95, 715, 14], [w / 2, 140, 20]
    ];
    for (const [x, y, r] of estrellas) GeneradorImagen._destello(ctx, x, y, r);

    ctx.save();
    GeneradorImagen._rr(ctx, 18, 18, w - 36, h - 36, 30);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(212,160,23,0.55)';
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#D4A017';
    ctx.fillRect(0, 0, w, 8);
  }

  // ---- utilidades de texto ----
  static _medirLineas(ctx, texto, maxWidth) {
    const palabras = (texto || '').trim().split(/\s+/);
    let linea = '', lineas = [];
    for (const palabra of palabras) {
      const prueba = linea ? linea + ' ' + palabra : palabra;
      if (ctx.measureText(prueba).width > maxWidth && linea) {
        lineas.push(linea);
        linea = palabra;
      } else {
        linea = prueba;
      }
    }
    if (linea) lineas.push(linea);
    return lineas;
  }

  /**
   * Dibuja un bloque de texto centrado y devuelve la altura ocupada.
   * font: string de fuente ya aplicable.
   */
  static _bloqueTexto(ctx, texto, W, font, color, lineHeight, maxLines, y) {
    if (!texto) return 0;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    const lineas = GeneradorImagen._medirLineas(ctx, texto, W - 120).slice(0, maxLines);
    const h = lineas.length * lineHeight;
    lineas.forEach((l, i) => ctx.fillText(l, W / 2, y + lineHeight * (i + 0.75)));
    return h;
  }

  static _dibujarTarjetaPremio(ctx, img, x, y, w, h, producto) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 10;
    GeneradorImagen._rr(ctx, x, y, w, h, 22);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();

    ctx.save();
    GeneradorImagen._rr(ctx, x, y, w, h, 22);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#D4A017';
    ctx.stroke();
    ctx.clip();
    if (img) {
      const ratio = Math.max(w / img.width, h / img.height);
      const iw = img.width * ratio, ih = img.height * ratio;
      ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    } else {
      const pg = ctx.createLinearGradient(x, y, x, y + h);
      pg.addColorStop(0, '#FDF4E0');
      pg.addColorStop(1, '#EFE6C8');
      ctx.fillStyle = pg;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#B7950B';
      ctx.textAlign = 'center';
      ctx.font = 'bold 64px Sora, sans-serif';
      ctx.fillText('\u{1F381}', x + w / 2, y + h / 2 - 8);
      ctx.font = 'bold 28px Sora, sans-serif';
      ctx.fillText(producto || 'GRAN PREMIO', x + w / 2, y + h / 2 + 52);
    }
    ctx.restore();

    const badgeW = 210, badgeH = 42, bx = x + 16, by = y + 16;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    const bg = ctx.createLinearGradient(bx, 0, bx + badgeW, 0);
    bg.addColorStop(0, '#D4A017');
    bg.addColorStop(1, '#F2C14E');
    GeneradorImagen._rr(ctx, bx, by, badgeW, badgeH, badgeH / 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#0B1229';
    ctx.font = 'bold 18px Sora, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F381} GRAN PREMIO', bx + badgeW / 2, by + 28);
  }

  // ================================================================
  //  POST CUADRADO 1080x1080
  // ================================================================
  static _divisorOro(ctx, y, W, M) {
    ctx.save();
    ctx.strokeStyle = 'rgba(212,160,23,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M + 40, y);
    ctx.lineTo(W - M - 40, y);
    ctx.stroke();
    ctx.restore();
  }

  async generarPost(escala = 2) {
    const d = this.datos;
    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W * escala;
    canvas.height = H * escala;
    const ctx = canvas.getContext('2d');
    if (escala !== 1) ctx.scale(escala, escala);

    GeneradorImagen._fondo(ctx, W, H);

    const [imgProducto, logo, qr] = await Promise.all([
      GeneradorImagen._cargarImagen(d.imagenProductoUrl),
      GeneradorImagen._cargarImagen(d.logoUrl),
      GeneradorImagen._cargarImagenAuth(d.qrUrl)
    ]);

    const M = 60;
    const contentW = W - M * 2;
    const fechaTxt = GeneradorImagen._fechaSorteo(d);
    const valor = GeneradorImagen._formatoCOP(d.valor_boleta);
    const pillTxt = 'BOLETA  ' + valor;

    // --- Medición de bloques ---
    ctx.font = 'bold 52px Sora, sans-serif';
    const titLines = GeneradorImagen._medirLineas(ctx, d.nombre || d.producto, contentW).slice(0, 2);
    const hTit = titLines.length * 58;
    ctx.font = '19px Sora, sans-serif';
    const descLines = d.descripcion ? GeneradorImagen._medirLineas(ctx, d.descripcion, contentW).slice(0, 3) : [];
    const hDesc = descLines.length * 27;

    const cardH = 380;
    const pillH = 68, barBlockH = 50, qrBlockH = qr ? 116 + 22 + 26 : 0;
    const hFecha = fechaTxt ? 36 : 0;
    const hEmp = d.nombreEmpresa ? 30 : 0;
    const hFoot = d.telefono ? 30 : 0;

    // Secciones (altura fija medida + callback de dibujo)
    const secciones = [];
    if (logo) secciones.push({ h: 44, draw: (y) => {
      const lh = 44, lw = (logo.width / logo.height) * lh;
      ctx.drawImage(logo, M, y, Math.min(lw, 150), lh);
    }});
    secciones.push({ h: cardH, draw: (y) => GeneradorImagen._dibujarTarjetaPremio(ctx, imgProducto, M, y, contentW, cardH, d.producto) });
    secciones.push({ h: hTit, draw: (y) => {
      ctx.font = 'bold 52px Sora, sans-serif';
      ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
      titLines.forEach((l, i) => ctx.fillText(l, W / 2, y + 58 * (i + 0.78)));
    }});
    secciones.push({ h: pillH, draw: (y) => {
      ctx.font = 'bold 38px Sora, sans-serif';
      const tw = ctx.measureText(pillTxt).width;
      let pw = tw + 96; if (pw > contentW) pw = contentW;
      const px = (W - pw) / 2;
      ctx.save(); ctx.shadowColor = 'rgba(212,160,23,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 5;
      GeneradorImagen._rr(ctx, px, y, pw, pillH, pillH / 2);
      const g = ctx.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, '#D4A017'); g.addColorStop(0.55, '#F2C14E'); g.addColorStop(1, '#D4A017');
      ctx.fillStyle = g; ctx.fill(); ctx.restore();
      ctx.fillStyle = '#0B1229'; ctx.textAlign = 'center';
      ctx.fillText(pillTxt, px + pw / 2, y + pillH / 2 + 13);
    }});
    if (fechaTxt) secciones.push({ h: hFecha, draw: (y) => {
      const tw = ctx.measureText('\u{1F4C5}  ' + fechaTxt).width;
      const bw = Math.min(tw + 60, contentW), bx = (W - bw) / 2, bh = 38;
      GeneradorImagen._rr(ctx, bx, y, bw, bh, bh / 2);
      ctx.lineWidth = 2; ctx.strokeStyle = '#F2C14E'; ctx.stroke();
      ctx.fillStyle = '#F2C14E'; ctx.font = 'bold 22px Sora, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F4C5}  ' + fechaTxt, W / 2, y + 26);
    }});
    if (d.nombreEmpresa) secciones.push({ h: hEmp, draw: (y) => {
      ctx.fillStyle = '#F2C14E'; ctx.font = 'bold 22px Sora, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F464}  ' + d.nombreEmpresa, W / 2, y + 22);
    }});
    if (d.descripcion) secciones.push({ h: hDesc, draw: (y) => {
      ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.font = '19px Sora, sans-serif'; ctx.textAlign = 'center';
      descLines.forEach((l, i) => ctx.fillText(l, W / 2, y + 27 * (i + 0.8)));
    }});
    secciones.push({ h: barBlockH, draw: (y) => {
      const barH = 18;
      GeneradorImagen._rr(ctx, M, y, contentW, barH, barH / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();
      const pct = Math.max(0, Math.min(100, d.porcentaje || 0));
      const wf = Math.max(barH, (contentW * pct) / 100);
      GeneradorImagen._rr(ctx, M, y, wf, barH, barH / 2);
      const gb = ctx.createLinearGradient(M, 0, M + contentW, 0);
      gb.addColorStop(0, '#D4A017'); gb.addColorStop(1, '#F2C14E');
      ctx.fillStyle = gb; ctx.fill();
      ctx.font = 'bold 19px Sora, sans-serif'; ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
      ctx.fillText(Math.round(pct) + '% vendido  \u00b7  Quedan ' + (d.quedan || 0), W / 2, y + barH + 28);
    }});
    if (qr) secciones.push({ h: qrBlockH, draw: (y) => {
      const qs = 116, pad = 14, boxS = qs + pad * 2;
      const boxX = (W - boxS) / 2;
      GeneradorImagen._rr(ctx, boxX, y, boxS, boxS, 14);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.drawImage(qr, boxX + pad, y + pad, qs, qs);
      ctx.font = '14px Sora, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.textAlign = 'center';
      ctx.fillText('Verifica tu numero', W / 2, y + boxS + 18);
    }});
    if (d.telefono) secciones.push({ h: hFoot, draw: (y) => {
      ctx.fillStyle = '#F2C14E'; ctx.font = 'bold 22px Sora, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F4DE}  ' + d.telefono, W / 2, y + 22);
    }});

    // Distribuir para llenar todo el alto (justify)
    const totalH = secciones.reduce((s, x) => s + x.h, 0);
    const disponible = (H - 2 * M) - totalH;
    const gap = secciones.length > 1 ? Math.max(6, disponible / (secciones.length - 1)) : 0;
    let y = M;
    secciones.forEach((sec, i) => {
      sec.draw(y);
      y += sec.h + gap;
    });

    return canvas;
  }

  // ================================================================
  //  HISTORIA VERTICAL 1080x1920
  // ================================================================
  async generarHistoria(escala = 2) {
    const d = this.datos;
    const W = 1080, H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W * escala;
    canvas.height = H * escala;
    const ctx = canvas.getContext('2d');
    if (escala !== 1) ctx.scale(escala, escala);

    GeneradorImagen._fondo(ctx, W, H);

    const [imgProducto, logo, qr] = await Promise.all([
      GeneradorImagen._cargarImagen(d.imagenProductoUrl),
      GeneradorImagen._cargarImagen(d.logoUrl),
      GeneradorImagen._cargarImagenAuth(d.qrUrl)
    ]);

    const M = 90;
    const contentW = W - M * 2;
    const fechaTxt = GeneradorImagen._fechaSorteo(d);
    const valor = GeneradorImagen._formatoCOP(d.valor_boleta);
    const pillTxt = 'BOLETA  ' + valor;

    ctx.font = 'bold 72px Sora, sans-serif';
    const titLines = GeneradorImagen._medirLineas(ctx, d.nombre || d.producto, contentW).slice(0, 3);
    const hTit = titLines.length * 80;
    ctx.font = '25px Sora, sans-serif';
    const descLines = d.descripcion ? GeneradorImagen._medirLineas(ctx, d.descripcion, contentW).slice(0, 6) : [];
    const hDesc = descLines.length * 36;

    const cardH = 660;
    const pillH = 92, barBlockH = 60, qrBlockH = qr ? 160 + 40 + 30 : 0;
    const hFecha = fechaTxt ? 44 : 0;
    const hEmp = d.nombreEmpresa ? 36 : 0;
    const hFoot = d.telefono ? 36 : 0;

    const secciones = [];
    if (logo) secciones.push({ h: 52, draw: (y) => {
      const lh = 52, lw = (logo.width / logo.height) * lh;
      ctx.drawImage(logo, M, y, Math.min(lw, 200), lh);
    }});
    secciones.push({ h: cardH, draw: (y) => GeneradorImagen._dibujarTarjetaPremio(ctx, imgProducto, M, y, contentW, cardH, d.producto) });
    secciones.push({ h: hTit, draw: (y) => {
      ctx.font = 'bold 72px Sora, sans-serif';
      ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
      titLines.forEach((l, i) => ctx.fillText(l, W / 2, y + 80 * (i + 0.78)));
    }});
    secciones.push({ h: pillH, draw: (y) => {
      ctx.font = 'bold 50px Sora, sans-serif';
      const tw = ctx.measureText(pillTxt).width;
      let pw = tw + 120; if (pw > contentW) pw = contentW;
      const px = (W - pw) / 2;
      ctx.save(); ctx.shadowColor = 'rgba(212,160,23,0.5)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 5;
      GeneradorImagen._rr(ctx, px, y, pw, pillH, pillH / 2);
      const g = ctx.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, '#D4A017'); g.addColorStop(0.55, '#F2C14E'); g.addColorStop(1, '#D4A017');
      ctx.fillStyle = g; ctx.fill(); ctx.restore();
      ctx.fillStyle = '#0B1229'; ctx.textAlign = 'center';
      ctx.fillText(pillTxt, px + pw / 2, y + pillH / 2 + 17);
    }});
    if (fechaTxt) secciones.push({ h: hFecha, draw: (y) => {
      const tw = ctx.measureText('\u{1F4C5}  ' + fechaTxt).width;
      const bw = Math.min(tw + 80, contentW), bx = (W - bw) / 2, bh = 50;
      GeneradorImagen._rr(ctx, bx, y, bw, bh, bh / 2);
      ctx.lineWidth = 2; ctx.strokeStyle = '#F2C14E'; ctx.stroke();
      ctx.fillStyle = '#F2C14E'; ctx.font = 'bold 30px Sora, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F4C5}  ' + fechaTxt, W / 2, y + 34);
    }});
    if (d.nombreEmpresa) secciones.push({ h: hEmp, draw: (y) => {
      ctx.fillStyle = '#F2C14E'; ctx.font = 'bold 30px Sora, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F464}  ' + d.nombreEmpresa, W / 2, y + 26);
    }});
    if (d.descripcion) secciones.push({ h: hDesc, draw: (y) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '25px Sora, sans-serif'; ctx.textAlign = 'center';
      descLines.forEach((l, i) => ctx.fillText(l, W / 2, y + 36 * (i + 0.8)));
    }});
    secciones.push({ h: barBlockH, draw: (y) => {
      const barH = 24;
      GeneradorImagen._rr(ctx, M, y, contentW, barH, barH / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();
      const pct = Math.max(0, Math.min(100, d.porcentaje || 0));
      const wf = Math.max(barH, (contentW * pct) / 100);
      GeneradorImagen._rr(ctx, M, y, wf, barH, barH / 2);
      const gb = ctx.createLinearGradient(M, 0, M + contentW, 0);
      gb.addColorStop(0, '#D4A017'); gb.addColorStop(1, '#F2C14E');
      ctx.fillStyle = gb; ctx.fill();
      ctx.font = 'bold 26px Sora, sans-serif'; ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
      ctx.fillText(Math.round(pct) + '% vendido  \u00b7  Quedan ' + (d.quedan || 0), W / 2, y + barH + 36);
    }});
    if (qr) secciones.push({ h: qrBlockH, draw: (y) => {
      const qs = 160, pad = 18, boxS = qs + pad * 2;
      const boxX = (W - boxS) / 2;
      GeneradorImagen._rr(ctx, boxX, y, boxS, boxS, 18);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.drawImage(qr, boxX + pad, y + pad, qs, qs);
      ctx.font = '20px Sora, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'center';
      ctx.fillText('Escanea y verifica tu numero', W / 2, y + boxS + 28);
    }});
    if (d.telefono) secciones.push({ h: hFoot, draw: (y) => {
      ctx.fillStyle = '#F2C14E'; ctx.font = 'bold 30px Sora, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F4DE}  Contacto: ' + d.telefono, W / 2, y + 28);
    }});

    const totalH = secciones.reduce((s, x) => s + x.h, 0);
    const disponible = (H - 2 * M) - totalH;
    const gap = secciones.length > 1 ? Math.max(8, disponible / (secciones.length - 1)) : 0;
    let y = M;
    secciones.forEach((sec) => { sec.draw(y); y += sec.h + gap; });

    return canvas;
  }

  static descargarPNG(canvas, nombreArchivo, formato = 'png') {
    const esJpeg = formato === 'jpeg';
    const link = document.createElement('a');
    link.download = nombreArchivo.replace(/\.(png|jpg|jpeg)$/i, esJpeg ? '.jpg' : '.png');
    link.href = canvas.toDataURL(esJpeg ? 'image/jpeg' : 'image/png', esJpeg ? 0.92 : 1);
    link.click();
  }
}

window.GeneradorImagen = GeneradorImagen;
