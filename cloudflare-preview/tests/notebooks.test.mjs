import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {notebookModel, notebookDirectory, notebookPage, notebookBacklinks} from '../scripts/notebooks.mjs';

const polygon = [[.1, .2], [.8, .19], [.8, .24], [.1, .25]];
const collections = [
  {id: 'first', roll: '3071', title: 'The Pope’s visit'},
  {id: 'second', roll: '5082', title: 'Wedding, first roll'},
  {id: 'third', roll: '5083', title: 'Wedding, second roll'},
  {id: 'synthetic', roll: 'misc-1978-1', title: 'Bill Harvey home'},
];
const entry = (overrides = {}) => ({id: 'IMG_6238:visual:015', rolls: ['3071'], method: 'verified', polygon, ...overrides});
const page = (overrides = {}) => ({
  id: 'img-6238', sourceImage: 'IMG_6238.jpeg', book: '2', title: 'Notebook 2, original page IMG_6238',
  image: '/notebooks/media/0123456789abcdef.webp', thumbnail: '/notebooks/media/0123456789abcdef-thumb.webp',
  width: 1650, height: 2200, entries: [entry()], ...overrides,
});
const model = (pages = [page()], published = collections) => notebookModel({version: 1, pages}, published);

test('only explicitly recorded published rolls produce hotspots and backlinks; unknown or synthetic rolls are never guessed', () => {
  const result = model([page({entries: [entry({rolls: ['3071', '9999', '1978', '78', '003071', 'roll 3071']})]})]);
  assert.equal(result.linkedRolls, 1);
  assert.equal(result.linkedPages.length, 1);
  assert.deepEqual([...result.backlinks.keys()], ['3071']);
  assert.deepEqual(result.pages[0].groups[0].targets.map(item => item.roll), ['3071']);
  assert.equal(notebookBacklinks(result, collections[3]), '');
  const html = notebookPage(result.pages[0], result);
  assert.match(html, /href="\/roll\/3071\/"/);
  assert.doesNotMatch(html, /href="\/roll\/(?:9999|1978|78|003071|misc-1978-1)\//);
  const none = model([page({entries: [entry({rolls: ['9999']})]})]);
  assert.equal(none.pages.length, 1, 'the source page is still available to browse');
  assert.equal(none.pages[0].groups.length, 0);
  assert.equal(none.linkedRolls, 0);
});

test('a shared physical row has one hotspot and an explicit choice of every published collection', () => {
  const result = model([page({entries: [
    entry({id: 'shared-row-a', rolls: ['5082', '5082']}),
    entry({id: 'shared-row-b', rolls: ['5083', '9999']}),
  ]})]);
  const source = result.pages[0];
  assert.equal(source.groups.length, 1);
  assert.equal(source.targets.length, 2);
  assert.deepEqual(source.groups[0].targets.map(item => item.roll), ['5082', '5083']);
  const html = notebookPage(source, result);
  assert.equal((html.match(/<polygon /g) || []).length, 1);
  assert.match(html, new RegExp(`href="#${source.groups[0].id}"`));
  assert.match(html, /Choose from rolls 5082, 5083/);
  assert.match(html, /href="\/roll\/5082\/"/);
  assert.match(html, /href="\/roll\/5083\/"/);
  for (const collection of collections.slice(1, 3)) {
    assert.match(notebookBacklinks(result, collection), new RegExp(`/notebooks/img-6238/#${source.groups[0].id}`));
  }
});

test('separate physical ditto rows keep separate hotspots even when their source entry ID is shared', () => {
  const secondPolygon = polygon.map(([x, y]) => [x, y + .07]);
  const result = model([page({entries: [entry({rolls: ['5082']}), entry({rolls: ['5083'], polygon: secondPolygon})]})]);
  assert.equal(result.pages[0].groups.length, 2);
  assert.notEqual(result.pages[0].groups[0].id, result.pages[0].groups[1].id);
  assert.equal((notebookPage(result.pages[0], result).match(/<polygon /g) || []).length, 2);
});

test('page-only provenance never invents a hotspot or leaks unpublished draft readings', () => {
  const result = model([page({entries: [entry({polygon: null, description: 'PRIVATE UNREVIEWED OCR TEXT'})]})]);
  const html = notebookPage(result.pages[0], result);
  assert.doesNotMatch(html, /<polygon /);
  assert.match(html, /Recorded source page/);
  assert.match(html, /href="\/roll\/3071\/"/);
  assert.doesNotMatch(html, /PRIVATE UNREVIEWED OCR TEXT/);
  assert.ok(notebookBacklinks(result, collections[0]));
});

test('notebook models reject unsafe media/source paths, duplicate pages and invalid dimensions', () => {
  for (const changes of [
    {image: '/notebooks/media/../../private.webp'}, {thumbnail: 'https://example.test/tracker.webp'},
    {image: 'javascript:alert(1)'}, {thumbnail: '/notebooks/media/a.webp'},
    {sourceImage: '../IMG_6238.jpeg'}, {id: 'img-6238/../admin'},
    {width: 0}, {height: Infinity}, {width: '1650'}, {height: 2.5}, {entries: null},
  ]) assert.throws(() => model([page(changes)]), /Invalid notebook page/);
  assert.throws(() => model([page(), page()]), /Invalid notebook page/);
  assert.throws(() => notebookModel({version: 2, pages: []}, collections), /Unsupported notebook index/);
});

test('unverified entries, invalid identifiers and unsafe normalized coordinates fail closed', () => {
  for (const changes of [
    {method: 'ocr_row'}, {id: 123}, {rolls: '3071'}, {rolls: [3071]},
    {polygon: [[0, 0], [1, 0]]}, {polygon: Array(13).fill([0, 0])},
    {polygon: [[0, 0], [1, 0], [0, -0.01]]}, {polygon: [[0, 0], [1.01, 0], [0, 1]]},
    {polygon: [[0, 0], ['1', 0], [0, 1]]}, {polygon: [[0, 0], [Infinity, 0], [0, 1]]},
    {polygon: [[0, 0], [NaN, 0], [0, 1]]}, {polygon: [[0, 0, 0], [1, 0], [0, 1]]},
    {polygon: '0,0 1,0 0,1'},
    {polygon: [[.2, .2], [.2, .2], [.2, .2]]},
    {polygon: [[0, 0], [.5, .5], [1, 1]]},
    {polygon: [[0, 0], [1, 1], [1, 0], [0, 1]]},
  ]) assert.throws(() => model([page({entries: [entry(changes)]})]), /Invalid reviewed notebook entry/);
  assert.throws(() => model([page({entries: [entry({rolls: ['unpublished'], method: 'ocr_row'})]})]),
    /Invalid reviewed notebook entry/, 'unpublished entries must still obey the data contract');
});

test('notebook titles and collection text are escaped in directory, page and backlink output', () => {
  const malicious = '<img src=x onerror="alert(1)"> & \'quoted\'';
  const published = [{id: 'one', roll: '3071', title: malicious}];
  const result = model([page({title: malicious, book: '"><script>alert(1)</script>'})], published);
  for (const html of [notebookDirectory(result), notebookPage(result.pages[0], result), notebookBacklinks(result, published[0])]) {
    assert.doesNotMatch(html, /<img src=x|<script>/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;quoted&#39;/);
  }
});

test('a roll-specific notebook conflict note is visible and escaped beside its linked collection', () => {
  const note = 'Notebook 6008 reads Billy Connolly; public metadata differs. <script>alert("x")</script>';
  const published = [{id: 'roll-6008', roll: '6008', title: 'Soccer photographs'}];
  const result = model([page({entries: [entry({rolls: ['6008'], note})]})], published);
  const html = notebookPage(result.pages[0], result);
  assert.deepEqual(result.pages[0].groups[0].notes, [note]);
  assert.match(html, /href="\/roll\/6008\/"/);
  assert.match(html, /class="notebook-entry__note">Notebook 6008 reads Billy Connolly; public metadata differs\./);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(published[0].title, 'Soccer photographs', 'source notes must not silently overwrite existing collection metadata');
});

test('every collection backlink targets an existing group on the corresponding notebook page', () => {
  const result = model([
    page(),
    page({id: 'img-6248', sourceImage: 'IMG_6248.jpeg', entries: [entry({id: 'another-source', rolls: ['3071', '5082']})]}),
    page({id: 'img-6254', sourceImage: 'IMG_6254.jpeg', entries: []}),
  ]);
  for (const collection of collections) {
    const backlinks = notebookBacklinks(result, collection);
    const targets = [...backlinks.matchAll(/href="\/notebooks\/([^/]+)\/#([^"]+)"/g)];
    assert.equal(targets.length, result.backlinks.get(collection.roll)?.length || 0);
    for (const [, pageId, groupId] of targets) {
      const source = result.pages.find(item => item.id === pageId);
      const group = source.groups.find(item => item.id === groupId);
      assert.ok(group.targets.some(item => item.roll === collection.roll));
      assert.match(notebookPage(source, result), new RegExp(`id="${groupId}"`));
    }
  }
  assert.match(notebookBacklinks(result, collections[0]), /Other notebook entries/);
  assert.match(notebookPage(result.pages[0], result), /First page/);
  assert.match(notebookPage(result.pages[2], result), /Last page/);
  assert.equal(result.pages[0].groups[0].id, model().pages[0].groups[0].id, 'anchors remain stable across builds');
});

const bundledPath = new URL('../static/notebooks/index.json', import.meta.url);
test('bundled notebook links and media are complete and refer only to the published catalogue', {skip: !existsSync(bundledPath)}, async () => {
  const data = JSON.parse(await readFile(bundledPath, 'utf8'));
  const catalogue = JSON.parse(await readFile(new URL('../data/sample.json', import.meta.url), 'utf8'));
  const result = notebookModel(data, catalogue.collections);
  const rolls = new Set(catalogue.collections.map(item => item.roll));
  assert.equal(result.pages.length, 160);
  for (const source of result.pages) {
    for (const path of [source.image, source.thumbnail]) assert.ok(existsSync(new URL(`../static${path}`, import.meta.url)), `missing notebook media: ${path}`);
    for (const group of source.groups) {
      for (const target of group.targets) assert.ok(rolls.has(target.roll));
      assert.match(notebookPage(source, result), new RegExp(`id="${group.id}"`));
    }
  }
  const wrong4024 = result.backlinks.get('4024') || [];
  assert.equal(wrong4024.length, 1, 'the mistaken OCR 4024/4029 duplicate must not become a second 4024 link');
  assert.equal(wrong4024[0].page.id, 'img-6241');
  assert.ok(wrong4024[0].group.polygon.every(([, y]) => y < .2), '4024 is the upper Birr Air Show row');
  assert.equal(result.backlinks.has('misc-1978-1'), false, 'the unnumbered Bill Harvey roll must not acquire a guessed notebook link');
});
