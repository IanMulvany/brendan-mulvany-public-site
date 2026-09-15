// Keep the first preview's shared links while serving the original archive paths.
// Photo redirects use three patterns; collection aliases are generated only for
// real gallery pages so unknown paths still return a proper 404.
export function buildRedirects(collections, photos, galleryPageSize = 48) {
  if (!Number.isSafeInteger(galleryPageSize) || galleryPageSize < 1) throw new Error('Invalid gallery page size');
  const counts = new Map();
  for (const photo of photos) counts.set(String(photo.collectionId), (counts.get(String(photo.collectionId)) || 0) + 1);
  const ids = new Set();
  const rolls = new Set();
  const lines = ['/rolls /collections/ 301', '/rolls/ /collections/ 301',
    '/rolls/index.html /collections/ 301', '/search.html /search/ 301'];
  for (const collection of collections) {
    const id = String(collection.id);
    const roll = String(collection.roll);
    if (!/^[a-z0-9-]+$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(roll)
      || ids.has(id) || rolls.has(roll) || id === 'page') throw new Error('Invalid or duplicate collection route');
    ids.add(id);
    rolls.add(roll);
    const pages = Math.ceil((counts.get(id) || 0) / galleryPageSize);
    if (!pages) throw new Error('Collection has no photographs');
    for (let page = 1; page <= pages; page++) {
      const suffix = page === 1 ? '' : `/page/${page}`;
      const source = `/collections/${id}${suffix}`;
      const target = `/roll/${roll}${suffix}/`;
      for (const ending of ['', '/', '/index.html']) lines.push(`${source}${ending} ${target} 301`);
    }
  }
  if ([...counts.keys()].some(id => !ids.has(id))) throw new Error('Photograph has no collection route');
  if (lines.length > 2000) throw new Error('Collection redirects exceed the static redirect limit');
  return ['# Keep existing preview links; canonical archive pages use /image/ and /roll/.',
    ...lines,
    '/photos/:id/index.html /image/:id/ 301',
    '/photos/:id/ /image/:id/ 301',
    '/photos/:id /image/:id/ 301',
    '/image_detail/:id/index.html /image/:id/ 301',
    '/image_detail/:id/ /image/:id/ 301',
    '/image_detail/:id /image/:id/ 301',
    '',
  ].join('\n');
}
