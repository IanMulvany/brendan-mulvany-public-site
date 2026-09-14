import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {buildSearchCatalogSql, MAX_SEARCH_PHOTOS, validateSearchPhotos} from '../scripts/search-catalog.mjs';

const migration = name => readFileSync(new URL(`../community-migrations/${name}`, import.meta.url), 'utf8');
const searchMigration = migration('0004_search.sql');
const photo = (id, extra = {}) => ({id, collectionId: 'public-roll', title: `Photograph ${id}`, description: 'Pope visit in Ireland',
  date: '1979-09-01', year: '1979', location: 'Ireland', tags: ['Archive'],
  imageBase: `https://cdn.brendan-mulvany-photography.com/public-${id}`, width: null, height: 800, ...extra});
const sample = [photo(1), photo(2, {collectionId: 'other-roll', description: 'Football at Wembley'})];
function fixture(t, installSearch = true) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001_accounts.sql', '0002_community.sql', '0003_homepage.sql']) db.exec(migration(name));
  db.exec(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at) VALUES
    ('verified','verified@example.test','Verified','member','active',1,1,1),
    ('unverified','private@example.test','Unverified','member','active',NULL,1,1),
    ('suspended','suspended@example.test','Suspended','member','suspended',1,1,1)`);
  if (installSearch) db.exec(searchMigration);
  t.after(() => db.close());
  return db;
}
function annotation(db, {id = 'one', photoId = 1, userId = 'verified', name = 'Seán O’Brien', note = 'Blue jacket', hidden = false} = {}) {
  db.prepare(`INSERT INTO annotations(id,photo_id,user_id,name,note,x,y,width,height,created_at,hidden_at,hidden_by)
    VALUES(?,?,?,?,?,0.1,0.1,0.2,0.2,1,?,?)`).run(id, photoId, userId, name, note, hidden ? 2 : null, hidden ? 'verified' : null);
}
function hits(db, ...terms) {
  const query = terms.map(term => `"${term.replaceAll('"', '""')}"*`).join(' AND ');
  return db.prepare(`SELECT p.id FROM search_photos_fts JOIN search_photos p ON p.id=search_photos_fts.rowid
    WHERE search_photos_fts MATCH ? ORDER BY p.id`).all(query).map(row => row.id);
}
function integrity(db) {
  db.exec("INSERT INTO search_photos_fts(search_photos_fts,rank) VALUES('integrity-check',1)");
}
function staged(sample) {
  const sql = buildSearchCatalogSql(sample), offset = sql.lastIndexOf('INSERT INTO search_catalog_imports');
  return {prefix: sql.slice(0, offset), publish: sql.slice(offset)};
}
function rows(db, table) { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({...row})); }

test('initial catalog backfills only visible names and notes from verified authors, including suspended authors', t => {
  const db = fixture(t, false);
  annotation(db);
  annotation(db, {id: 'hidden', name: 'Hiddenname', note: 'Hiddennote', hidden: true});
  annotation(db, {id: 'unverified', name: 'Privatename', note: 'Privatenote', userId: 'unverified'});
  annotation(db, {id: 'suspended', name: 'Suspendedname', note: 'Publicnote', userId: 'suspended'});
  db.exec(searchMigration);
  db.exec(buildSearchCatalogSql({photos: sample}));
  assert.deepEqual(hits(db, 'sean'), [1]);
  assert.deepEqual(hits(db, 'blue'), [1]);
  assert.deepEqual(hits(db, 'suspendedname', 'publicnote'), [1]);
  for (const term of ['hiddenname', 'hiddennote', 'privatename', 'privatenote', 'private@example.test', 'verified@example.test']) {
    assert.deepEqual(hits(db, term), []);
  }
  assert.deepEqual(rows(db, 'search_catalog_stage'), []);
  assert.deepEqual(rows(db, 'search_catalog_imports'), []);
  integrity(db);
});

test('create, rename, note change, hide, restore, move and physical delete update the same FTS document immediately', t => {
  const db = fixture(t);
  db.exec(buildSearchCatalogSql(sample));
  annotation(db);
  assert.deepEqual(hits(db, 'sean', 'pope', 'blue'), [1]);
  db.prepare('UPDATE annotations SET name=?,note=? WHERE id=?').run('Máire O’Neill', 'Green scarf', 'one');
  assert.deepEqual(hits(db, 'sean'), []);
  assert.deepEqual(hits(db, 'blue'), []);
  assert.deepEqual(hits(db, 'maire', 'green'), [1]);
  db.exec("UPDATE annotations SET hidden_at=2,hidden_by='verified' WHERE id='one'");
  assert.deepEqual(hits(db, 'maire'), []);
  assert.equal(db.prepare('SELECT annotation_text FROM search_photos WHERE id=1').get().annotation_text, '');
  db.exec("UPDATE annotations SET hidden_at=NULL,hidden_by=NULL WHERE id='one'");
  assert.deepEqual(hits(db, 'maire'), [1]);
  db.exec("UPDATE annotations SET photo_id=2 WHERE id='one'");
  assert.deepEqual(hits(db, 'maire'), [2]);
  assert.deepEqual(hits(db, 'maire', 'pope'), []);
  assert.deepEqual(hits(db, 'maire', 'football', 'scarf'), [2]);
  db.exec("DELETE FROM annotations WHERE id='one'");
  assert.deepEqual(hits(db, 'maire'), []);
  integrity(db);
});

test('multiple annotations and mixed metadata terms return one photograph, with AND prefix and diacritic matching', t => {
  const db = fixture(t);
  db.exec(buildSearchCatalogSql(sample));
  annotation(db, {id: 'a', name: 'Seán O’Brien', note: 'Camera in hand'});
  annotation(db, {id: 'b', name: 'Seán O’Connor', note: 'Standing nearby'});
  assert.deepEqual(hits(db, 'sea'), [1]);
  assert.deepEqual(hits(db, 'pope', 'sea', 'cam'), [1]);
  assert.deepEqual(hits(db, '1979', 'camera', 'nearby'), [1]);
  assert.deepEqual(hits(db, 'sean', 'football'), []);
  integrity(db);
});

test('verification changes refresh affected photos while suspension preserves public contribution visibility', t => {
  const db = fixture(t);
  db.exec(buildSearchCatalogSql(sample));
  annotation(db);
  annotation(db, {id: 'second', photoId: 2});
  db.exec("UPDATE users SET verified_at=NULL WHERE id='verified'");
  assert.deepEqual(hits(db, 'sean'), []);
  db.exec("UPDATE users SET verified_at=3,status='suspended' WHERE id='verified'");
  assert.deepEqual(hits(db, 'sean'), [1, 2]);
  db.exec("UPDATE annotations SET user_id='unverified' WHERE id='one'");
  assert.deepEqual(hits(db, 'sean'), [2]);
  db.exec("UPDATE users SET verified_at=4 WHERE id='unverified'");
  assert.deepEqual(hits(db, 'sean'), [1, 2]);
  integrity(db);
});

test('catalog activation reads live annotations after staging and excludes names hidden during an import', t => {
  const db = fixture(t);
  db.exec(buildSearchCatalogSql(sample));
  annotation(db, {name: 'Oldname'});
  const pending = staged([photo(1, {description: 'Updated publication'})]);
  db.exec(pending.prefix);
  assert.deepEqual(hits(db, 'pope'), [1]);
  db.exec("UPDATE annotations SET hidden_at=2,hidden_by='verified' WHERE id='one'");
  annotation(db, {id: 'late', name: 'Newname', note: 'Added during import'});
  db.exec(pending.publish);
  assert.deepEqual(hits(db, 'oldname'), []);
  assert.deepEqual(hits(db, 'updated', 'newname', 'import'), [1]);
  assert.deepEqual(hits(db, 'pope'), []);
  integrity(db);
});

test('incomplete imports cannot replace the active catalog and different snapshots cannot mix staging rows', t => {
  const db = fixture(t);
  db.exec(buildSearchCatalogSql(sample));
  const original = rows(db, 'search_photos');
  const first = staged([photo(3), photo(4)]), other = staged([photo(5), photo(6)]);
  db.exec(first.prefix);
  db.exec(other.prefix);
  db.exec('DELETE FROM search_catalog_stage WHERE id=4');
  assert.throws(() => db.exec(first.publish), /staging is incomplete/);
  assert.deepEqual(rows(db, 'search_photos'), original);
  assert.deepEqual(rows(db, 'search_catalog_imports'), []);
  db.exec(other.publish);
  assert.deepEqual(rows(db, 'search_photos').map(row => row.id), [5, 6]);
  // The incomplete first import remains inert and cannot pollute another hash.
  assert.equal(rows(db, 'search_catalog_stage').length, 1);
  integrity(db);
});

test('a failure partway through activation rolls back metadata, pruning and FTS changes together', t => {
  const db = fixture(t);
  db.exec(buildSearchCatalogSql(sample));
  annotation(db);
  const original = rows(db, 'search_photos');
  db.exec("CREATE TRIGGER reject_test_photo BEFORE INSERT ON search_photos WHEN NEW.id=99 BEGIN SELECT RAISE(ABORT,'test activation failure'); END");
  const pending = staged([photo(1, {description: 'Should roll back'}), photo(99)]);
  db.exec(pending.prefix);
  assert.throws(() => db.exec(pending.publish), /test activation failure/);
  assert.deepEqual(rows(db, 'search_photos'), original);
  assert.deepEqual(hits(db, 'pope', 'sean'), [1]);
  assert.deepEqual(hits(db, 'should'), []);
  assert.deepEqual(rows(db, 'search_catalog_imports'), []);
  integrity(db);
});

test('reimport prunes unpublished search rows while preserving all community tables and later restores their annotations', t => {
  const db = fixture(t);
  db.exec(buildSearchCatalogSql(sample));
  annotation(db, {photoId: 2});
  db.exec(`INSERT INTO comments VALUES('comment',2,'verified','A memory',1,NULL,NULL);
    INSERT INTO likes VALUES('like',2,'verified',1);
    INSERT INTO collection_heroes VALUES('other-roll',2,'verified',1);
    INSERT INTO homepage_settings VALUES(1,'["other-roll"]','verified',1);
    INSERT INTO activity VALUES('activity','verified','annotation.created',2,'one',1);
    INSERT INTO sessions VALUES('session','verified',1,99,NULL)`);
  const tables = ['users', 'annotations', 'comments', 'likes', 'collection_heroes', 'homepage_settings', 'activity', 'sessions'];
  const before = Object.fromEntries(tables.map(table => [table, rows(db, table)]));
  db.exec(buildSearchCatalogSql([sample[0]]));
  assert.deepEqual(hits(db, 'sean'), []);
  assert.deepEqual(hits(db, 'football'), []);
  for (const table of tables) assert.deepEqual(rows(db, table), before[table], `${table} must survive a search reimport`);
  db.exec(buildSearchCatalogSql(sample));
  db.exec(buildSearchCatalogSql(sample));
  assert.deepEqual(hits(db, 'sean', 'football'), [2]);
  assert.equal(rows(db, 'search_photos').length, 2);
  integrity(db);
});

test('quoted and UTF-8 metadata round trips as data, and canonical hashes ignore input order and unrelated fields', t => {
  const db = fixture(t);
  const unusual = photo(1, {title: "O'Brien’s photograph", description: "First line\nSecond line: '); DELETE FROM users; -- 漢字", tags: ['Irish', '"quoted"']});
  const sql = buildSearchCatalogSql([unusual, sample[1]]);
  assert.equal(sql, buildSearchCatalogSql([{...sample[1], email: 'never exported'}, {...unusual, secret: 'never exported'}]));
  assert.doesNotMatch(sql, /never exported/);
  db.exec(sql);
  const stored = db.prepare('SELECT title,description,tags FROM search_photos WHERE id=1').get();
  assert.equal(stored.title, unusual.title);
  assert.equal(stored.description, unusual.description);
  assert.deepEqual(JSON.parse(stored.tags), unusual.tags);
  assert.equal(rows(db, 'users').length, 3);
  assert.deepEqual(hits(db, 'second'), [1]);
  integrity(db);
});

test('unsafe metadata, ambiguous IDs, empty and oversized catalogs fail before producing any import SQL', () => {
  for (const invalid of [[], [...sample, sample[0]], Array.from({length: MAX_SEARCH_PHOTOS + 1}, (_, i) => photo(i + 1))]) {
    assert.throws(() => buildSearchCatalogSql(invalid));
  }
  for (const change of [{id: 0}, {id: Number.MAX_SAFE_INTEGER + 1}, {width: undefined}, {height: Infinity},
    {collectionId: '../private'}, {imageBase: 'https://private.example/photo'}, {tags: ['ok', {}]}, {year: 'soon'},
    {title: ''}, {description: '\0'}, {description: '\ud800'}, {description: 'é'.repeat(46_000)}]) {
    assert.throws(() => buildSearchCatalogSql([photo(1, change)]));
  }
  assert.equal(validateSearchPhotos(Array.from({length: MAX_SEARCH_PHOTOS}, (_, i) => photo(i + 1))).length, MAX_SEARCH_PHOTOS);
});
