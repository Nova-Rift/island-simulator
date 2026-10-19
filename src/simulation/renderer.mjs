/** Meadow presentation only. Copied frames in; no stepping, RNG or policy input. */
export function drawSyntheticFrame(ctx, frame, config, previous = null) {
  const cellWidth = ctx.canvas.width / config.size;
  const cellHeight = ctx.canvas.height / config.size;
  const cell = Math.min(cellWidth, cellHeight);
  // Spread the whole grid across the viewport; keep animals and tags proportional.
  const px = (x, offset) => (x + .5) * cellWidth + (offset - .5) * cell;
  const py = (y, offset) => (y + .5) * cellHeight + (offset - .5) * cell;
  const circle = (x, y, radius, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  };
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#dce5bf'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Fixed grass texture depends only on tile coordinates, never world randomness.
  for (let y = 0; y < config.size; y++) for (let x = 0; x < config.size; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#d6e0b6' : '#dde6c0';
    ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
    if ((x * 7 + y * 3) % 5 === 0) {
      ctx.strokeStyle = '#b1c291'; ctx.lineWidth = cell * .035;
      ctx.beginPath(); ctx.moveTo(px(x, .18), py(y, .75));
      ctx.lineTo(px(x, .13), py(y, .6));
      ctx.moveTo(px(x, .18), py(y, .75));
      ctx.lineTo(px(x, .24), py(y, .63)); ctx.stroke();
    }
  }
  // Orange thorn patches are dangerous; muted patches are currently inactive.
  for (const [y, x] of frame.hazardCells) {
    ctx.fillStyle = frame.hazardsActive ? '#d69456' : '#c5c6a0';
    ctx.beginPath(); ctx.ellipse(px(x, .5), py(y, .53),
      cell * .46, cell * .39, -.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = frame.hazardsActive ? '#874627' : '#899273'; ctx.lineWidth = cell * .045;
    ctx.beginPath(); ctx.moveTo(px(x, .17), py(y, .67));
    ctx.lineTo(px(x, .7), py(y, .3));
    for (const [tx, ty] of [[.3, .58], [.48, .45], [.63, .35]]) {
      ctx.moveTo(px(x, tx), py(y, ty));
      ctx.lineTo(px(x, tx - .03), py(y, ty - .16));
    }
    ctx.stroke();
  }
  // Every berry cluster is exactly one real shared food/recharge cell.
  for (const [y, x] of frame.resources) {
    const cx = px(x, .5), cy = py(y, .5);
    ctx.fillStyle = '#5b854b'; ctx.beginPath();
    ctx.ellipse(cx + .07 * cell, cy - .13 * cell, cell * .19, cell * .08, -.5, 0, Math.PI * 2); ctx.fill();
    circle(cx - .1 * cell, cy, cell * .11, '#ac4b50');
    circle(cx + .1 * cell, cy, cell * .11, '#bd5a60');
    circle(cx, cy + .13 * cell, cell * .11, '#8f3e4b');
    circle(cx + .08 * cell, cy - .03 * cell, cell * .025, '#f6d7c1');
  }
  const continued = previous && previous.tick + 1 === frame.tick;
  // Draw inactive markers first so a living mouse on the same tile stays visible.
  for (const [i, [y, x]] of frame.positions.entries()) if (!frame.alive[i]) {
    circle(px(x, .5), py(y, .5), cell * .21, '#9ba48a');
    ctx.strokeStyle = '#596450'; ctx.lineWidth = cell * .055;
    ctx.beginPath(); ctx.moveTo(px(x, .4), py(y, .4));
    ctx.lineTo(px(x, .6), py(y, .6));
    ctx.moveTo(px(x, .6), py(y, .4));
    ctx.lineTo(px(x, .4), py(y, .6)); ctx.stroke();
  }
  frame.positions.forEach(([y, x], i) => {
    if (!frame.alive[i]) return;
    const cx = px(x, .5), cy = py(y, .45);
    const old = continued ? previous.positions[i] : [y, x];
    const dy = y - old[0], dx = x - old[1];
    const angle = dx || dy ? Math.atan2(dy, dx) + Math.PI / 2 : -.35;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    // Tail, rounded body, ears and pointed nose make a mouse at small sizes.
    ctx.strokeStyle = '#aa8175'; ctx.lineWidth = cell * .05;
    ctx.beginPath(); ctx.moveTo(0, cell * .22);
    ctx.quadraticCurveTo(cell * .31, cell * .51, cell * .28, cell * .22); ctx.stroke();
    ctx.fillStyle = '#8b7764'; ctx.beginPath();
    ctx.ellipse(0, cell * .04, cell * .22, cell * .29, 0, 0, Math.PI * 2); ctx.fill();
    for (const side of [-1, 1]) {
      circle(side * cell * .17, -cell * .16, cell * .115, '#9c8773');
      circle(side * cell * .17, -cell * .16, cell * .069, '#d8b1a2');
    }
    ctx.fillStyle = '#9c8773'; ctx.beginPath();
    ctx.moveTo(-cell * .17, -cell * .13); ctx.lineTo(0, -cell * .36);
    ctx.lineTo(cell * .17, -cell * .13); ctx.closePath(); ctx.fill();
    circle(0, -cell * .34, cell * .043, '#69473f');
    circle(-cell * .075, -cell * .2, cell * .026, '#242b23');
    circle(cell * .075, -cell * .2, cell * .026, '#242b23');
    // A colored back tag connects each mouse to its number and stat row.
    circle(0, cell * .045, cell * .12, `hsl(${i * 45},75%,70%)`);
    ctx.restore();
    ctx.fillStyle = '#263c2b'; ctx.font = `bold ${cell * .4}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(String(i), cx, py(y, .51));
    ctx.fillStyle = '#81966d'; ctx.fillRect(px(x, .14), py(y, .87), cell * .72, cell * .06);
    ctx.fillStyle = frame.power[i] <= 6 ? '#b65d39' : '#4e7940';
    ctx.fillRect(px(x, .14), py(y, .87), cell * .72 * frame.power[i] / config.power_limit, cell * .06);
  });
}
