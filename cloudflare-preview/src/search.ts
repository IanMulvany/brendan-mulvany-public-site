export const PAGE_SIZE = 24;
export class InvalidSearch extends Error {}

export function parseSearch(url: URL) {
  const raw = url.searchParams.get('q') ?? '';
  if (raw.length > 120) throw new InvalidSearch('Use a search of 120 characters or fewer.');
  const query = raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (query && !tokens.length) throw new InvalidSearch('Enter a word, name, place or year.');
  if (tokens.length > 8) throw new InvalidSearch('Use eight search words or fewer.');
  const collection = url.searchParams.get('collection') ?? '';
  if (collection && !/^[a-zA-Z0-9_-]{1,80}$/.test(collection)) {
    throw new InvalidSearch('Invalid collection.');
  }
  const pageValue = url.searchParams.get('page') ?? '1';
  if (!/^[1-9]\d{0,2}$/.test(pageValue) || Number(pageValue) > 100) {
    throw new InvalidSearch('Page must be between 1 and 100.');
  }
  const page = Number(pageValue);
  // Only extracted words reach FTS syntax; all values are bound parameters.
  const match = tokens.map(token => `"${token}"*`).join(' AND ');
  return {query, collection, page, match};
}

export function searchStatement(input: ReturnType<typeof parseSearch>) {
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (input.match) { clauses.push('photos_fts MATCH ?'); args.push(input.match); }
  if (input.collection) { clauses.push('p.collection_id = ?'); args.push(input.collection); }
  const sql = `SELECT p.id, p.collection_id, p.title, substr(p.description, 1, 240) AS description, p.date, p.year,
      p.location, p.tags, p.image_base, p.width, p.height
    FROM photos AS p ${input.match ? 'JOIN photos_fts ON photos_fts.rowid = p.id' : ''}
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY ${input.match ? 'photos_fts.rank, ' : ''}p.id
    LIMIT ? OFFSET ?`;
  args.push(PAGE_SIZE + 1, (input.page - 1) * PAGE_SIZE);
  return {sql, args};
}
