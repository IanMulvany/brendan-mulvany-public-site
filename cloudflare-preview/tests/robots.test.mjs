import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkPublicRobots} from '../scripts/robots.mjs';

const apex = 'https://brendan-mulvany-photography.com';
// Same grouping as production's Cloudflare-managed prefix, without copying
// its explanatory preamble. The site's own policy follows the managed block.
const managed = `User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

${['Amazonbot', 'Applebot-Extended', 'Bytespider', 'CCBot', 'ClaudeBot', 'CloudflareBrowserRenderingCrawler', 'Google-Extended', 'GPTBot', 'meta-externalagent']
  .map(agent => `User-agent: ${agent}\nDisallow: /\n`).join('\n')}
# END Cloudflare Managed Content
`;
const site = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /account/
Disallow: /admin/
Disallow: /search/
Disallow: /newsletter/
Disallow: /homepage-fragments.json

Sitemap: ${apex}/sitemap.xml
`;

test('Cloudflare named AI-crawler blocks coexist with the public wildcard policy', () => {
  assert.deepEqual(checkPublicRobots(managed + site, apex), {genericGroups: 2, namedCrawlerGroups: 9});
  assert.deepEqual(checkPublicRobots(site, apex), {genericGroups: 1, namedCrawlerGroups: 0});
});

test('a root block in either wildcard group fails even when managed content allows the root', () => {
  for (const blocked of ['/', '/*', '/**', '/$']) {
    assert.throws(() => checkPublicRobots(managed + site.replace('Disallow: /api/', `Disallow: /api/\nDisallow: ${blocked}`), apex), /blocks the public root/);
  }
  assert.throws(() => checkPublicRobots(managed.replace('Allow: /', 'Disallow: /') + site, apex), /blocks the public root/);
});

test('named-only API restrictions do not satisfy the generic policy, and the production sitemap remains required', () => {
  const onlyNamedApi = managed + site.replace('Disallow: /api/', '') + '\nUser-agent: PrivateBot\nDisallow: /api/\n';
  assert.throws(() => checkPublicRobots(onlyNamedApi, apex), /disallow \/api\/ in a generic/);
  assert.throws(() => checkPublicRobots(site.replaceAll(apex, 'https://new.brendan-mulvany-photography.com'), apex), /production sitemap/);
  assert.throws(() => checkPublicRobots('User-agent: NamedBot\nDisallow: /\n', apex), /generic User-agent/);
});

test('shared agent groups, repeated wildcards, comments, empty directives and case-insensitive records are parsed consistently', () => {
  const text = `\uFEFFuSeR-aGeNt: SharedBot\r
USER-AGENT: * # applies to all generic crawlers too\r
Content-Signal: search=yes\r
Allow: /\r
Disallow: # empty does not block crawling\r
Disallow: /api/ # private routes\r
\r
User-agent: SpecificBot\r
Disallow: /\r
SITEMAP: ${apex}/sitemap.xml # global metadata\r
`;
  assert.deepEqual(checkPublicRobots(text, apex), {genericGroups: 1, namedCrawlerGroups: 1});
  assert.throws(() => checkPublicRobots(text.replace('Allow: /', 'Disallow: /'), apex), /blocks the public root/);
});
