import {readFile, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

// Sequential samples keep load low and preserve the distinction between the
// first observed response and later warm responses. No synthetic cache busters.
const target = process.argv[2] || 'http://localhost:8787';
const baseline = process.argv[3] || 'https://www.brendan-mulvany-photography.com';
const samples = Number(process.env.SAMPLES || 7);
if (!Number.isInteger(samples) || samples < 2 || samples > 20) throw new Error('SAMPLES must be between 2 and 20');
const manifest = JSON.parse(await readFile(new URL('../data/sample.json', import.meta.url), 'utf8'));
const paths = [['home', '/'], ['collection', '/collections/popes-visit/'],
  ['search-pope', '/api/search?q=pope'], ['search-football', '/api/search?q=football'],
  ['search-year', '/api/search?q=1979'], ['search-multiword', '/api/search?q=pope+ireland']];
const baselinePaths = [['home', '/'], ['collection', '/roll/3071/index.html'],
  ['search-pope', '/api/public/search?q=pope&limit=24'],
  ['search-football', '/api/public/search?q=football&limit=24'],
  ['search-year', '/api/public/search?q=1979&limit=24'],
  ['search-multiword', '/api/public/search?q=pope+ireland&limit=24']];
const round = value => Math.round(value * 10) / 10;
const all = [];
const platforms = [['preview', target, paths]];
if (process.env.PREVIEW_ONLY !== '1') platforms.push(['vercel', baseline, baselinePaths]);
for (const [platform, origin, endpoints] of platforms) {
  for (const [name,path] of endpoints) {
    const runs=[];
    for (let i=0; i<samples; i++) {
      const start=performance.now();
      try {
        const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(20000)});
        const ttfb=performance.now()-start;
        const text=await response.text();
        runs.push({status:response.status,ttfbMs:round(ttfb),totalMs:round(performance.now()-start),
          decodedBytes:Buffer.byteLength(text),cache:response.headers.get('x-search-cache')||response.headers.get('x-vercel-cache'),
          serverTiming:response.headers.get('server-timing')});
      } catch (error) { runs.push({error:error.message}); }
    }
    const values=runs.slice(1).filter(r=>r.status===200).map(r=>r.totalMs).sort((a,b)=>a-b);
    const result={platform,name,url:new URL(path,origin).href,first:runs[0],
      warmMedianMs:values.length ? (values[Math.floor((values.length - 1)/2)] + values[Math.floor(values.length/2)])/2 : null,
      warmP95Ms:values.length ? values[Math.ceil(values.length*.95)-1] : null,runs};
    all.push(result);
    console.log(JSON.stringify({...result,runs:undefined}));
  }
}
const output={measuredAt:new Date().toISOString(),samplesPerEndpoint:samples,
  previewPhotos:manifest.photos.length,previewCollections:manifest.collections.length,
  methodology:'One client, sequential requests, no throttling; first is not a guaranteed cold start. Warm statistics exclude first. Local preview results are not deployed edge latency. Search semantics and content differences prevent causal hosting comparison.',results:all};
await writeFile(process.env.OUTPUT_FILE || 'data/benchmark.json',JSON.stringify(output,null,2)+'\n');
