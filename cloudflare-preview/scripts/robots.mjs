import assert from 'node:assert/strict';

// Validate the archive's generic crawler policy, including Cloudflare's managed
// groups. Named crawler restrictions do not apply to the wildcard user agent.
export function checkPublicRobots(text, canonicalOrigin) {
  const groups = [], sitemaps = [];
  let current;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent' && value) {
      // Consecutive agent lines name a shared group. A new agent after any
      // Allow/Disallow rule starts the next group; comments/blank lines do not.
      if (!current || current.rules.length) {
        current = {agents: [], rules: []};
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && current) {
      current.rules.push({field, value});
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }
  const generic = groups.filter(group => group.agents.includes('*'));
  assert.ok(generic.length, 'robots.txt is missing its generic User-agent: * policy');
  const rules = generic.flatMap(group => group.rules);
  assert.ok(!rules.some(rule => rule.field === 'disallow' && /^\/\**\$?$/.test(rule.value)),
    'robots.txt blocks the public root in a generic crawler group');
  assert.ok(rules.some(rule => rule.field === 'disallow' && ['/api/', '/api/*'].includes(rule.value)),
    'robots.txt must disallow /api/ in a generic crawler group');
  assert.ok(sitemaps.includes(`${canonicalOrigin}/sitemap.xml`),
    'robots.txt must advertise the production sitemap');
  return {genericGroups: generic.length, namedCrawlerGroups: groups.length - generic.length};
}
