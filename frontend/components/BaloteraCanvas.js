function parseHex(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}
function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function lightenColor(hex, pct) {
  const [r, g, b] = parseHex(hex);
  const f = pct / 100;
  return toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
function darkenColor(hex, pct) {
  const [r, g, b] = parseHex(hex);
  const f = 1 - pct / 100;
  return toHex(r * f, g * f, b * f);
}

function crearSonidos() {
  let ac = null;
  function ensure() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ac && ac.state === 'suspended') { ac.resume().catch(() => {}); }
    return ac;
  }
  return {
    rebote() {
      const c = ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 110 + Math.random() * 70;
      g.gain.setValueAtTime(0.07, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.09);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + 0.1);
    },
    giro() {
      const c = ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(220, c.currentTime);
      o.frequency.linearRampToValueAtTime(80, c.currentTime + 0.35);
      g.gain.setValueAtTime(0.05, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + 0.45);
    },
    ding() {
      const c = ensure(); if (!c) return;
      [880, 1320].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t = c.currentTime + i * 0.13;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + 0.75);
      });
    }
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

class BaloteraCanvas {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.numeroFinal = String(opts.numeroFinal == null ? 0 : opts.numeroFinal);
    this.cifras = opts.cifras || 2;
    this.accento = opts.colorAcento || '#D4A017';
    this.bolitasInfo = Array.isArray(opts.bolitas) ? opts.bolitas : [];
    this.sonidos = crearSonidos();
    this._raf = null;
    this._sprites = {};
  }

  _pad(n) { return String(n).padStart(this.cifras, '0'); }
  _norm(label) { return String(label).padStart(this.numeroFinal.length, '0'); }

  _sprite(color, label) {
    const key = color + '|' + label;
    if (this._sprites[key]) return this._sprites[key];
    const size = 64, c = document.createElement('canvas');
    c.width = size; c.height = size;
    const s = c.getContext('2d');
    const r = 28, cx = size / 2, cy = size / 2;

    s.beginPath();
    s.arc(cx + 1, cy + 2, r, 0, Math.PI * 2);
    s.fillStyle = 'rgba(0,0,0,0.18)';
    s.fill();

    const grad = s.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.2, lightenColor(color, 30));
    grad.addColorStop(0.55, color);
    grad.addColorStop(1, darkenColor(color, 35));
    s.fillStyle = grad;
    s.beginPath();
    s.arc(cx, cy, r, 0, Math.PI * 2);
    s.fill();

    s.strokeStyle = darkenColor(color, 50);
    s.lineWidth = 1.2;
    s.stroke();

    s.beginPath();
    s.arc(cx - r * 0.2, cy - r * 0.25, r * 0.3, 0, Math.PI * 2);
    s.fillStyle = 'rgba(255,255,255,0.2)';
    s.fill();

    s.shadowColor = 'rgba(0,0,0,0.4)';
    s.shadowBlur = 2;
    s.fillStyle = '#FFFFFF';
    s.font = 'bold ' + Math.round(r * 0.82) + 'px Sora, sans-serif';
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.fillText(label, cx, cy + 1);
    s.shadowBlur = 0;

    this._sprites[key] = c;
    return c;
  }

  _dibujarFondo(W, H) {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0B1229');
    grad.addColorStop(1, '#16213F');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, tankW = W - 60, tankH = H - 140;
    const tx = cx - tankW / 2, ty = 65;

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, tx, ty, tankW, tankH, 18);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    roundRect(ctx, tx, ty, tankW, tankH, 18);
    ctx.stroke();

    const lineGrad = ctx.createLinearGradient(tx, ty, tx + tankW, ty);
    lineGrad.addColorStop(0, 'rgba(212,160,23,0)');
    lineGrad.addColorStop(0.5, 'rgba(212,160,23,0.4)');
    lineGrad.addColorStop(1, 'rgba(212,160,23,0)');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx + 18, ty);
    ctx.lineTo(tx + tankW - 18, ty);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px Sora, sans-serif';
    ctx.fillText('BALOTERA', W / 2, 46);
  }

  _bola(x, y, r, label, color, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._sprite(color, label), x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  _drawGlow(x, y, r, t) {
    const ctx = this.ctx;
    const glowR = r * (1.8 + 0.4 * Math.sin(t * 8));
    ctx.save();
    const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, glowR);
    g.addColorStop(0, 'rgba(232,185,35,0.4)');
    g.addColorStop(0.5, 'rgba(232,185,35,0.15)');
    g.addColorStop(1, 'rgba(232,185,35,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  async jugar(duracionMs = 5500) {
    if (this._raf) cancelAnimationFrame(this._raf);
    const canvas = this.canvas;
    const W = canvas.width, H = canvas.height;
    const ctx = this.ctx;
    const { rebote, giro, ding } = this.sonidos;

    const tx = 30, ty = 65;
    const tankW = W - 60, tankH = H - 140;
    const minX = tx + 26, maxX = tx + tankW - 26;
    const minZ = ty + 26, maxZ = ty + tankH - 26;
    const paleta = ['#E8B923','#DC2626','#16A34A','#2563EB','#7C3AED','#0EA5E9','#F97316','#EC4899'];
    const finalLabel = this.numeroFinal;

    let items = [];
    if (this.bolitasInfo.length) {
      const pool = this.bolitasInfo.map(b => ({ label: this._norm(b.numero), nombre: b.nombre || '' }));
      const ganador = pool.find(b => b.label === finalLabel) || { label: finalLabel, nombre: '' };
      const otros = shuffle(pool.filter(b => b.label !== finalLabel));
      items = shuffle([ganador, ...otros]);
    }

    if (!items.length) return Promise.resolve();

    // Tamaño de bola dinámico: más bolas = más pequeñas
    const totalBolas = items.length;
    const radio = totalBolas > 50 ? 10 : totalBolas > 25 ? 14 : totalBolas > 12 ? 18 : 22;

    const bolitas = items.map((b, i) => ({
      label: b.label, nombre: b.nombre, esGanador: b.label === finalLabel,
      x: minX + Math.random() * (maxX - minX),
      y: minZ + Math.random() * (maxZ - minZ),
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      r: radio,
      color: b.label === finalLabel ? this.accento : paleta[i % paleta.length]
    }));

    const ganadorObj = bolitas.find(b => b.esGanador);
    const ganadorNombre = ganadorObj ? ganadorObj.nombre : '';
    const inicio = performance.now();

    // 3 fases: revoloteo -> seleccion -> revelado
    let fase = 'revoloteo';
    let seleccionEn = 0;
    let reveladoEn = 0;

    const finRevoloteo = inicio + duracionMs * (0.55 + Math.random() * 0.15);
    const finSeleccion = finRevoloteo + 1500;

    return new Promise((resolve) => {
      const paso = (ahora) => {
        const t = Math.min(1, (ahora - inicio) / (duracionMs + 2000));
        this._dibujarFondo(W, H);

        // Transiciones de fase
        if (fase === 'revoloteo' && ahora >= finRevoloteo) {
          fase = 'seleccion';
          seleccionEn = ahora;
          giro();
          ding();
        }
        if (fase === 'seleccion' && ahora >= finSeleccion) {
          fase = 'revelado';
          reveladoEn = ahora;
        }

        if (fase === 'revoloteo') {
          // ===== FASE 1: REVOLOTEO CAÓTICO =====
          bolitas.forEach(b => {
            // Gravedad muy leve — las bolas se mueven en todas direcciones
            b.vy += 0.06;
            b.x += b.vx;
            b.y += b.vy;

            // Impulsos aleatorios frecuentes para mantener el caos total
            if (Math.random() < 0.08) {
              b.vx += (Math.random() - 0.5) * 6;
              b.vy += (Math.random() - 0.5) * 6;
            }
            // Inversión de dirección aleatoria para que no se estanquen
            if (Math.random() < 0.02) {
              b.vx = -b.vx * (0.8 + Math.random() * 0.4);
            }
            if (Math.random() < 0.02) {
              b.vy = -b.vy * (0.8 + Math.random() * 0.4);
            }

            // Rebote paredes — energetico
            if (b.x < minX + b.r) { b.x = minX + b.r; b.vx = Math.abs(b.vx) * 0.9 + 2 + Math.random() * 2; rebote(); }
            if (b.x > maxX - b.r) { b.x = maxX - b.r; b.vx = -(Math.abs(b.vx) * 0.9 + 2 + Math.random() * 2); rebote(); }
            if (b.y < minZ + b.r) { b.y = minZ + b.r; b.vy = Math.abs(b.vy) * 0.9 + 2 + Math.random() * 2; rebote(); }
            if (b.y > maxZ - b.r) {
              b.y = maxZ - b.r;
              b.vy = -(Math.abs(b.vy) * 0.8 + 1.5 + Math.random() * 3);
              b.vx += (Math.random() - 0.5) * 4;
              if (Math.abs(b.vy) > 1) rebote();
            }

            // Velocidad mínima para que nunca se frenen del todo
            const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (spd < 3) {
              const ang = Math.random() * Math.PI * 2;
              b.vx += Math.cos(ang) * 2;
              b.vy += Math.sin(ang) * 2;
            }
          });

          // Colisiones — optimizado para muchas bolas
          const maxCheckDist = radio * 6;
          for (let i = 0; i < bolitas.length; i++) {
            for (let j = i + 1; j < bolitas.length; j++) {
              const a = bolitas[i], b2 = bolitas[j];
              const dx = b2.x - a.x, dy = b2.y - a.y;
              if (Math.abs(dx) > maxCheckDist || Math.abs(dy) > maxCheckDist) continue;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const minD = a.r + b2.r;
              if (dist < minD && dist > 0) {
                const nx = dx / dist, ny = dy / dist;
                const ov = (minD - dist) / 2;
                a.x -= nx * ov; a.y -= ny * ov;
                b2.x += nx * ov; b2.y += ny * ov;
                const dvx = a.vx - b2.vx, dvy = a.vy - b2.vy;
                const dot = dvx * nx + dvy * ny;
                a.vx -= dot * nx * 0.85; a.vy -= dot * ny * 0.85;
                b2.vx += dot * nx * 0.85; b2.vy += dot * ny * 0.85;
                const impulse = 1 + Math.random() * 1.5;
                a.vx += (Math.random() - 0.5) * impulse;
                b2.vx -= (Math.random() - 0.5) * impulse;
                rebote();
              }
            }
          }

          bolitas.forEach(b => this._bola(b.x, b.y, b.r, b.label, b.color, 0.95));

        } else if (fase === 'seleccion') {
          // ===== FASE 2: SELECCIÓN — la ganadora se ilumina =====
          const elapsed = (ahora - seleccionEn) / 1000;
          const tSel = Math.min(1, elapsed / 1.2);

          bolitas.forEach(b => {
            // Todas siguen rebotando pero más lento
            b.vy += 0.04;
            b.x += b.vx * 0.5;
            b.y += b.vy * 0.5;

            if (Math.random() < 0.04) {
              b.vx += (Math.random() - 0.5) * 4;
              b.vy += (Math.random() - 0.5) * 4;
            }

            if (b.x < minX + b.r) { b.x = minX + b.r; b.vx = Math.abs(b.vx) * 0.85 + 1; }
            if (b.x > maxX - b.r) { b.x = maxX - b.r; b.vx = -Math.abs(b.vx) * 0.85 - 1; }
            if (b.y < minZ + b.r) { b.y = minZ + b.r; b.vy = Math.abs(b.vy) * 0.85 + 1; }
            if (b.y > maxZ - b.r) { b.y = maxZ - b.r; b.vy = -Math.abs(b.vy) * 0.5; b.vx += (Math.random() - 0.5) * 2; }

            const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (spd < 2) {
              const ang = Math.random() * Math.PI * 2;
              b.vx += Math.cos(ang) * 1.5;
              b.vy += Math.sin(ang) * 1.5;
            }

            if (b.esGanador) {
              this._drawGlow(b.x, b.y, b.r, elapsed);
              this._bola(b.x, b.y, b.r * (1 + 0.15 * tSel), b.label, b.color, 1);
            } else {
              this._bola(b.x, b.y, b.r, b.label, b.color, 0.85 - 0.4 * tSel);
            }
          });

        } else if (fase === 'revelado') {
          // ===== FASE 3: REVELADO — ganadora sube al centro y crece =====
          const elapsed = (ahora - reveladoEn) / 1000;
          const tRev = Math.min(1, elapsed / 1.0);

          // Las demás bolitas caen y desaparecen
          bolitas.forEach(b => {
            if (b.esGanador) return;
            b.vy += 0.6;
            b.y += b.vy;
            b.x += b.vx * 0.2;
            const alpha = Math.max(0, 0.6 - tRev * 0.8);
            this._bola(b.x, b.y, b.r * (1 - tRev * 0.3), b.label, b.color, alpha);
          });

          // Ganadora se mueve al centro del tanque
          if (ganadorObj) {
            const targetX = W / 2;
            const targetY = ty + tankH * 0.38;
            ganadorObj.x += (targetX - ganadorObj.x) * 0.06;
            ganadorObj.y += (targetY - ganadorObj.y) * 0.06;

            const escala = 1 + 1.3 * easeOutBack(tRev);

            // Glow pulsante
            this._drawGlow(ganadorObj.x, ganadorObj.y, radio * escala, elapsed);

            // Bola ganadora grande
            this._bola(ganadorObj.x, ganadorObj.y, radio * escala, ganadorObj.label, ganadorObj.color, 1);

            // Texto del ganador
            if (tRev >= 0.5) {
              const txtAlpha = Math.min(1, (tRev - 0.5) * 2);
              ctx.save();
              ctx.globalAlpha = txtAlpha;
              ctx.fillStyle = '#FFFFFF';
              ctx.textAlign = 'center';
              ctx.font = 'bold 26px Sora, sans-serif';
              const txt = ganadorNombre
                ? 'GANADOR: ' + finalLabel + ' — ' + String(ganadorNombre).slice(0, 24)
                : 'GANADOR: ' + finalLabel;
              ctx.fillText(txt, W / 2, H - 24);
              ctx.restore();
            }
          }
        }

        if (t < 1) {
          this._raf = requestAnimationFrame(paso);
        } else {
          resolve();
        }
      };
      this._raf = requestAnimationFrame(paso);
    });
  }

  _randomNum() {
    return String(Math.floor(Math.random() * Math.pow(10, this.cifras))).padStart(this.cifras, '0');
  }

  detener() { if (this._raf) cancelAnimationFrame(this._raf); }

  iniciarGrabacion() {
    if (!this.canvas.captureStream) return false;
    if (this._mediaRecorder && this._mediaRecorder.state === 'recording') return false;
    const stream = this.canvas.captureStream(30);
    this._chunks = [];
    try { this._mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' }); }
    catch (e) { this._mediaRecorder = new MediaRecorder(stream); }
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
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function easeOutBack(t) {
  const c = 1.70158;
  return 1 + (t - 1) * (t - 1) * ((c + 1) * (t - 1) + c);
}

window.BaloteraCanvas = BaloteraCanvas;
window.crearSonidos = crearSonidos;
