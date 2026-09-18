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
 *
 * Efectos de sonido (Web Audio API):
 *  - Sonido de giro continuo con modulación de frecuencia
 *  - "Ticks" auditivos al pasar cada sector
 *  - "Ding" final al detenerse
 *  - Efecto de celebración al ganar
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
    this._audioContext = null;
    this._audioEnabled = false;
    this._tickPlaying = false;
    this._bake();
    this.dibujar();
    this._initAudio();
  }

  /**
   * Inicializa el contexto de audio Web Audio API para efectos de sonido.
   * Se crea bajo demanda por políticas de navegador.
   */
  _initAudio() {
    try { this._audioContext = new (window.AudioContext || window.webkitAudioContext)(); this._audioEnabled = true; } catch (e) { this._audioEnabled = false; }
  }

  /**
   * Toca un sonido de "tick" corto al pasar un sector.
   */
  _playTick() {
    if (!this._audioEnabled || this._tickPlaying) return;
    this._tickPlaying = true;
    const osc = this._audioContext.createOscillator();
    const gain = this._audioContext.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(this._audioContext.destination);
    osc.start();
    osc.stop(this._audioContext.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, this._audioContext.currentTime + 0.05);
    setTimeout(() => { this._tickPlaying = false; }, 60);
  }

  /**
   * Toca el sonido de giro continuo con modulación.
   * @param {boolean} start - true para iniciar, false para detener
   */
  _setSpinSound(start) {
    if (!this._audioEnabled) return;
    if (start) {
      if (this._spinOsc) return; // ya está sonando
      this._spinOsc = this._audioContext.createOscillator();
      this._spinGain = this._audioContext.createGain();
      this._spinLfo = this._audioContext.createGain();
      this._spinOsc.type = 'sine';
      this._spinOsc.frequency.value = 440;
      this._spinLfo.gain.value = 5;
      this._spinLfo.type = 'sine';
      this._spinLfo.frequency.value = 5; // 5 Hz modulación
      this._spinOsc.frequency.setValueAtTime(440, this._audioContext.currentTime);
      this._spinOsc.frequency.linearRampToValueAtTime(880, this._audioContext.currentTime + 5);
      this._spinLfo.connect(this._spinOsc.frequency);
      this._spinOsc.connect(this._spinGain);
      this._spinGain.gain.value = 0.3;
      this._spinGain.connect(this._audioContext.destination);
      this._spinOsc.start();
      this._spinLfo.start();
    } else {
      if (this._spinOsc) {
        this._spinOsc.stop();
        this._spinOsc = null;
        this._spinGain = null;
        this._spinLfo = null;
      }
    }
  }

  /**
   * Detiene todos los sonidos en curso.
   */
  _stopAllSounds() {
    this._setSpinSound(false);
    this._tickPlaying = false;
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
   * animación como evidencia. Efecto dramático: comienza rápido, luego se
   * desacelera lentamente con "ticks" cada sector, y al detenerse muestra
   * un modal de confeti con el ganador.
   * @param {number} numeroGanador - número ganador ya decidido por backend
   * @param {number} duracionMs - duración total en ms (default 5000)
   * @returns {Promise<string>} URL del video grabado (blob)
   */
  async girarHasta(numeroGanador, duracionMs = 5000) {
    if (this._raf) cancelAnimationFrame(this._raf);
    const idx = this.participantes.findIndex(p => String(p.numero) === String(numeroGanador));
    if (idx === -1) throw new Error('El número ganador no está en la ruleta');

    this._winnerIdx = idx;
    this._mostrarGanador = false;
    this._bake();

    // Iniciar sonido de giro
    this._setSpinSound(true);
    this.iniciarGrabacion();
    const inicio = performance.now();

    const n = this.participantes.length;
    const anguloSegmento = (2 * Math.PI) / n;
    // Ángulo objetivo: centro del segmento ganador, alineado con el puntero (arriba = -PI/2)
    const anguloObjetivoBase = -Math.PI / 2 - (idx * anguloSegmento + anguloSegmento / 2);
    // 6 vueltas completas + ángulo base para aterrizar en el ganador
    const vueltasExtra = 6 * 2 * Math.PI;
    const anguloFinal = anguloObjetivoBase - vueltasExtra;

    const anguloInicial = this.anguloActual;
    // Distancia total a recorrer (incluye vueltas extra para dramatismo)
    const distanciaTotal = anguloFinal - (anguloInicial % (2 * Math.PI));

    // Para efectos de "tick" cada sector: calculamos cuántos radianes por tick
    const radPorTick = anguloSegmento / 2; // half sector para ticks más frecuentes

    // Programa ticks cada ~100ms durante el giro
    const tickInterval = setInterval(() => { if (this._audioEnabled && !this._tickPlaying) this._playTick(); }, 100);
    const tickTimeout = setTimeout(() => { clearInterval(tickInterval); }, duracionMs + 100);

    await new Promise((resolve) => {
      const paso = (ahora) => {
        const t = Math.min(1, (ahora - inicio) / duracionMs);
        // Easing dramático: más lento al final (potencia 5 en lugar de 4)
        const easeOut = 1 - Math.pow(1 - t, 5);

        this.anguloActual = anguloInicial + distanciaTotal * easeOut;
        this.dibujar();
        if (t < 1) requestAnimationFrame(paso);
        else {
          // Cancelar ticks programados
          clearInterval(tickInterval);
          clearTimeout(tickTimeout);
          // ¡Ganador!
          this._setSpinSound(false);
          this._mostrarGanador = true;
          this._bake();
          this.dibujar();
          // Pequeña pausa para que se vea el ganador quieto
          setTimeout(() => { this._showGanarModal(); }, 400);
          resolve();
        }
      };
      requestAnimationFrame(paso);
    });

    return this.detenerGrabacion();
  }

  /**
   * Muestra un modal grande con confeti y el mensaje del ganador.
   */
  _showGanarModal() {
    const ganador = this.participantes[this._winnerIdx];
    const mensaje = `El feliz ganador es: ${ganador.nombre || ganador.label || '#' + ganador.numero}`;

    // Crear confetti simple con canvas
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    const particles = [];
    const coloresConfetti = ['#D4A017', '#16213F', '#E8B923', '#0B1229'];
    for (let i = 0; i < 120; i++) {
      const size = Math.random() * 8 + 4;
      const x = Math.random() * 360;
      const y = Math.random() * 360;
      const color = coloresConfetti[Math.floor(Math.random() * coloresConfetti.length)];
      const vx = (Math.random() - 0.5) * 20;
      const vy = (Math.random() - 0.5) * 20;
      particles.push({ x, y, size, vx, vy, color });
    }
    function animateConfetti() {
      ctx.clearRect(0, 0, 360, 360);
      particles.forEach(p => {
        p.x += p.vx * 0.5;
        p.y += p.vy * 0.5;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      });
      if (particles.some(p => p.x > 0 && p.x < 360 && p.y > 0 && p.y < 360)) {
        requestAnimationFrame(animateConfetti);
      }
    }
    animateConfetti();

    // Modal grande con el ganador
    const modalHtml = `
      <div class="modal-popup" style="background:rgba(11,18,41,.92); padding:32px 24px; max-width:340px; margin:auto; border-radius:16px; text-align:center; color:#fff; position:fixed; top:0; left:0; right:0; bottom:0; z-index:1000; backdrop-filter:blur(4px);">
        <div style="width:80px; height:80px; background:linear-gradient(135deg, #D4A017, #E8B923); border-radius:50%; margin:0 auto 24px; display:flex; align-items:center; justify-content:center; font-size:32px;">🏆</div>
        <h2 style="margin:0 0 12px; font-size:22px;">¡Felicidades!</h2>
        <p style="margin:0 0 24px; font-size:16px; line-height:1.4;">${mensaje}</p>
        <button class="btn btn-gold" style="width:100%; padding:12px; font-size:14px; font-weight:700;">Aceptar</button>
      </div>`;
    document.getElementById('modal-root').innerHTML = modalHtml;
    // Añadir estilos para el modal popup si no existen
    const style = document.createElement('style');
    style.innerHTML = `.modal-popup .btn{bbackground:#D4A017;color:#16213F;border:none;border-radius:8px;cursor:pointer;transition:background .2s}.modal-popup .btn:hover{background:#E8B923;}.modal-popup{& .btn:focus{outline:none}.modal-popup{z-index:1001;}}.confetti-canvas{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999;}`;
    document.head.appendChild(style);

    // Botón aceptar cierra el modal
    const btn = modalHtml.querySelector('button');
    btn.addEventListener('click', () => {
      document.getElementById('modal-root').innerHTML = '';
      document.head.querySelector('style').remove();
      this._stopAllSounds();
    });
  }
}

// Exponer globalmente (sin módulos, script clásico)
window.RuletaCanvas = RuletaCanvas;
