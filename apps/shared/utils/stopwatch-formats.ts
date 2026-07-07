export function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;

  // Nudge by a tiny epsilon before truncating: values that are mathematically
  // exact (e.g. 2.55) can be stored as 2.5499999999… so `2.55 * 100` floors to
  // 254 and renders "2.54". Truncation semantics are preserved for genuine
  // sub-centisecond fractions. Derive s/m from the corrected centiseconds so a
  // rolled centisecond can never disagree with the seconds field.
  const totalCentiseconds = Math.floor(seconds * 100 + 1e-7);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);

  const pad2 = (n: number) => n.toString().padStart(2, "0");

  if (m >= 10) return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
  if (m >= 1) return `${m}:${pad2(s)}.${pad2(cs)}`;
  return `${s}.${pad2(cs)}`;
}
