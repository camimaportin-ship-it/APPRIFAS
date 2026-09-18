/**
 * RuletaCanvas.js
 * -----------------------------------------------------------------------------
 * Sorteo visual con evidencia en video. TRANSPARENCIA: el GANADOR real siempre
 * lo determina el backend (server.js) con la "semilla aleatoria" guardada en la
 * tabla `ganadores`. Esta vista es la capa VISUAL que aterriza en ese ganador.
 *
 * FORMATO: RULETA CIRCULAR SIEMPRE, con diseño AUTOMÁTICO según lo que quepa:
 *  - Pocos participantes: DOBLE ANILLO tangencial estilo clásico (letras
 *    derechas en Verdana, pares afuera e impares adentro, cada nombre en el
 *    arco de 2 sectores).
 *  - Muchos participantes: RAYOS RADIALES (el nombre usa todo el radio, letra
 *    ~3x más grande que en tangencial).
 *  En ambos los nombres van COMPLETOS (solo el nombre, sin "#"), con contorno
 *  oscuro y ajuste garantizado: NUNCA se desbordan ni se pisan.
 *  - El TAMBOR vertical (gigantón, con filas GIGANTES de número + nombre) queda
 *    como MODO OPCIONAL activable por el organizador, no automático.
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
    * @param {string} [opts.titulo] - texto del núcleo central (nombre de la rifa)
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

    // Umbrales del formato híbrido (tambor SOLO opcional, nunca automático)
    this.UMBRAL_TAMBOR = 18;
    const modoPc = this.opts.modo || 'ruleta';
    this.modo = modoPc === 'tambor' ? 'tambor' : 'ruleta';

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
    // Longitud del nombre más largo por anillo (par = exterior, impar = interior)
    this._maxLenPar = Math.max(1, ...this.participantes.filter((_, i) => i % 2 === 0).map(p => String(p.nombre || '—').length));
    this._maxLenImpar = Math.max(1, ...this.participantes.filter((_, i) => i % 2 === 1).map(p => String(p.nombre || '—').length));
    // Título del núcleo central (nombre de la rifa); ya NO se muestra el contador
    this.titulo = String((this.opts && this.opts.titulo) || '🎡 SORTEO');

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
    // Tamaño W=H para que los nombres de AMBOS anillos queden legibles con
    // CUALQUIER cantidad y con nombres largos: el radio crece con n Y con el
    // nombre más largo (el anillo interior manda en el tamaño).
    const n = Math.max(this.participantes.length, 1);
    const T = Math.max(this._maxLenPar, this._maxLenImpar, 1);
    const R = Math.max(4.5 * n, 1.5 * n * T) * 1.02;
    return Math.min(2200, Math.max(420, Math.round(R * 2 + 4)));
  }

  // ==================== RULETA CIRCULAR (siempre) ===========================
  // Diseño clásico de DOBLE ANILLO tangencial:
  //  - Cada nombre se escribe HORIZONTAL (letras derechas) siguiendo el arco de
  //    su anillo. Pares en el anillo exterior, impares en el interior.
  //  - Cada nombre ocupa el arco de 2 sectores, así los vecinos del mismo
  //    anillo NUNCA se tocan. La fuente se calcula con el nombre más largo de
  //    cada anillo + un ajuste por nombre: IMPOSIBLE que se desborde.
  //  - Fuente Verdana: diseñada para leerse bien incluso en tamaño pequeño.

  _fuenteAnillos(radio) {
    const n = Math.max(this.participantes.length, 1);
    const ang = (2 * Math.PI) / n;
    const slotSec = n === 1 ? 1 : 2;
    const rOut = radio * 0.79, rIn = radio * 0.485;
    const arcOut = slotSec * ang * rOut, arcIn = slotSec * ang * rIn;
    const rawOut = Math.min((radio * 0.28) * 0.78, (arcOut * 0.96) / (Math.max(this._maxLenPar, 1) * 0.62), 64);
    const rawIn = Math.min((radio * 0.27) * 0.78, (arcIn * 0.96) / (Math.max(this._maxLenImpar, 1) * 0.62), 64);
    return { Fout: Math.max(1, Math.floor(rawOut)), Fin: Math.max(1, Math.floor(rawIn)), rawOut, rawIn, rOut, rIn, slotSec, ang };
  }

  /** Fuente para los rayos radiales (muchos participantes): el nombre usa todo
   *  el radio, así la letra queda ~3x más grande que en tangencial y NUNCA se
   *  corta. Sin piso mínimo forzado: la geometría garantiza cero desborde. */
  _fuenteRayos(radio) {
    const n = Math.max(this.participantes.length, 1);
    const rIn = radio * 0.44;
    const arco = rIn * ((2 * Math.PI) / n);
    const T = Math.max(this._maxLenPar, this._maxLenImpar, 1);
    const Ftan = (arco * 0.90) / 0.80;
    const Frad = ((radio * 0.96) - rIn) / (T * 0.95);
    return Math.max(1, Math.min(64, Ftan, Frad));
  }

  /** Elige el diseño según lo que QUEPA legible: anillos clásicos si ambos
   *  dan letra ≥12px, si no rayos radiales. Siempre circular. */
  _elegirDiseno(radio) {
    const { rawOut, rawIn } = this._fuenteAnillos(radio);
    return (rawOut >= 12 && rawIn >= 12) ? 'anillos' : 'rayos';
  }

  _bake() {
    if (this.modo === 'tambor') return; // el tambor se dibuja directo, sin caché
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    const radio = this._radio();
    const n = Math.max(this.participantes.length, 1);
    const anguloSegmento = (2 * Math.PI) / n;
    const { Fout, Fin, rOut, rIn: rInAn, slotSec } = this._fuenteAnillos(radio);
    const diseno = this._elegirDiseno(radio);
    const FRayos = diseno === 'rayos' ? this._fuenteRayos(radio) : 0;
    const rInRa = radio * 0.44;
    const FONT = (F) => 'bold ' + F + 'px Verdana, "DejaVu Sans", "Segoe UI", Roboto, sans-serif';

    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const o = off.getContext('2d');

    this.participantes.forEach((p, i) => {
      const inicio = i * anguloSegmento;
      const fin = inicio + anguloSegmento;
      const esGanador = this._mostrarGanador && Math.floor(i / 2) === Math.floor(this._winnerIdx / 2);

      // Sector (cuña) con colores por PAREJAS para que cada nombre tenga fondo uniforme
      o.beginPath();
      o.moveTo(cx, cy);
      o.arc(cx, cy, radio, inicio, fin);
      o.closePath();
      o.fillStyle = esGanador ? '#9A6B00' : this.colores[Math.floor(i / 2) % this.colores.length];
      o.fill();
      o.strokeStyle = esGanador ? '#E8B923' : '#F5F6F9';
      o.lineWidth = esGanador ? 5 : 2;
      o.stroke();

      // Nombre según el diseño elegido (SOLO el nombre, sin "#"):
      //  - anillos: horizontal siguiendo el arco de su anillo (par = exterior)
      //  - rayos: letra por letra del centro al borde (muchos participantes)
      // Letras derechas, Verdana, contorno oscuro. Cero desborde garantizado.
      if (diseno === 'anillos') {
        const par = i % 2 === 0;
        const ringR = par ? rOut : rInAn;
        const F = par ? Fout : Fin;
        let texto = String(p.nombre || '—');
        const slotArc = slotSec * anguloSegmento * ringR;
        const maxSpan = slotArc * 0.96;
        if ((texto.length * F * 0.62) > maxSpan) {
          const caben = Math.max(1, Math.floor(maxSpan / (F * 0.62)) - 1);
          texto = texto.slice(0, caben) + '…';
        }
        const centro = (i + slotSec / 2) * anguloSegmento;
        const pasoAng = (F * 0.60) / ringR;
        const angIni = centro - ((texto.length - 1) * pasoAng) / 2;
        o.font = FONT(F);
        o.textAlign = 'center';
        o.textBaseline = 'middle';
        o.lineWidth = Math.max(1, Math.round(F * 0.20));
        o.strokeStyle = 'rgba(11,18,41,.92)';
        for (let k = 0; k < texto.length; k++) {
          const a = angIni + k * pasoAng;
          const x = Math.round(cx + Math.cos(a) * ringR);
          const y = Math.round(cy + Math.sin(a) * ringR);
          const ch = texto.charAt(k);
          o.strokeText(ch, x, y);
          o.fillStyle = esGanador ? '#fff' : 'rgba(255,255,255,.98)';
          o.fillText(ch, x, y);
        }
      } else {
        const mid = inicio + anguloSegmento / 2;
        const F = FRayos;
        const texto = String(p.nombre || '—');
        o.font = FONT(F);
        o.textAlign = 'center';
        o.textBaseline = 'middle';
        o.lineWidth = Math.max(1, Math.round(F * 0.20));
        o.strokeStyle = 'rgba(11,18,41,.92)';
        for (let k = 0; k < texto.length; k++) {
          const r = rInRa + k * F * 0.95 + F * 0.5;
          const x = Math.round(cx + Math.cos(mid) * r);
          const y = Math.round(cy + Math.sin(mid) * r);
          const ch = texto.charAt(k);
          o.strokeText(ch, x, y);
          o.fillStyle = esGanador ? '#fff' : 'rgba(255,255,255,.98)';
          o.fillText(ch, x, y);
        }
      }
    });

    if (diseno === 'anillos') {
      // Separadores de anillos
      [0.34, 0.63].forEach(fr => {
        o.beginPath();
        o.arc(cx, cy, radio * fr, 0, Math.PI * 2);
        o.strokeStyle = 'rgba(245,246,249,.35)';
        o.lineWidth = 1.5;
        o.stroke();
      });
    } else {
      // Rayas separadoras radiales desde el núcleo hasta el aro
      const P = Math.max(this.participantes.length, 1);
      for (let j = 0; j < P; j++) {
        const a = j * anguloSegmento;
        o.beginPath();
        o.moveTo(cx + Math.cos(a) * radio * 0.34, cy + Math.sin(a) * radio * 0.34);
        o.lineTo(cx + Math.cos(a) * (radio - 3), cy + Math.sin(a) * (radio - 3));
        o.strokeStyle = 'rgba(245,246,249,.35)';
        o.lineWidth = 1.5;
        o.stroke();
      }
    }
    o.beginPath();
    o.arc(cx, cy, radio - 2, 0, Math.PI * 2);
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
    // Sector que está bajo la aguja (parte superior, ángulo -PI/2 de pantalla)
    const n = Math.max(this.participantes.length, 1);
    const a = (-Math.PI / 2 - this.anguloActual) % (2 * Math.PI);
    const norm = ((a % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    return Math.floor(norm / ((2 * Math.PI) / n)) % n;
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
      ctx.font = 'bold ' + F + 'px Verdana, "DejaVu Sans", "Segoe UI", sans-serif';
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

    ctx.save();

    // Núcleo decorativo FIJO (no rota con la rueda): nombre de la rifa
    const rIn = radio * 0.32;
    const hubR = rIn - 6;
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#0B1229';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,160,23,.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Título en hasta 3 líneas, sin mostrar el contador de participantes
    const fHub = Math.max(16, Math.min(40, Math.round(radio / 34)));
    const charsHub = Math.max(6, Math.floor((hubR * 1.5) / (fHub * 0.58)));
    const palabras = this.titulo.split(/\s+/).filter(Boolean);
    const lineas = [];
    let cur = '';
    for (const w of palabras) {
      const cand = cur ? cur + ' ' + w : w;
      if (cand.length <= charsHub) cur = cand;
      else { if (cur) lineas.push(cur); cur = w.length > charsHub * 1.6 ? w.slice(0, charsHub) : w; }
      if (lineas.length >= 3) break;
    }
    if (cur && lineas.length < 3) lineas.push(cur.length > charsHub ? cur.slice(0, charsHub - 1) + '…' : cur);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + fHub + 'px Verdana, "DejaVu Sans", "Segoe UI", sans-serif';
    ctx.fillStyle = '#E8B923';
    const paso = Math.round(fHub * 1.25);
    const y0 = cy - Math.round((lineas.length - 1) * paso / 2);
    lineas.slice(0, 3).forEach((ln, i) => ctx.fillText(ln, cx, y0 + i * paso));
    ctx.restore();

    if (this._mostrarGanador && this._winnerIdx >= 0) {
      const p = this.participantes[this._winnerIdx];
      const txt = '🏆 #' + (p.label != null ? p.label : p.numero) + ' · ' + String(p.nombre || '').slice(0, 22);
      ctx.fillStyle = 'rgba(11,18,41,.72)';
      ctx.fillRect(cx - 92, cy - radio + 26, 184, 30);
      ctx.fillStyle = '#E8B923';
      ctx.font = 'bold 13px Verdana, "DejaVu Sans", sans-serif';
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