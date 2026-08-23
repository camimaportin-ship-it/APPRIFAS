// Balotera4D: 4 baloteras independientes (B1..BN) + 1 tanbo de símbolo opcional.
// Cada tanbo saca UN dígito (0-9) o un símbolo, con animación de giro y revelado
// secuencial (B1 -> B2 -> ... -> símbolo) para generar suspenso. Es puramente visual:
// el resultado ya lo decidió el backend (chance-sorteo) y se pasa en `opts`.

function parseHexB4(h) { const x = h.replace('#', ''); return [parseInt(x.substr(0, 2), 16), parseInt(x.substr(2, 2), 16), parseInt(x.substr(4, 2), 16)]; }
function toHexB4(r, g, b) { return '#' + [r, g, b].map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function lightenB4(h, p) { const [r, g, b] = parseHexB4(h); const f = p / 100; return toHexB4(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); }
function darkenB4(h, p) { const [r, g, b] = parseHexB4(h); const f = 1 - p / 100; return toHexB4(r * f, g * f, b * f); }
function easeOutB4(t) { return 1 - Math.pow(1 - t, 3); }

class Balotera4D {
  constructor(container, opts) {
    this.container = container;
    this.digitos = (opts.digitos || []).map(String);
    this.simbolo = opts.simbolo || null;
    this.simbolos = Array.isArray(opts.simbolos) && opts.simbolos.length ? opts.simbolos : (this.simbolo ? [this.simbolo] : []);
    this.cifras = this.digitos.length;
    this.accento = opts.colorAcento || '#D4A017';
    this.paleta = ['#E8B923', '#DC2626', '#16A34A', '#2563EB', '#7C3AED', '#0EA5E9', '#F97316', '#EC4899'];
    this.sonidos = (window.crearSonidos) ? window.crearSonidos() : null;
    this.tanks = [];
    this._raf = null;
    this._dinged = new Set();
  }

  _tankDOM() {
    const total = this.cifras + (this.simbolo ? 1 : 0);
    let html = `<div class="balotera4d">`;
    for (let i = 0; i < this.cifras; i++) {
      html += `<div class="b4d-tank">
        <div class="b4d-glass"><canvas class="b4d-canvas" width="150" height="210"></canvas></div>
        <div class="b4d-label">B${i + 1}</div>
      </div>`;
    }
    if (this.simbolo) {
      html += `<div class="b4d-tank b4d-tank-simbolo">
        <div class="b4d-glass"><canvas class="b4d-canvas" width="150" height="210"></canvas></div>
        <div class="b4d-label">SÍMBOLO</div>
      </div>`;
    }
    html += `</div><p class="text-sm text-ink-600 mt-3 text-center" id="b4d-estado">Girando baloteras…</p>`;
    return html;
  }

  _setupTanks() {
    const total = this.cifras + (this.simbolo ? 1 : 0);
    const pads = this.container.querySelectorAll('.b4d-tank');
    pads.forEach((pad, i) => {
      const canvas = pad.querySelector('.b4d-canvas');
      const esSimbolo = i === this.cifras;
      const finalValor = esSimbolo ? this.simbolo : this.digitos[i];
      this.tanks.push({
        canvas, ctx: canvas.getContext('2d'),
        esSimbolo, finalValor,
        delay: i * 900,
        dur: 1500,
        color: esSimbolo ? this.accento : this.paleta[i % this.paleta.length],
        roll: 0, lastChange: 0, valorMostrado: esSimbolo ? this.simbolos[0] : '0',
        giroY: 0
      });
    });
  }

  _valorAleatorio(tank) {
    if (tank.esSimbolo) {
      return this.simbolos[Math.floor(Math.random() * this.simbolos.length)];
    }
    return String(Math.floor(Math.random() * 10));
  }

  _dibujarTanbo(tank, t, ahora) {
    const ctx = tank.ctx, W = tank.canvas.width, H = tank.canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Vidrio
    const tx = 14, ty = 12, tw = W - 28, th = H - 24, r = 16;
    const grad = ctx.createLinearGradient(0, ty, 0, ty + th);
    grad.addColorStop(0, '#16213F'); grad.addColorStop(1, '#0B1229');
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx, ty, tw, th, r); else { ctx.moveTo(tx + r, ty); ctx.arcTo(tx + tw, ty, tx + tw, ty + th, r); ctx.arcTo(tx + tw, ty + th, tx, ty + th, r); ctx.arcTo(tx, ty + th, tx, ty, r); ctx.arcTo(tx, ty, tx + tw, ty, r); ctx.closePath(); }
    ctx.fill();
    ctx.strokeStyle = (t >= 1) ? this.accento : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = (t >= 1) ? 3 : 2; ctx.stroke();

    // Bola central
    const cx = W / 2, cy = ty + th * 0.5 + tank.giroY;
    const rad = 46;
    if (t >= 1) {
      const g = ctx.createRadialGradient(cx - 14, cy - 14, 6, cx, cy, rad);
      g.addColorStop(0, 'rgba(232,185,35,0.55)');
      g.addColorStop(0.6, 'rgba(232,185,35,0.12)');
      g.addColorStop(1, 'rgba(232,185,35,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.9, 0, Math.PI * 2); ctx.fill();
    }

    // Cuerpo de la bola
    const bgrad = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.15, cx, cy, rad);
    bgrad.addColorStop(0, 'rgba(255,255,255,0.45)');
    bgrad.addColorStop(0.25, lightenB4(tank.color, 30));
    bgrad.addColorStop(0.6, tank.color);
    bgrad.addColorStop(1, darkenB4(tank.color, 35));
    ctx.fillStyle = bgrad;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = darkenB4(tank.color, 50); ctx.lineWidth = 1.4; ctx.stroke();

    // Brillo
    ctx.beginPath(); ctx.arc(cx - rad * 0.25, cy - rad * 0.3, rad * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();

    // Texto
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const txt = tank.valorMostrado;
    ctx.font = (tank.esSimbolo ? 'bold 40px' : 'bold 52px') + ' Sora, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 2;
    ctx.fillText(txt, cx, cy + 1);
    ctx.shadowBlur = 0;
  }

  jugar(duracionTotal) {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.container.innerHTML = this._tankDOM();
    this._setupTanks();
    const total = this.tanks.length;
    const finGlobal = (total - 1) * 900 + 1500 + 500;
    const estado = this.container.querySelector('#b4d-estado');

    return new Promise((resolve) => {
      const inicio = performance.now();
      const paso = (ahora) => {
        const globalT = ahora - inicio;
        let todosListos = true;
        this.tanks.forEach((tank, i) => {
          const local = globalT - tank.delay;
          let t;
          if (local < 0) { t = 0; todosListos = false; }
          else if (local >= tank.dur) { t = 1; }
          else { t = easeOutB4(local / tank.dur); todosListos = false; }

          // Cambio de valor rodante
          if (t < 1) {
            if (ahora - tank.lastChange > 70) {
              tank.valorMostrado = this._valorAleatorio(tank);
              tank.lastChange = ahora;
              tank.giroY = (Math.random() - 0.5) * 10;
            }
          } else {
            tank.valorMostrado = tank.finalValor;
            tank.giroY = 0;
            if (!this._dinged.has(i) && this.sonidos) { this._dinged.add(i); this.sonidos.ding(); }
          }
          this._dibujarTanbo(tank, t, ahora);
        });

        const listos = this.tanks.filter((tk, i) => globalT - tk.delay >= tk.dur).length;
        if (estado) estado.textContent = listos < total
          ? `Revelando B${listos + 1}…`
          : '¡Número ganador!';

        if (!todosListos) this._raf = requestAnimationFrame(paso);
        else {
          // Breve pausa para mostrar el resultado final
          setTimeout(resolve, 700);
        }
      };
      this._raf = requestAnimationFrame(paso);
    });
  }

  detener() { if (this._raf) cancelAnimationFrame(this._raf); }
}

window.Balotera4D = Balotera4D;
