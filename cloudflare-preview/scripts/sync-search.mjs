#!/usr/bin/env node
import {mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildSearchCatalogSql, validateSearchPhotos} from './search-catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const cleanText = value => value == null || /^(?:none|null|nan)$/i.test(String(value).trim()) ? '' : String(value).trim();

async function boundedText(path, maximum = 2_000_000) {
  if ((await stat(path)).size > maximum) throw new Error(`Public source exceeds the size limit: ${path}`);
  const bytes = await readFile(path);
  if (bytes.length > maximum) throw new Error(`Public source changed beyond the size limit: ${path}`);
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

function pageData(html, name) {
  const match = html.match(new RegExp(`window\\.${name}\\s*=\\s*(\\{[\\s\\S]*?\\});\\s*</script>`));
  if (!match) throw new Error(`Missing public ${name} source data`);
  return JSON.parse(match[1]);
}

// Recheck the publication gate before generating a file or opening D1. Only
// existing public roll pages are read; the source database and accounts are not.
export async function validatePublishedManifest(sample, {
  publicDirectory = resolve(repo, 'public'), skipFile = resolve(repo, 'skip_images.md'),
} = {}) {
  const photos = validateSearchPhotos(sample);
  const audit = sample?.sourceValidation?.audit;
  if (audit?.scope !== 'full-published-archive' || audit.exportedPhotos !== photos.length) {
    throw new Error('Regenerate the complete public manifest before syncing search');
  }
  const indexHtml = await boundedText(resolve(publicDirectory, 'rolls/index.html'));
  const rolls = pageData(indexHtml, '__STATIC_DATA__').rolls;
  if (!Array.isArray(rolls) || !rolls.length || rolls.length !== audit.publishedRolls) {
    throw new Error('Public roll inventory differs from the exported manifest');
  }
  const buildDate = indexHtml.match(/<meta name="build-date" content="([^"]+)"/)?.[1] ?? null;
  if (buildDate !== audit.localIndexBuildDate) throw new Error('Public pages changed; regenerate the manifest first');
  const skipText = await boundedText(skipFile);
  const excluded = new Set((skipText.split('## Images to Skip').at(-1).match(/^\s*\d+\s*$/gm) ?? []).map(Number));
  const byCollection = new Map(), byRoll = new Map();
  if (!Array.isArray(sample.collections)) throw new Error('Missing public collections');
  for (const collection of sample.collections) {
    if (!collection || !/^[A-Za-z0-9_-]{1,80}$/.test(collection.id) || !/^[A-Za-z0-9_-]{1,80}$/.test(collection.roll)
      || byCollection.has(collection.id) || byRoll.has(collection.roll) || !Number.isSafeInteger(collection.count) || collection.count < 1) {
      throw new Error('Invalid or duplicate public collection');
    }
    byCollection.set(collection.id, collection);
    byRoll.set(collection.roll, collection);
  }
  const published = new Map(), rollIds = new Set();
  let total = 0;
  for (const row of rolls) {
    const roll = String(row.roll_number);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(roll) || rollIds.has(roll) || !Number.isSafeInteger(row.count) || row.count < 1) {
      throw new Error('Invalid or duplicate published roll');
    }
    rollIds.add(roll);
    total += row.count;
    const page = pageData(await boundedText(resolve(publicDirectory, 'roll', roll, 'index.html')), '__PAGE_DATA__');
    if (String(page.roll_number) !== roll || page.count !== row.count || !Array.isArray(page.images) || page.images.length !== row.count) {
      throw new Error(`Published photo inventory differs for roll ${roll}`);
    }
    let included = 0;
    for (const image of page.images) {
      if (!Number.isSafeInteger(image.image_id) || image.image_id <= 0 || published.has(image.image_id)) {
        throw new Error('Invalid or duplicate published photo ID');
      }
      published.set(image.image_id, {roll, image});
      if (!excluded.has(image.image_id)) included++;
    }
    const collection = byRoll.get(roll);
    if (included ? collection?.count !== included : collection !== undefined) {
      throw new Error(`Exported collection count differs for roll ${roll}`);
    }
  }
  if (total !== audit.publishedPhotos || [...byRoll.keys()].some(roll => !rollIds.has(roll))) {
    throw new Error('Public archive inventory differs from the exported manifest');
  }
  const expectedIds = new Set([...published.keys()].filter(id => !excluded.has(id)));
  if (photos.length !== expectedIds.size) throw new Error('The search catalog must contain every published, non-skipped photo');
  for (const photo of photos) {
    const source = published.get(photo.id), collection = byCollection.get(photo.collectionId);
    if (!expectedIds.has(photo.id) || !source || collection?.roll !== source.roll || source.image.image_url !== photo.imageBase + '/original.jpg') {
      throw new Error(`Photo ${photo.id} is not published in this collection with this image URL`);
    }
    const description = cleanText(source.image.description) || cleanText(source.image.short_description);
    if (photo.description !== description) throw new Error(`Photo ${photo.id} description differs from its public page; regenerate the manifest`);
  }
  return photos;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/sync-search.mjs [--local | --remote]\nWithout a target, validate and generate data/search-catalog.sql only. Apply community migrations first.');
    return;
  }
  if (args.length > 1 || args.some(arg => !['--local', '--remote'].includes(arg))) {
    throw new Error('Choose at most one explicit target: --local or --remote');
  }
  const sample = JSON.parse(await boundedText(resolve(root, 'data/sample.json'), 20_000_000));
  const photos = await validatePublishedManifest(sample);
  const sql = buildSearchCatalogSql(photos);
  const output = resolve(root, 'data/search-catalog.sql');
  await mkdir(dirname(output), {recursive: true});
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, sql, 'utf8');
  await rename(temporary, output);
  console.log(JSON.stringify({photos: photos.length, bytes: Buffer.byteLength(sql), output, target: args[0]?.slice(2) ?? 'generate-only'}));
  if (!args.length) return;
  const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  await stat(wrangler); // Use only the installed CLI; never download a tool implicitly.
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'COMMUNITY', args[0], '--file', output], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Search catalog import failed (${result.signal ?? result.status}); the active catalog is published atomically`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
