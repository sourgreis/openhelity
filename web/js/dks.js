export const DKS_EVENTS = 4;
export const dksStatus = (cells) => cells.reduce((word, value, event) => word | ((value & 7) << (3 * event)), 0);
export const dksCells = (status) => Array.from({ length: DKS_EVENTS }, (_, event) => (status >> (3 * event)) & 7);

export function dksPresses(cells) {
  const presses = [];
  for (let event = 0; event < DKS_EVENTS; event += 1) {
    if (!(cells[event] & 1)) continue;
    if (!(cells[event] & 2)) {
      presses.push({ start: event, release: null });
      continue;
    }
    const start = event;
    while (cells[event] & 4 && event < DKS_EVENTS - 1) event += 1;
    presses.push({ start, release: event + 1 });
  }
  return presses;
}

export function dksFromPresses(presses) {
  const cells = Array(DKS_EVENTS).fill(0);
  for (const { start, release } of presses) {
    if (release === null) {
      cells[start] = 1;
      continue;
    }
    for (let event = start; event < release; event += 1) cells[event] = event === release - 1 ? 3 : 7;
  }
  return cells;
}
