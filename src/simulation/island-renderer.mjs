/** Island presentation only: observes copied frames, never advances the world. */
export function drawIslandFrame(ctx, frame, config, previous = null) {
  const w = ctx.canvas.width / config.size, h = ctx.canvas.height / config.size;
  const unit = Math.min(w, h);
  const dot = (x, y, radius, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  };
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let y = 0; y < config.size; y++) for (let x = 0; x < config.size; x++) {
    const beach = Math.min(x, y, config.size - 1 - x, config.size - 1 - y) < 2;
    ctx.fillStyle = beach ? ((x + y) % 2 ? '#e8d5a0' : '#efdfb5') : ((x + y) % 2 ? '#a1bb82' : '#abc38c');
    ctx.fillRect(x * w, y * h, w, h);
    if (!beach && (x * 7 + y * 3) % 9 === 0) {
      ctx.strokeStyle = '#78995c'; ctx.lineWidth = unit * .05;
      ctx.beginPath(); ctx.moveTo(x * w + w * .18, y * h + h * .7);
      ctx.lineTo(x * w + w * .18 + unit * .13, y * h + h * .4); ctx.stroke();
    }
  }
  for (const [y, x] of frame.hazardCells) {
    ctx.fillStyle = frame.hazardsActive ? '#657e8daa' : '#b9c9bd88';
    ctx.fillRect(x * w + 1, y * h + 1, w - 2, h - 2);
    const cx = (x + .5) * w, cy = (y + .45) * h;
    dot(cx, cy, unit * .2, frame.hazardsActive ? '#516977' : '#8ca394');
    dot(cx - unit * .18, cy + unit * .06, unit * .14, frame.hazardsActive ? '#516977' : '#8ca394');
    dot(cx + unit * .18, cy + unit * .06, unit * .14, frame.hazardsActive ? '#516977' : '#8ca394');
    if (frame.hazardsActive) {
      ctx.strokeStyle = '#d5e9ef'; ctx.lineWidth = unit * .045;
      for (const dx of [-.18, 0, .18]) {
        ctx.beginPath(); ctx.moveTo(cx + dx * unit, cy + unit * .25);
        ctx.lineTo(cx + (dx - .08) * unit, cy + unit * .4); ctx.stroke();
      }
    }
  }
  for (const [y, x] of frame.resources) {
    const cx = (x + .5) * w, cy = (y + .5) * h;
    ctx.fillStyle = '#456c3c'; ctx.beginPath();
    ctx.ellipse(cx + unit * .1, cy - unit * .16, unit * .23, unit * .08, -.4, 0, Math.PI * 2); ctx.fill();
    dot(cx - unit * .12, cy, unit * .13, '#c47732');
    dot(cx + unit * .12, cy, unit * .13, '#e1a642');
    dot(cx, cy + unit * .16, unit * .13, '#b96030');
  }
  // An eliminated marker stays visible unless a living player occupies its cell.
  for (const [i, [y, x]] of frame.positions.entries()) if (!frame.alive[i]) {
    ctx.fillStyle = '#425c50'; ctx.font = `bold ${unit * .7}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('×', (x + .5) * w, (y + .72) * h);
  }
  const skins = ['#ad7552', '#e2b68b', '#754d38', '#b98460', '#deb38b', '#8e5c42', '#bd8965', '#d4a576'];
  const continued = previous && previous.tick + 1 === frame.tick;
  frame.positions.forEach(([y, x], i) => {
    if (!frame.alive[i]) return;
    const cx = (x + .5) * w, cy = (y + .5) * h;
    const old = continued ? previous.positions[i] : [y, x];
    const moving = old[0] !== y || old[1] !== x;
    const stride = moving ? (frame.tick % 2 ? .07 : -.07) : 0;
    ctx.save(); ctx.translate(cx, cy);
    // Head, shirt, arms and legs read as a person even in the compact view.
    ctx.strokeStyle = '#344840'; ctx.lineWidth = unit * .1;
    ctx.beginPath(); ctx.moveTo(-unit * .09, unit * .12);
    ctx.lineTo(-unit * (.13 + stride), unit * .38);
    ctx.moveTo(unit * .09, unit * .12); ctx.lineTo(unit * (.13 - stride), unit * .38); ctx.stroke();
    ctx.strokeStyle = skins[i % skins.length]; ctx.lineWidth = unit * .09;
    ctx.beginPath(); ctx.moveTo(-unit * .18, -unit * .1); ctx.lineTo(-unit * .28, unit * .15);
    ctx.moveTo(unit * .18, -unit * .1); ctx.lineTo(unit * .28, unit * .15); ctx.stroke();
    ctx.fillStyle = `hsl(${i * 45},65%,47%)`;
    ctx.fillRect(-unit * .19, -unit * .17, unit * .38, unit * .36);
    dot(0, -unit * .32, unit * .15, skins[i % skins.length]);
    ctx.restore();
    // Number beside the player matches the live stats and hover card.
    ctx.fillStyle = '#1d352c'; ctx.font = `bold ${unit * .45}px sans-serif`; ctx.textAlign = 'left';
    ctx.fillText(String(i + 1), cx + unit * .31, cy + unit * .1);
    ctx.fillStyle = '#718766'; ctx.fillRect(cx - unit * .36, (y + .94) * h, unit * .72, unit * .05);
    ctx.fillStyle = frame.power[i] <= 6 ? '#9b4935' : '#f3f0cb';
    ctx.fillRect(cx - unit * .36, (y + .94) * h, unit * .72 * frame.power[i] / config.power_limit, unit * .05);
  });
}
