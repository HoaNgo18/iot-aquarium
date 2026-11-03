export function clarityScale(values, rules) {
  const anchors = [rules.cloudy_below_pct, rules.clear_min_pct, 100, ...values.filter(Number.isFinite)];
  const min = Math.max(0, Math.floor((Math.min(...anchors) - 5) / 10) * 10);
  const max = Math.ceil((Math.max(...anchors) + 5) / 5) * 5;
  return { min, max, ticks: [...new Set([min, rules.cloudy_below_pct, rules.clear_min_pct, 100, max])].sort((a, b) => a - b) };
}

// Long gaps take a short, explicit break instead of consuming most of the plot.
export function compressedTimeline(rows, metric, gapLimit, now = null) {
  const data = rows.filter(row => Number.isFinite(row[metric]));
  const positions = [0], gaps = [];
  for (let i = 1; i < data.length; i++) {
    const elapsed = data[i].time - data[i - 1].time;
    if (elapsed > gapLimit) gaps.push({ index: i, from: data[i - 1].time, to: data[i].time });
    positions.push(positions[i - 1] + (elapsed > gapLimit ? gapLimit * .15 : elapsed));
  }
  let span = positions.at(-1) || 1;
  const tail = data.length && now !== null && now - data.at(-1).time > gapLimit
    ? { from: data.at(-1).time, to: new Date(now), position: positions.at(-1) } : null;
  if (tail) span += Math.max(span * .25, gapLimit * .15);
  function position(time) {
    if (tail && time > data.at(-1).time) return tail.position + Math.min(1, (time - tail.from) / (tail.to - tail.from)) * (span - tail.position);
    if (data.length < 2) return tail ? 0 : span / 2;
    const index = data.findIndex(row => row.time >= time);
    if (index <= 0) return index === -1 ? span : 0;
    return positions[index - 1] + (time - data[index - 1].time) / (data[index].time - data[index - 1].time) * (positions[index] - positions[index - 1]);
  }
  return { data, positions, gaps, span, position, tail };
}
