// Keep the editor next to the selection without covering it. A small viewport,
// large selection or expanded editor uses the space directly below the image.
export function editorPosition(region, image, stage, card, viewportWidth) {
  if (!region || viewportWidth < 740 || card.width > stage.width || card.height > stage.height) return null;
  const gap = 12, inset = 8;
  const left = image.x + region.x * image.width;
  const top = image.y + region.y * image.height;
  const right = left + region.width * image.width;
  const bottom = top + region.height * image.height;
  const clampX = x => Math.max(inset, Math.min(stage.width - card.width - inset, x));
  const clampY = y => Math.max(inset, Math.min(stage.height - card.height - inset, y));
  const candidates = [
    { left: right + gap, top: clampY(top) },
    { left: left - card.width - gap, top: clampY(top) },
    { left: clampX(left), top: bottom + gap },
    { left: clampX(left), top: top - card.height - gap },
  ];
  return candidates.find(p => p.left >= inset && p.top >= inset && p.left + card.width <= stage.width - inset && p.top + card.height <= stage.height - inset) || null;
}
