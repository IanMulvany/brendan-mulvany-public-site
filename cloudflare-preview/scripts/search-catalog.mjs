import {createHash} from 'node:crypto';

export const MAX_SEARCH_PHOTOS = 2400;
const MAX_STATEMENT_BYTES = 90_000; // Safely below D1's 100 KB SQL statement limit.
const fields = ['id', 'collectionId', 'title', 'description', 'date', 'year', 'location', 'tags', 'imageBase', 'width', 'height'];
const sqlFields = 'id,collection_id,title,description,date,year,location,tags,image_base,width,height';

function text(value, field, nonempty = false) {
  if (typeof value !== 'string' || value.includes('\0') || !value.isWellFormed() || (nonempty && !value.trim())) {
    throw new Error(`Invalid public photo ${field}`);
  }
  return value;
}
function dimension(value, field) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`Invalid public photo ${field}`);
  return value;
}
export function validateSearchPhotos(sample) {
  const photos = Array.isArray(sample) ? sample : sample?.photos;
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > MAX_SEARCH_PHOTOS) {
    throw new Error(`Search catalog must contain between 1 and ${MAX_SEARCH_PHOTOS} public photos`);
  }
  const ids = new Set();
  const rows = photos.map(photo => {
    if (!photo || typeof photo !== 'object' || !Number.isSafeInteger(photo.id) || photo.id <= 0 || ids.has(photo.id)) {
      throw new Error('Public photo IDs must be distinct positive safe integers');
    }
    ids.add(photo.id);
    const collectionId = text(photo.collectionId, 'collectionId');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(collectionId)) throw new Error('Invalid public collection ID');
    const imageBase = text(photo.imageBase, 'imageBase');
    if (!/^https:\/\/cdn\.brendan-mulvany-photography\.com\/[A-Za-z0-9_-]+$/.test(imageBase)) {
      throw new Error('Public photo imageBase must identify an existing archive CDN key');
    }
    if (!Array.isArray(photo.tags)) throw new Error('Public photo tags must be a text array');
    const tags = photo.tags.map(tag => text(tag, 'tag'));
    const year = text(photo.year, 'year');
    if (!/^(?:\d{4})?$/.test(year)) throw new Error('Invalid public photo year');
    return {id: photo.id, collectionId, title: text(photo.title, 'title', true),
      description: text(photo.description, 'description'), date: text(photo.date, 'date'), year,
      location: text(photo.location, 'location'), tags, imageBase,
      width: dimension(photo.width, 'width'), height: dimension(photo.height, 'height')};
  });
  return rows.sort((a, b) => a.id - b.id);
}
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;

// Pure generator: no files, network, account data or annotation snapshots.
// Every active-catalog mutation lives in the migration's final publish trigger.
export function buildSearchCatalogSql(sample) {
  const photos = validateSearchPhotos(sample);
  const importId = createHash('sha256').update(JSON.stringify(photos)).digest('hex');
  const sql = [
    '-- Public metadata only; apply community migration 0004_search.sql first.',
    `-- ${photos.length} photos; content SHA-256 ${importId}. No BEGIN/COMMIT: D1 manages transactions.`,
    `DELETE FROM search_catalog_stage WHERE import_id=${literal(importId)};`,
  ];
  for (const photo of photos) {
    const values = fields.map(field => field === 'tags' ? JSON.stringify(photo.tags) : photo[field]);
    const statement = `INSERT INTO search_catalog_stage(import_id,${sqlFields}) VALUES(${[importId, ...values].map(literal).join(',')});`;
    if (Buffer.byteLength(statement, 'utf8') > MAX_STATEMENT_BYTES) {
      throw new Error(`Photo ${photo.id} exceeds the safe D1 statement size; review its public metadata`);
    }
    sql.push(statement);
  }
  sql.push(`INSERT INTO search_catalog_imports(id,expected_count) VALUES(${literal(importId)},${photos.length});`);
  return sql.join('\n') + '\n';
}
