export function travelAt(before, after, time) {
  if (!before) return after.travel;
  if (after.time <= before.time) return after.travel;
  const share = Math.min(1, Math.max(0, (time - before.time) / (after.time - before.time)));
  return before.travel + (after.travel - before.travel) * share;
}
