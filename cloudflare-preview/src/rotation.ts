type Region = {x: number; y: number; width: number; height: number; rotationTurns?: number};

// Editorial image URLs carry the clockwise quarter-turn count. Older images
// have no suffix and are the original orientation (zero turns).
export function imageTurns(imageBase: string): number {
  const match = /-editorial-r([0-3])-[0-9a-f]{16}$/.exec(imageBase);
  return match ? Number(match[1]) : 0;
}

export function rotateRegion<T extends Region>(region: T, currentTurns: number): T {
  const previous = region.rotationTurns ?? 0;
  let {x, y, width, height} = region;
  const delta = (currentTurns - previous + 4) % 4;
  for (let turns = delta; turns > 0; turns--) {
    [x, y, width, height] = [1 - y - height, x, height, width];
  }
  if (delta) [x, y, width, height] = [x, y, width, height].map(value => Math.round(value * 1e12) / 1e12);
  return {...region, x, y, width, height};
}
