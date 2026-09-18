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
 * Características:
 *  - Giro único o múltiples giros (demos + vuelta definitiva).
 *  - Tamaño configurable y modo pantalla completa.
 *  - Easing de desaceleración dramática (quintic ease-out).
 *  - Efectos de sonido Web Audio API: giro, ticks, ding de celebración.
 *  - Modal del ganador con confeti al terminar.
 *  - Grabación de la animación como video de evidencia (.webm).
 * -----------------------------------------------------------------------------
 */
class RuletaCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Array<{numero:number, nombre:string, label?:string}>} participantes - solo pagados
   * @param {Object} [opts]
   * @param {Function} [opts.onEstado] - callback(texto) para actualizar la UI del estado
   * @param {Function} [opts.onGanador] - callback() al revelar al ganador
   */
  constructor(canvas, participantes, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.participantes = participantes || [];
    this.opts = opts || {};
    this.onEstado = this.opts.onEstado || null;
    this.onGanador = this.opts.onGanador || null;
    this.anguloActual = 0;
    this.colores = ['#0B1229', '#16213F', '#D4A017', '#E8B923'];
    this._mediaRecorder = null;
    this._chunks = [];
    this.videoBlobUrl = null;
    this._cache = null;
    this._winnerIdx = -1;
    this._mostrarGanador = false;
    this._raf = null;
    this._audioContext = null;
    this._audioEnabled = false;
    this._tickPlaying = false;
    this._spinOsc = null;
    this._spinGain = null;
    this._spinLfo = null;
    this._lfoAmp = null;
    this._bake();
    this.dibujar();
    this._initAudio();
  }

  _initAudio() {
    try { this._audioContext = new (window.AudioContext || window.webkitAudioContext)(); this._audioEnabled = true; } catch (e) { this._audioEnabled = false; }
  }

  _playTick() {
    if (!this._audioEnabled || this._tickPlaying) return;
    this._tickPlaying = true;
    const c = this._audioContext;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.06);
    setTimeout(() => { this._tickPlaying = false; }, 65);
  }

  /** Sonido continuo del giro con modulación LFO (vibrato). */
  _setSpinSound(start) {
    if (!this._audioEnabled) return;
    if (start) {
      if (this._spinOsc) return;
      const c = this._audioContext;
      this._spinOsc = c.createOscillator();
      this._spinGain = c.createGain();
      this._spinLfo = c.createOscillator();          // LFO = oscilador, no gain
      this._lfoAmp = c.createGain();                 // profundidad de modulación en Hz
      this._spinOsc.type = 'sine';
      this._spinOsc.frequency.value = 390;
      this._spinOsc.frequency.linearRampToValueAtTime(720, c.currentTime + 4);
      this._spinLfo.type = 'sine';
      this._spinLfo.frequency.value = 6;
      this._lfoAmp.gain.value = 42;
      this._spinLfo.connect(this._lfoAmp);
      this._lfoAmp.connect(this._spinOsc.frequency);
      this._spinOsc.connect(this._spinGain);
      this._spinGain.gain.value = 0.22;
      this._spinGain.connect(c.destination);
      this._spinOsc.start();
      this._spinLfo.start();
    } else {
      try { if (this._spinOsc) this._spinOsc.stop(); } catch (e) {}
      try { if (this._spinLfo) this._spinLfo.stop(); } catch (e) {}
      this._spinOsc = null;
      this._spinGain = null;
      this._spinLfo = null;
      this._lfoAmp = null;
    }
  }

  _stopAllSounds() {
    this._setSpinSound(false);
    this._tickPlaying = false;
  }

  _playDing() {
    if (!this._audioEnabled) return;
    const c = this._audioContext;
    [880, 1320].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = c.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.9);
    });
  }

  _radio() {
    const { canvas } = this;
    return Math.min(canvas.width, canvas.height) / 2 - 10;
  }

  _bake() {
    const S = Math.min(this.canvas.width, this.canvas.height);
    const W = this.canvas.width, H = this.canvas.height;
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
      const name = String(p.nombre || '');

      if (sectorWidth >= 70 && n <= 20) {
        const fontSize = Math.min(16 + S / 40, Math.max(10, Math.floor(sectorWidth / 7)));
        o.font = 'bold ' + fontSize + 'px Sora, sans-serif';
        o.textAlign = 'center';
        o.fillStyle = '#fff';
        o.fillText(label, radio * 0.6, -fontSize * 0.3);
        const maxNameChars = Math.max(4, Math.floor((sectorWidth - 10) / 6));
        const nameSize = Math.min(11 + S / 40, Math.max(7, Math.floor(sectorWidth / 10)));
        o.font = 'bold ' + nameSize + 'px Sora, sans-serif';
        o.fillStyle = 'rgba(255,255,255,.85)';
        o.fillText(name.slice(0, maxNameChars), radio * 0.6, fontSize * 0.6);
      } else if (sectorWidth >= 28) {
        const fontSize = Math.min(14 + S / 40, Math.max(9, Math.floor(sectorWidth / 5)));
        o.font = 'bold ' + fontSize + 'px Sora, sans-serif';
        o.textAlign = 'center';
        o.fillStyle = '#fff';
        o.fillText(label, radio * 0.65, fontSize * 0.35);
      } else {
        // Ranuras muy finas (muchos participantes): mini número si aún cabe
        const miniSize = Math.floor(sectorWidth / 3);
        if (miniSize >= 7) {
          o.font = 'bold ' + Math.min(miniSize, 12) + 'px JetBrains Mono, monospace';
          o.textAlign = 'center';
          o.fillStyle = 'rgba(255,255,255,.9)';
          o.fillText(label, radio * 0.7, miniSize * 0.35);
        }
      }

      o.restore();
    });

    o.beginPath();
    o.arc(0, 0, radio, 0, Math.PI * 2);
    o.strokeStyle = 'rgba(212,160,23,.55)';
    o.lineWidth = 4;
    o.stroke();

    this._cache = off;
  }

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

    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - radio - 4);
    ctx.lineTo(cx + 14, cy - radio - 4);
    ctx.lineTo(cx, cy - radio + 22);
    ctx.closePath();
    ctx.fillStyle = '#D4A017';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#0B1229';
    ctx.fill();
    ctx.fillStyle = '#D4A017';
    ctx.font = 'bold 12px Sora, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GIRA', cx, cy + 4);

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

  /** Redimensiona el canvas (misma instancia) y vuelve a pintar. */
  cambiarTamano(w, h) {
    this.canvas.width = w || this.canvas.width;
    this.canvas.height = h || this.canvas.height;
    this._bake();
    this.dibujar();
  }

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
   * Gira una sola vez hasta el centro del sector `idxObjetivo`.
   * @returns {Promise<void>}
   */
  _girarUna(idxObjetivo, duracionMs) {
    return new Promise((resolve) => {
      if (this._raf) cancelAnimationFrame(this._raf);
      const n = Math.max(this.participantes.length, 1);
      const anguloSegmento = (2 * Math.PI) / n;
      const anguloObjetivoBase = -Math.PI / 2 - (idxObjetivo * anguloSegmento + anguloSegmento / 2);
      const vueltasExtra = 5 * 2 * Math.PI;
      const anguloFinal = anguloObjetivoBase - vueltasExtra;
      const anguloInicial = this.anguloActual;
      const distancia = anguloFinal - (anguloInicial % (2 * Math.PI));

      this._setSpinSound(true);
      const tickInterval = setInterval(() => { if (this._audioEnabled && !this._tickPlaying) this._playTick(); }, 90);
      const inicio = performance.now();

      const paso = (ahora) => {
        const t = Math.min(1, (ahora - inicio) / duracionMs);
        const easeOut = 1 - Math.pow(1 - t, 5);
        this.anguloActual = anguloInicial + distancia * easeOut;
        this.dibujar();
        if (t < 1) { this._raf = requestAnimationFrame(paso); }
        else {
          this._raf = null;
          clearInterval(tickInterval);
          this._setSpinSound(false);
          resolve();
        }
      };
      this._raf = requestAnimationFrame(paso);
    });
  }

  _pausa(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Realiza el sorteo visual. Si `vueltas > 1`, las primeras son
   * demostraciones girando a números aleatorios (el sistema es 100% al azar),
   * y la última es la definitiva que aterriza en el ganador real del backend.
   * @param {number} numeroGanador - número ganador decidido por el backend
   * @param {Object} [opts] - { vueltas, duracionMs }
   * @returns {Promise<string>} URL del video de evidencia
   */
  async girarMultiples(numeroGanador, opts) {
    opts = opts || {};
    const vueltas = Math.max(1, Number(opts.vueltas) || 1);
    const duracionMs = Number(opts.duracionMs) || 5000;
    if (this._raf) cancelAnimationFrame(this._raf);

    const idxWinner = this.participantes.findIndex(p => String(p.numero) === String(numeroGanador));
    if (idxWinner === -1) throw new Error('El número ganador no está en la ruleta');
    this._winnerIdx = idxWinner;
    this._mostrarGanador = false;
    this._bake();

    this.iniciarGrabacion();

    // Vueltas de demostración
    for (let v = 1; v < vueltas; v++) {
      // Número aleatorio distinto del ganador real
      let idxDemo = Math.floor(Math.random() * this.participantes.length);
      if (this.participantes.length > 1) while (idxDemo === idxWinner) idxDemo = Math.floor(Math.random() * this.participantes.length);
      if (this.onEstado) this.onEstado(`🔎 Demostración ${v} de ${vueltas - 1} — girando...`);
      await this._girarUna(idxDemo, duracionMs);
      if (this.onEstado) this.onEstado(`✅ Demostración ${v} de ${vueltas - 1} completa — el sistema es 100% al azar.`);
      await this._pausa(900);
    }

    // Vuelta definitiva
    if (this.onEstado) this.onEstado(`${vueltas > 1 ? '🎯 ¡Vuelta definitiva! ' : ''}Revelando ganador...`);
    await this._girarUna(idxWinner, duracionMs);

    await this._pausa(500);
    this._mostrarGanador = true;
    this._bake();
    this.dibujar();

    const videoUrl = await this.detenerGrabacion();

    if (this.onEstado) this.onEstado('🏆 ¡Ganador revelado!');
    if (this.onGanador) this.onGanador();

    setTimeout(() => this._showGanarModal(), 600);
    return videoUrl;
  }

  /** Compatibilidad: giro único (girarHasta === girarMultiples con 1 vuelta). */
  girarHasta(numeroGanador, duracionMs) {
    return this.girarMultiples(numeroGanador, { vueltas: 1, duracionMs: duracionMs || 5000 });
  }

  /** Modal grande con confeti y mensaje "El feliz ganador es: [Nombre]". */
  _showGanarModal() {
    const ganador = this.participantes[this._winnerIdx];
    const nombreMostrado = ganador && (ganador.nombre || ganador.label || ('#' + ganador.numero));
    const mensaje = 'El feliz ganador es: ' + (nombreMostrado || 'Participante');

    this._playDing();

    if (typeof window !== 'undefined' && typeof window.confetti === 'function') {
      try {
        window.confetti({
          particleCount: 180, spread: 90, origin: { y: 0.6 },
          colors: ['#D4A017', '#E8B923', '#0B1229', '#16213F']
        });
      } catch (e) {}
    }

    const html = `
      <div class="ruleta-ganador-modal" style="background:rgba(11,18,41,.96); padding:36px 24px; max-width:420px; width:92%; margin:auto; border-radius:18px; text-align:center; color:#fff; position:relative; box-shadow:0 20px 60px rgba(0,0,0,.6); border:1px solid rgba(212,160,23,.4);">
        <div style="width:88px; height:88px; background:linear-gradient(135deg,#D4A017,#E8B923); border-radius:50%; margin:0 auto 22px; display:flex; align-items:center; justify-content:center; font-size:40px; box-shadow:0 0 30px rgba(212,160,23,.6);">🏆</div>
        <h2 style="margin:0 0 10px; font-size:24px; color:#E8B923;">¡Felicidades!</h2>
        <p style="margin:0 0 22px; font-size:17px; line-height:1.5; color:#fff;">${mensaje}</p>
        <button id="btn-accept-ganador" style="width:100%; padding:13px; font-size:15px; font-weight:700; color:#0B1229; background:linear-gradient(135deg,#D4A017,#E8B923); border:none; border-radius:10px; cursor:pointer; transition:transform .15s; box-shadow:0 6px 20px rgba(212,160,23,.35);">Aceptar</button>
      </div>`;

    let root = null;
    try { root = document.getElementById('modal-root'); } catch (e) {}
    if (!root) {
      root = document.createElement('div');
      root.id = 'ruleta-modal-fallback';
      root.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(11,18,41,.7);';
      document.body.appendChild(root);
    } else {
      root.style.display = 'flex';
      root.style.alignItems = 'center';
      root.style.justifyContent = 'center';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.background = 'rgba(11,18,41,.7)';
      root.style.zIndex = '2500';
    }
    root.innerHTML = html;

    const btn = document.getElementById('btn-accept-ganador');
    if (btn) btn.addEventListener('click', () => {
      root.innerHTML = '';
      if (root.id === 'ruleta-modal-fallback') root.remove();
      else root.style.cssText = '';
      this._stopAllSounds();
    });
  }
}

window.RuletaCanvas = RuletaCanvas;