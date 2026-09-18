/**
 * RuletaCanvas.js
 * -----------------------------------------------------------------------------
 * Sorteo visual con evidencia en video. TRANSPARENCIA: el GANADOR real siempre
 * lo determina el backend (server.js) con la "semilla aleatoria" guardada en la
 * tabla `ganadores`. Esta vista es la capa VISUAL que aterriza en ese ganador.
 *
 * FORMATO HÍBRIDO AUTOMÁTICO:
 *  - `ruleta` (circular clásica): cuando hay pocos participantes (n <= 18),
 *    los nombres caben legibles dentro de cada sector.
 *  - `tambor` / gigantón: cuando hay muchos participantes, en lugar de un pastel
 *    con sectores diminutos se dibuja un TAMBOR VERTICAL donde CADA participante
 *    es una fila GIGANTE (número + nombre) que gira detrás de una flecha. Con
 *    esto TODOS los nombres quedan legibles sin importar la cantidad.
 *
 * Además, en ambos formatos hay un BANNER gigante (callback onBanner) que muestra
 * en vivo, a alta velocidad, el NOMBRE del participante que está bajo la aguja.
 *
 * Otras características:
 *  - N vuelta(s): las N-1 primeras son DEMOSTRACIONES (revelan al "ganador del
 *    momento") y la última es "RULETA N DE N QUE DEFINE EL GANADOR".
 *  - Modo MANUAL: entre giros se espera a que el usuario pulse un botón.
 *  - Sonido estilo ruleta/tambor real: aire + tono grave + "clack" por sector/fila.
 *  - Video de evidencia de alta calidad: 60 fps, bitrate alto y con el sonido.
 *  - Modal de ganador con confeti al terminar.
 * -----------------------------------------------------------------------------
 */
class RuletaCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Array<{numero:number, nombre:string, label?:string}>} participantes - solo pagados
   * @param {Object} [opts]
   * @param {'auto'|'ruleta'|'tambor'} [opts.modo]
   * @param {Function} [opts.onEstado] - callback(texto) para la UI de estado
   * @param {Function} [opts.onBanner] - callback(idx, participante) nombre en vivo bajo la aguja
   * @param {Function} [opts.onMomento] - callback(participante, idxVuelta, totalVueltas, esDefinitiva)
   * @param {Function} [opts.onGanador] - callback() al revelar al ganador definitivo
   */
  constructor(canvas, participantes, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.participantes = participantes || [];
    this.opts = opts || {};
    this.onEstado = this.opts.onEstado || null;
    this.onBanner = this.opts.onBanner || null;
    this.onMomento = this.opts.onMomento || null;
    this.onGanador = this.opts.onGanador || null;

    this.anguloActual = 0;   // ruleta circular
    this.offsetY = 0;        // tambor vertical
    this.colores = ['#0B1229', '#16213F', '#D4A017', '#E8B923'];
    this._mediaRecorder = null;
    this._chunks = [];
    this.videoBlobUrl = null;
    this._cache = null;
    this._winnerIdx = -1;
    this._mostrarGanador = false;
    this._raf = null;
    this._lastBannerIdx = -1;

    // Umbrales del formato híbrido
    this.UMBRAL_TAMBOR = 18;
    const modoPc = this.opts.modo || 'auto';
    this.modo = modoPc === 'auto' ? (this.participantes.length > this.UMBRAL_TAMBOR ? 'tambor' : 'ruleta') : modoPc;

    // Audio: contexto + buffer de ruido blanco enrutado a un MASTER grabable.
    this._audioContext = null;
    this._audioEnabled = false;
    this._master = null;
    this._audioDest = null;
    this._noiseBuf = null;
    this._tickPlaying = false;
    this._airSource = null;
    this._airFilter = null;
    this._airGain = null;
    this._spinOsc = null;
    this._spinGain = null;
    this._initAudio();

    this._maxNameLen = Math.max(1, ...this.participantes.map(p => String(p.nombre || '').length), 1);
    this._maxName = this.participantes.reduce((a, p) => (String(p.nombre || '').length > String(a || '').length ? p.nombre : a), '');

    this._dims();
    if (this.modo === 'tambor') {
      this.offsetY = Math.floor(Math.random() * Math.max(this.participantes.length, 1)) * this._rowH;
    } else {
      this._bake();
    }
    this.dibujar();
  }

  // ============================== AUDIO =====================================

  _initAudio() {
    try {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this._audioEnabled = true;
      this._master = this._audioContext.createGain();
      this._master.gain.value = 1;
      this._master.connect(this._audioContext.destination);
      this._audioDest = this._audioContext.createMediaStreamDestination();
      this._master.connect(this._audioDest);
      const sr = this._audioContext.sampleRate;
      const buf = this._audioContext.createBuffer(1, Math.floor(sr * 0.5), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    } catch (e) { this._audioEnabled = false; }
  }

  /** "Clack" de madera estilo sorteador real: golpe corto + textura de ruido. */
  _playTick() {
    if (!this._audioEnabled || !this._noiseBuf || this._tickPlaying) return;
    this._tickPlaying = true;
    const c = this._audioContext, t = c.currentTime;

    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = 1250 + Math.random() * 260;
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g); g.connect(this._master);
    o.start(t); o.stop(t + 0.06);

    const src = c.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = 1.6;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3100; bp.Q.value = 1.4;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.10, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(bp); bp.connect(ng); ng.connect(this._master);
    src.start(t); src.stop(t + 0.04);

    setTimeout(() => { this._tickPlaying = false; }, 45);
  }

  /** Sonido continuo del giro: aire de la rueda (ruido grave) + resonancia. */
  _setSpinSound(start) {
    if (!this._audioEnabled) return;
    if (start) {
      if (this._spinOsc) return;
      const c = this._audioContext;

      const src = c.createBufferSource();
      src.buffer = this._noiseBuf; src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.7;
      const sw = c.createGain(); sw.gain.value = 0.055;
      src.connect(lp); lp.connect(sw); sw.connect(this._master);
      src.start();

      const o = c.createOscillator(), og = c.createGain();
      o.type = 'sine'; o.frequency.value = 74;
      og.gain.value = 0.045;
      o.connect(og); og.connect(this._master); o.start();

      this._airSource = src; this._airFilter = lp; this._airGain = sw;
      this._spinOsc = o; this._spinGain = og;
    } else {
      try { if (this._airSource) this._airSource.stop(); } catch (e) {}
      try { if (this._spinOsc) this._spinOsc.stop(); } catch (e) {}
      this._airSource = null; this._airFilter = null; this._airGain = null;
      this._spinOsc = null; this._spinGain = null;
    }
  }

  _stopAllSounds() { this._setSpinSound(false); this._tickPlaying = false; }

  /** Fanfarria breve y alegre para el ganador definitivo. */
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
      o.connect(g); g.connect(this._master);
      o.start(t); o.stop(t + 0.9);
    });
  }

  /** Blip amable al revelar el resultado de una demostración. */
  _playBlip() {
    if (!this._audioEnabled) return;
    const c = this._audioContext;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 740;
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(this._master);
    o.start(t); o.stop(t + 0.3);
  }

  // ============================ DIMENSIONES =================================

  _dims() {
    const { canvas } = this;
    const w = canvas.width, h = canvas.height;
    if (this.modo === 'tambor') {
      this._rowH = Math.max(40, Math.floor((h - 56) / 6));
      this._ptrY = Math.round(this._rowH * 1.9);
      this._rowFont = Math.max(16, Math.floor(this._rowH * 0.62));
    }
  }

  _radio() {
    const { canvas } = this;
    return Math.min(canvas.width, canvas.height) / 2 - 10;
  }

  /**
   * Dimensiones recomendadas {w,h} para que TODO sea legible:
   *  - ruleta: cuadrado con fuente legible por sector
   *  - tambor: ancho según el nombre más largo, alto según ~6 filas visibles
   */
  tamanoRecomendado() {
    if (this.modo === 'tambor') {
      const F = 30;
      const rowH = Math.ceil(F * 1.5);
      const ptrY = Math.round(rowH * 1.9);
      const h = Math.round(ptrY + 4 * rowH + 26);
      const numW = 110;
      const nameW = Math.max(120, Math.ceil(this._maxNameLen * 0.62 * F));
      const w = Math.min(860, Math.max(380, numW + nameW + 40));
      return { w, h };
    }
    const s = this._tamanoCircular();
    return { w: s, h: s };
  }

  _tamanoCircular() {
    const n = Math.max(this.participantes.length, 1);
    let R = Math.min(1600, Math.max(240, n * 4 + 300));
    for (let i = 0; i < 70 && R < 1600; i++) {
      const F = this._calcularFuente(R);
      const chars = this._charsPorLinea(R, F);
      const lines = this._wrappear(String(this._maxName || ''), chars).length;
      if (F >= 13 && lines <= 3) break;
      R += 25;
    }
    return Math.min(1600, Math.max(360, Math.round(R)));
  }

  // ====================== RULETA CIRCULAR (pocos) ===========================

  _charsPorLinea(radio, F) {
    const n = Math.max(this.participantes.length, 1);
    const angle = n === 1 ? Math.PI * 0.9 : (2 * Math.PI) / n;
    const chord = 2 * 0.60 * radio * Math.sin(angle / 2);
    return Math.max(1, Math.floor((chord * 0.92) / (0.60 * F)));
  }

  _calcularFuente(radio) {
    const n = Math.max(this.participantes.length, 1);
    const angle = n === 1 ? Math.PI * 0.9 : (2 * Math.PI) / n;
    let F = 30;
    for (let i = 0; i < 14; i++) {
      const chord = 2 * 0.60 * radio * Math.sin(angle / 2);
      const chars = Math.max(1, Math.floor((chord * 0.92) / (0.60 * F)));
      const lines = Math.max(1, Math.ceil(this._maxNameLen / chars));
      const radialF = (0.45 * radio) / (0.6 + 1.12 * lines);
      F = Math.min(F, radialF, 30);
    }
    return Math.max(7, Math.floor(F));
  }

  _wrappear(texto, chars) {
    const t = String(texto || '').trim() || '—';
    const c = Math.max(1, chars | 0);
    const palabras = t.split(/\s+/);
    const lineas = [];
    let cur = '';
    for (const w of palabras) {
      const candidato = cur ? cur + ' ' + w : w;
      if (candidato.length <= c) { cur = candidato; }
      else {
        if (cur) lineas.push(cur);
        cur = w.length > c ? w.slice(0, c) : w;
      }
    }
    if (cur) lineas.push(cur);
    return lineas.slice(0, 3);
  }

  _recortarLinea(linea, chars) {
    const c = Math.max(1, chars | 0);
    if (linea.length <= c) return linea;
    return linea.slice(0, c - 1) + '…';
  }

  _bake() {
    if (this.modo === 'tambor') return; // el tambor se dibuja directo, sin caché
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    const radio = this._radio();
    const n = Math.max(this.participantes.length, 1);
    const anguloSegmento = (2 * Math.PI) / n;
    const F = this._calcularFuente(radio);
    const chars = this._charsPorLinea(radio, F);

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
      const nombre = String(p.nombre || '—');
      const lineas = this._wrappear(nombre, chars).map(l => this._recortarLinea(l, chars));
      const maxLineasRadiales = Math.max(1, Math.floor((radio * 0.95 - radio * 0.50 - F * 0.6) / (F * 1.12)));

      o.font = 'bold ' + F + 'px Sora, sans-serif';
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillStyle = esGanador ? '#fff' : 'rgba(255,255,255,.95)';

      let x = radio * 0.50 + F * 0.6;
      o.fillText(this._recortarLinea(label, Math.max(4, chars)), x, 0);
      x += F * 1.12;
      lineas.slice(0, maxLineasRadiales).forEach(ln => {
        o.fillText(ln, x, 0);
        x += F * 1.12;
      });

      o.restore();
    });

    o.beginPath();
    o.arc(0, 0, radio, 0, Math.PI * 2);
    o.strokeStyle = 'rgba(212,160,23,.55)';
    o.lineWidth = 4;
    o.stroke();

    this._cache = off;
  }

  // ========================= TAMBOR VERTICAL (muchos) =======================

  _bannerIdxTambor() {
    const n = Math.max(this.participantes.length, 1);
    const contentH = n * Math.max(this._rowH, 1);
    const off = ((this.offsetY % contentH) + contentH) % contentH;
    return Math.floor(off / Math.max(this._rowH, 1)) % n;
  }

  _bannerIdxRuleta() {
    const n = Math.max(this.participantes.length, 1);
    const a = ((this.anguloActual % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    return Math.floor(a / ((2 * Math.PI) / n)) % n;
  }

  _bannerIdx() {
    return this.modo === 'tambor' ? this._bannerIdxTambor() : this._bannerIdxRuleta();
  }

  _rr(o, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    o.beginPath();
    o.moveTo(x + rr, y);
    o.arcTo(x + w, y, x + w, y + h, rr);
    o.arcTo(x + w, y + h, x, y + h, rr);
    o.arcTo(x, y + h, x, y, rr);
    o.arcTo(x, y, x + w, y, rr);
    o.closePath();
  }

  _dibujarTambor() {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const rowH = this._rowH || 50, ptrY = this._ptrY || Math.round(rowH * 1.9);
    const n = Math.max(this.participantes.length, 1);
    const contentH = n * rowH;
    const off = ((this.offsetY % contentH) + contentH) % contentH;
    const idx0 = Math.floor(off / rowH);
    const top0 = ptrY - Math.round(rowH / 2) - (off % rowH);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0B1229';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    const numW = 108;
    const nameMaxChars = Math.max(3, Math.floor((w - numW - 60) / (0.56 * this._rowFont)));
    const colorEsq = ['#14203F', '#1B2B52'];

    let y = top0;
    for (let k = 0; k <= n; k++) {
      const i = (idx0 + k) % n;
      const p = this.participantes[i];
      const esGanador = this._mostrarGanador && i === this._winnerIdx;

      const F = this._rowFont;
      if (esGanador) ctx.fillStyle = '#9A6B00';
      else ctx.fillStyle = colorEsq[i % 2];
      this._rr(ctx, 14, y + 5, w - 28, rowH - 10, 12);
      ctx.fill();

      ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + Math.floor(F * 0.8) + 'px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = esGanador ? '#fff' : 'rgba(232,185,35,.95)';
      ctx.fillText('#' + (p.label != null ? p.label : p.numero), 26, y + rowH / 2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(10 + numW, y + 5, w - 20 - numW, rowH - 10);
      ctx.clip();
      let nombre = String(p.nombre || '—');
      if (nombre.length > nameMaxChars) nombre = nombre.slice(0, nameMaxChars - 1) + '…';
      ctx.font = 'bold ' + F + 'px Sora, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(nombre, 24 + numW, y + rowH / 2);
      ctx.restore();

      y += rowH;
    }
    ctx.restore();

    // Degradado superior / inferior (ventana)
    const fade = Math.min(h / 3, this._rowFont * 2.4);
    const grdTop = ctx.createLinearGradient(0, 0, 0, fade);
    grdTop.addColorStop(0, '#0B1229');
    grdTop.addColorStop(1, 'rgba(11,18,41,0)');
    ctx.fillStyle = grdTop;
    ctx.fillRect(0, 0, w, fade);
    const grdBot = ctx.createLinearGradient(0, h - fade, 0, h);
    grdBot.addColorStop(0, 'rgba(11,18,41,0)');
    grdBot.addColorStop(1, '#0B1229');
    ctx.fillStyle = grdBot;
    ctx.fillRect(0, h - fade, w, fade);

    // Flecha / puntero dorado
    const px = w / 2;
    ctx.beginPath();
    ctx.moveTo(px - 20, Math.max(4, ptrY - 48));
    ctx.lineTo(px + 20, Math.max(4, ptrY - 48));
    ctx.lineTo(px, Math.max(4, ptrY - 6));
    ctx.closePath();
    ctx.fillStyle = '#D4A017';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ============================== DIBUJO ====================================

  dibujar() {
    if (this.modo === 'tambor') {
      this._dibujarTambor();
    } else {
      this._dibujarRuleta();
    }

    // Banner en vivo: el nombre que está bajo la aguja
    const idx = this._bannerIdx();
    if (this.onBanner && idx !== this._lastBannerIdx) {
      this._lastBannerIdx = idx;
      this.onBanner(idx, this.participantes[idx]);
    }
  }

  _dibujarRuleta() {
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

  /** Redimensiona el canvas (misma instancia) y re-pinta adaptado. */
  cambiarTamano(w, h) {
    this.canvas.width = w || this.canvas.width;
    this.canvas.height = h || this.canvas.height;
    this._dims();
    if (this.modo !== 'tambor') this._bake();
    this.dibujar();
  }

  // ============================= GRABACIÓN ==================================

  iniciarGrabacion() {
    if (!this.canvas.captureStream) return false;
    if (this._mediaRecorder && this._mediaRecorder.state === 'recording') return false;

    // Video a 60 fps + audio de la ruleta (master enrutado a mediaStreamDestination)
    const stream = this.canvas.captureStream(60);
    try {
      if (this._audioDest && this._audioDest.stream && this._audioDest.stream.getAudioTracks().length) {
        stream.addTrack(this._audioDest.stream.getAudioTracks()[0]);
      }
    } catch (e) {}

    this._chunks = [];
    const bits = Math.min(24000000, Math.max(8000000, Math.round(this.canvas.width * this.canvas.height * 15)));
    const opts = { videoBitsPerSecond: bits, audioBitsPerSecond: 256000 };
    try {
      this._mediaRecorder = new MediaRecorder(stream, Object.assign({ mimeType: 'video/webm;codecs=vp9' }, opts));
    } catch (e) {
      try {
        this._mediaRecorder = new MediaRecorder(stream, Object.assign({ mimeType: 'video/webm' }, opts));
      } catch (e2) {
        this._mediaRecorder = new MediaRecorder(stream, opts);
      }
    }
    this._mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this._chunks.push(e.data); };
    this._mediaRecorder.start(100);
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

  // ============================= GIRO =======================================

  _girarUna(idxObjetivo, duracionMs) {
    if (this.modo === 'tambor') return this._girarTambor(idxObjetivo, duracionMs);
    return this._girarRuleta(idxObjetivo, duracionMs);
  }

  _girarRuleta(idxObjetivo, duracionMs) {
    return new Promise((resolve) => {
      if (this._raf) cancelAnimationFrame(this._raf);
      const n = Math.max(this.participantes.length, 1);
      const anguloSegmento = (2 * Math.PI) / n;
      const anguloObjetivoBase = -Math.PI / 2 - (idxObjetivo * anguloSegmento + anguloSegmento / 2);
      const vueltasExtra = 5 * 2 * Math.PI;
      const anguloFinal = anguloObjetivoBase - vueltasExtra;
      const anguloInicial = this.anguloActual;
      const distancia = anguloFinal - (anguloInicial % (2 * Math.PI));

      let ultimoSector = this._bannerIdxRuleta();

      this._setSpinSound(true);
      const inicio = performance.now();

      const paso = (ahora) => {
        const t = Math.min(1, (ahora - inicio) / duracionMs);
        const easeOut = 1 - Math.pow(1 - t, 5);
        this.anguloActual = anguloInicial + distancia * easeOut;

        const s = this._bannerIdxRuleta();
        if (s !== ultimoSector) { this._playTick(); ultimoSector = s; }

        this.dibujar();
        if (t < 1) { this._raf = requestAnimationFrame(paso); }
        else {
          this._raf = null;
          this._setSpinSound(false);
          resolve();
        }
      };
      this._raf = requestAnimationFrame(paso);
    });
  }

  _girarTambor(idxObjetivo, duracionMs) {
    return new Promise((resolve) => {
      if (this._raf) cancelAnimationFrame(this._raf);
      const n = Math.max(this.participantes.length, 1);
      const rowH = Math.max(this._rowH || 50, 1);
      const contentH = n * rowH;
      const mod = (x) => ((x % contentH) + contentH) % contentH;
      const target = mod(idxObjetivo * rowH);
      let delta = target - mod(this.offsetY);
      if (delta < 0) delta += contentH;
      const total = delta + 5 * contentH;
      const inicio = performance.now();
      const startOffset = this.offsetY;

      let ultimoBanner = this._bannerIdxTambor();

      this._setSpinSound(true);

      const paso = (ahora) => {
        const t = Math.min(1, (ahora - inicio) / duracionMs);
        const easeOut = 1 - Math.pow(1 - t, 5);
        this.offsetY = startOffset + total * easeOut;

        const b = this._bannerIdxTambor();
        if (b !== ultimoBanner) { this._playTick(); ultimoBanner = b; }

        this.dibujar();
        if (t < 1) { this._raf = requestAnimationFrame(paso); }
        else {
          this._raf = null;
          this._setSpinSound(false);
          resolve();
        }
      };
      this._raf = requestAnimationFrame(paso);
    });
  }

  _pausa(ms) { return new Promise(r => setTimeout(r, ms)); }

  /**
   * Sorteo visual completo.
   * Si `vueltas > 1`, las primeras son DEMOSTRACIONES: aterrizan en un número
   * al azar, REVELAN al "ganador de ese momento" (RULETA X DE N), y la última
   * vuelta es "RULETA N DE N QUE DEFINE EL GANADOR" sobre el ganador real.
   *
   * En modo MANUAL (`opts.manual = true`) el giro NO es automático: se espera a
   * que `opts.onEsperaContinuar(vueltaActual, totalVueltas)` resuelva (botón).
   * También se espera antes de revelar al ganador definitivo.
   *
   * @param {number} numeroGanador - número ganador decidido por el backend
   * @param {Object} [opts] - { vueltas, duracionMs, manual, onEsperaContinuar }
   * @returns {Promise<string>} URL del video de evidencia
   */
  async girarMultiples(numeroGanador, opts) {
    opts = opts || {};
    const vueltas = Math.max(1, Number(opts.vueltas) || 1);
    const duracionMs = Number(opts.duracionMs) || 5000;
    const manual = !!opts.manual;
    const espera = ((opts.onEsperaContinuar && manual) ? opts.onEsperaContinuar : null);
    if (this._raf) cancelAnimationFrame(this._raf);

    const idxWinner = this.participantes.findIndex(p => String(p.numero) === String(numeroGanador));
    if (idxWinner === -1) throw new Error('El número ganador no está en la ruleta');
    this._winnerIdx = idxWinner;
    this._mostrarGanador = false;
    this._bake();
    this.dibujar();

    this.iniciarGrabacion();

    // --------- Vueltas de demostración ---------
    for (let v = 1; v < vueltas; v++) {
      let idxDemo = Math.floor(Math.random() * this.participantes.length);
      if (this.participantes.length > 1) while (idxDemo === idxWinner) idxDemo = Math.floor(Math.random() * this.participantes.length);
      const demo = this.participantes[idxDemo];
      const textoGanadorMomento = `ganó ${demo.nombre} (#${demo.label != null ? demo.label : demo.numero}). Es una demostración: el sistema es 100% al azar.`;

      this._winnerIdx = idxDemo;
      this._mostrarGanador = false;
      this._bake();
      this.dibujar();
      if (this.onEstado) this.onEstado(`🎡 RULETA ${v} DE ${vueltas} — girando...`);
      await this._girarUna(idxDemo, duracionMs);

      await this._pausa(350);
      this._winnerIdx = idxDemo;
      this._mostrarGanador = true;
      this._bake();
      this.dibujar();
      this._playBlip();
      if (this.onEstado) this.onEstado(`🎲 RULETA ${v} DE ${vueltas} — ${textoGanadorMomento}` + (manual ? ' Elige el momento del siguiente giro. ⏸️' : ''));
      if (this.onMomento) this.onMomento(demo, v, vueltas, false);

      if (espera) await espera(v, vueltas);
      else await this._pausa(2600);
    }

    // --------- Vuelta definitiva ---------
    this._winnerIdx = idxWinner;
    this._mostrarGanador = false;
    this._bake();
    this.dibujar();
    if (this.onEstado) this.onEstado(`🏆 RULETA ${vueltas} DE ${vueltas} — QUE DEFINE EL GANADOR` + (manual ? ' Pulsa cuando estés listo para girar la última vuelta.' : ''));
    await this._girarUna(idxWinner, duracionMs);

    await this._pausa(400);

    // En modo manual también se espera antes de revelar al campeón definitivo
    if (manual && this.onEstado) this.onEstado('🎡 ¡La ruleta se ha detenido! Pulsa "Revelar al ganador" para descubrir el resultado.');
    if (espera) await espera(vueltas, vueltas);

    this._winnerIdx = idxWinner;
    this._mostrarGanador = true;
    this._bake();
    this.dibujar();

    const ganador = this.participantes[idxWinner];
    const videoUrl = await this.detenerGrabacion();

    if (this.onEstado) this.onEstado(`🏆 GANADOR: ${ganador.nombre} — número #${ganador.label != null ? ganador.label : ganador.numero}` + (manual ? ' 🎉' : ''));
    if (this.onMomento) this.onMomento(ganador, vueltas, vueltas, true);
    if (this.onGanador) this.onGanador();
    if (this.onEstado) this.onEstado('🏆 ¡Ganador revelado! 🎉');

    setTimeout(() => this._showGanarModal(), 700);
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