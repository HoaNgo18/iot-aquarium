// Presentation only: plot the backend's unchanged, filtered relative readings.
export function drawClaritySparkline(canvas, history, baselines, rules, now = Date.now()) {
  const sparse = history.filter(row => row.time >= now - 86400000 && Number.isFinite(row.clarity)).length < 3;
  if (canvas.closest('.clarity-card')) {
    canvas.hidden = sparse;
    canvas.closest('.clarity-card').querySelector('.clarity-chart-caption').textContent = sparse ? 'Đang thu thập dữ liệu' : '24 giờ qua · vạch đứng: thay nước';
    if (sparse) return;
  }
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, width * dpr); canvas.height = Math.max(1, height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const start = now - 86400000;
  const rows = history.filter(row => row.time >= start && row.time <= now);
  const ceiling = Math.max(110, ...rows.map(row => Number.isFinite(row.clarity) ? row.clarity : 0));
  const x = time => 3 + (time - start) / 86400000 * (width - 6);
  const y = value => 3 + (1 - value / ceiling) * (height - 6);
  const clear = rules?.clear_min_pct, cloudy = rules?.cloudy_below_pct;
  for (const [low, high, color] of rules ? [[clear, ceiling, '#45be8015'], [cloudy, clear, '#f0b85c15'], [0, cloudy, '#ff6b7215']] : []) {
    ctx.fillStyle = color; ctx.fillRect(0, y(high), width, y(low) - y(high));
  }
  ctx.strokeStyle = '#4fa8ff'; ctx.fillStyle = '#4fa8ff'; ctx.lineWidth = 1.5;
  let previous = null;
  for (const row of rows) {
    if (!Number.isFinite(row.clarity)) { previous = null; continue; }
    if (previous && row.time - previous.time <= 600000 && row.clarityBaselineAt === previous.clarityBaselineAt) {
      ctx.beginPath(); ctx.moveTo(x(previous.time), y(previous.clarity)); ctx.lineTo(x(row.time), y(row.clarity)); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x(row.time), y(row.clarity), 1.5, 0, Math.PI * 2); ctx.fill(); previous = row;
  }
  ctx.strokeStyle = '#91a4b5'; ctx.setLineDash([2, 3]);
  for (const event of baselines) {
    const time = new Date(event.created_at).getTime();
    if (!event.water_changed || time < start || time > now) continue;
    ctx.beginPath(); ctx.moveTo(x(time), 2); ctx.lineTo(x(time), height - 2); ctx.stroke();
  }
  if (!rows.some(row => Number.isFinite(row.clarity))) {
    ctx.fillStyle = '#91a4b5'; ctx.font = '12px sans-serif'; ctx.fillText('Chưa có dữ liệu trong 24 giờ', 8, height / 2);
  }
}
