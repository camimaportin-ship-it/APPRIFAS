/**
 * RuletaCanvas.js
 * -----------------------------------------------------------------------------
 * Ruleta de sorteo dibujada en <canvas>. IMPORTANTE sobre transparencia:
 * el GANADOR real siempre lo determina el backend (server.js) usando la
 * "semilla aleatoria" guardada en la tabla `ganadores`. Esta ruleta es la
 * capa VISUAL: recibe el número ganador ya decidido y gira hasta detenerse
 * exactamente en ese número, para que el video grabado sea una animación
 * honesta del resultado real (no una ruleta que decide por su cuenta).
 *
 * Optimizaciones de rendimiento:
 *  - La rueda estática (sectores + etiquetas) se pre-renderiza UNA vez en un
 *    canvas auxiliar (`_bake`). El bucle de animación solo rota ese canvas con
 *    drawImage(), por lo que no se vuelven a dibujar sectores/textos en cada
 *    frame: elimina el lag incluso con muchos participantes.
 *  - Con muchos participantes las etiquetas por sector serían ilegibles
 *    ("montón de números"), así que solo se dibujan cuando el sector es lo
 *    bastante ancho; siempre se acompaña de la lista de participantes en la UI.
 *
 * También permite grabar los últimos segundos de giro como archivo .webm
 * usando canvas.captureStream() + MediaRecorder, para descargarlo como
 * "Evidencia del sorteo".
 * -----------------------------------------------------------------------------
 */
class RuletaCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Array<{numero:number, nombre:string, label?:string}>} participantes - solo pagados
   */
  constructor(canvas, participantes) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.participantes = participantes || [];
    this.anguloActual = 0;
    this.colores = ['#0B1229', '#16213F', '#D4A017', '#E8B923'];
    this._mediaRecorder = null;
    this._chunks = [];
    this.videoBlobUrl = null;
    this._cache = null;
    this._winnerIdx = -1;
    this._mostrarGanador = false;
    this._bake();
    this.dibujar();
  }

  _radio() {
    const { canvas } = this;
    return Math.min(canvas.width, canvas.height) / 2 - 10;
  }

  /**
   * Pre-renderiza la rueda estática a un canvas auxiliar. Solo se llama una vez
   * al crear la ruleta y de nuevo al resaltar el sector ganador (barato: no es
   * parte del bucle de animación).
   */
  _bake() {
    const { canvas } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const radio = this._radio();
    const n = Math.max(this.participantes.length, 1);
    const anguloSegmento = (2 * Math.PI) / n;
    const sectorWidth = anguloSegmento * radio;

    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const o = off.getContext('2d');
    o.translate(cx, cy);

    this.participantes.forEach((p, i) => {
      const inicio = i * anguloSegmento;
      const fin = inicio + anguloSegmento;
      const esGanador = this._mostrarGanador && i === this._winnerIdx;

      o.beginPath();
      o.moveTo(0, 0);
      o.arc(0, 0, radio, inicio, fin);
      o.closePath();
      o.fillStyle = esGanador ? '#9A6B00' : this.colores[i % this.colores.length];
      o.fill();
      o.strokeStyle = '#F5F6F9';
      o.lineWidth = esGanador ? 5 : 2;
      o.stroke();

      o.save();
      o.rotate(inicio + anguloSegmento / 2);

      const label = '#' + (p.label != null ? p.label : p.numero);

      if (sectorWidth >= 70 && n <= 20) {
        // Sector amplio: número grande + nombre debajo
        const fontSize = Math.min(16, Math.max(10, Math.floor(sectorWidth / 7)));
        o.font = 'bold ' + fontSize + 'px Sora, sans-serif';
        o.textAlign = 'center';
        o.fillStyle = '#fff';
        o.fillText(label, radio * 0.62, -fontSize * 0.3);

        const maxNameChars = Math.max(4, Math.floor((sectorWidth - 10) / 6));
        const name = String(p.nombre || '').slice(0, maxNameChars);
        const nameSize = Math.min(11, Math.max(7, Math.floor(sectorWidth / 10)));
        o.font = 'bold ' + nameSize + 'px Sora, sans-serif';
        o.fillStyle = 'rgba(255,255,255,.85)';
        o.fillText(name, radio * 0.62, fontSize * 0.6);
      } else if (sectorWidth >= 28) {
        // Sector medio: solo número
        const fontSize = Math.min(14, Math.max(9, Math.floor(sectorWidth / 5)));
        o.font = 'bold ' + fontSize + 'px Sora, sans-serif';
        o.textAlign = 'center';
        o.fillStyle = '#fff';
        o.fillText(label, radio * 0.65, fontSize * 0.35);
      }

      o.restore();
    });

    // Aro exterior dorado
    o.beginPath();
    o.arc(0, 0, radio, 0, Math.PI * 2);
    o.strokeStyle = 'rgba(212,160,23,.55)';
    o.lineWidth = 4;
    o.stroke();

    this._cache = off;
  }

  /** Dibuja el estado actual de la ruleta (rueda pre-renderizada + UI fija) */
  dibujar() {
    const { ctx, canvas } = this;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const radio = this._radio();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this._cache) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.anguloActual);
      ctx.drawImage(this._cache, -cx, -cy);
      ctx.restore();
    }

    // Puntero fijo arriba
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - radio - 4);
    ctx.lineTo(cx + 14, cy - radio - 4);
    ctx.lineTo(cx, cy - radio + 22);
    ctx.closePath();
    ctx.fillStyle = '#D4A017';
    ctx.fill();

    // Centro
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#0B1229';
    ctx.fill();
    ctx.fillStyle = '#D4A017';
    ctx.font = 'bold 12px Sora, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GIRA', cx, cy + 4);

    // Etiqueta del ganador sobre el puntero al terminar el giro
    if (this._mostrarGanador && this._winnerIdx >= 0) {
      const p = this.participantes[this._winnerIdx];
      const txt = '🏆 #' + (p.label != null ? p.label : p.numero) + ' · ' + String(p.nombre || '').slice(0, 22);
      ctx.fillStyle = 'rgba(11,18,41,.72)';
      ctx.fillRect(cx - 92, cy - radio + 26, 184, 30);
      ctx.fillStyle = '#E8B923';
      ctx.font = 'bold 13px Sora, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(txt.slice(0, 32), cx, cy - radio + 45);
    }
  }

  /** Inicia la grabación del canvas como video (para la "evidencia") */
  iniciarGrabacion() {
    if (!this.canvas.captureStream) return false;
    if (this._mediaRecorder && this._mediaRecorder.state === 'recording') return false;
    const stream = this.canvas.captureStream(30);
    this._chunks = [];
    try {
      this._mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    } catch (e) {
      this._mediaRecorder = new MediaRecorder(stream);
    }
    this._mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this._chunks.push(e.data); };
    this._mediaRecorder.start();
    return true;
  }

  /** Detiene la grabación y devuelve una Promise con la URL del blob .webm */
  detenerGrabacion() {
    return new Promise((resolve) => {
      if (!this._mediaRecorder || this._mediaRecorder.state !== 'recording') return resolve(null);
      this._mediaRecorder.onstop = () => {
        const blob = new Blob(this._chunks, { type: 'video/webm' });
        this.videoBlobUrl = URL.createObjectURL(blob);
        resolve(this.videoBlobUrl);
      };
      this._mediaRecorder.stop();
    });
  }

  /**
   * Gira la ruleta hasta detenerse en `numeroGanador` (ya decidido por el
   * backend). Resalta el sector ganador y graba automáticamente ~5s de
   * animación como evidencia.
   * @returns {Promise<string>} URL del video grabado (blob)
   */
  async girarHasta(numeroGanador, duracionMs = 4500) {
    if (this._raf) cancelAnimationFrame(this._raf);
    const idx = this.participantes.findIndex(p => String(p.numero) === String(numeroGanador));
    if (idx === -1) throw new Error('El número ganador no está en la ruleta');

    this._winnerIdx = idx;
    this._mostrarGanador = false;
    this._bake();

    const n = this.participantes.length;
    const anguloSegmento = (2 * Math.PI) / n;
    // Ángulo objetivo: centro del segmento ganador, alineado con el puntero (arriba = -PI/2)
    const anguloObjetivoBase = -Math.PI / 2 - (idx * anguloSegmento + anguloSegmento / 2);
    const vueltasExtra = 6 * 2 * Math.PI; // varias vueltas completas para dramatismo
    const anguloFinal = anguloObjetivoBase - vueltasExtra;

    const anguloInicial = this.anguloActual;
    const distancia = anguloFinal - (anguloInicial % (2 * Math.PI));

    this.iniciarGrabacion();
    const inicio = performance.now();

    await new Promise((resolve) => {
      const paso = (ahora) => {
        const t = Math.min(1, (ahora - inicio) / duracionMs);
        const easeOut = 1 - Math.pow(1 - t, 4); // desaceleración tipo ruleta real
        this.anguloActual = anguloInicial + distancia * easeOut;
        this.dibujar();
        if (t < 1) requestAnimationFrame(paso);
        else resolve();
      };
      requestAnimationFrame(paso);
    });

    // Medio segundo extra grabando el resultado quieto, luego cortamos
    await new Promise(r => setTimeout(r, 600));
    this._mostrarGanador = true;
    this._bake();
    this.dibujar();
    return this.detenerGrabacion();
  }
}

// Exponer globalmente (sin módulos, script clásico)
window.RuletaCanvas = RuletaCanvas;
