import assert from 'node:assert/strict';
import {test} from 'node:test';
import redirects from '../src/redirects.ts';

const apex = 'https://brendan-mulvany-photography.com';
const hosts = ['www.brendan-mulvany-photography.com', 'new.brendan-mulvany-photography.com'];
const query = '?q=Sean+O%27Brien&q=%2F%2Fevil.example&returnTo=%2Fimage%2F123%2F%23community&literal=%252F&empty=';

test('both former hosts permanently redirect GET and HEAD to the fixed HTTPS apex with path and escaped query unchanged', async () => {
  for (const host of hosts) for (const scheme of ['http:', 'https:']) for (const method of ['GET', 'HEAD']) {
    for (const path of ['/', '/image/123/', '/photos/123/index.html', '/roll/R-9002/page/2/', '/search.html',
      '//evil.example/path', '/%2F%2Fevil.example/%5Cfolder', '/image/%23community/']) {
      const request = new Request(`${scheme}//${host}${path}${query}`, {method, headers: {
        'x-forwarded-host': 'attacker.example', forwarded: 'host=attacker.example;proto=http',
      }});
      const response = await redirects.fetch(request);
      assert.equal(response.status, 301, request.url);
      assert.equal(response.headers.get('location'), `${apex}${new URL(request.url).pathname}${query}`, request.url);
      const destination = new URL(response.headers.get('location'));
      assert.equal(destination.origin, apex);
      assert.equal(destination.username, '');
      assert.equal(destination.password, '');
      assert.equal(destination.hash, '');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(await response.text(), '');
    }
  }
});

test('redirect hosts reject writes and CORS preflights without forwarding credentials or weakening CSRF checks', async () => {
  for (const host of hosts) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const origin of [apex, `https://${host}`, 'https://attacker.example', 'null']) {
      const response = await redirects.fetch(new Request(`https://${host}/api/photos/123/comments?private=do-not-reflect`, {
        method, headers: {origin, cookie: '__Host-bm_session=private-session', 'content-type': 'application/json',
          'access-control-request-method': 'POST'},
        body: method === 'OPTIONS' ? undefined : JSON.stringify({body: 'Private submitted content'}),
      }));
      assert.ok([403, 405].includes(response.status), `${host} ${method} ${origin}`);
      assert.equal(response.headers.get('location'), null, 'Unsafe requests must not become redirected GET requests');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      if (response.status === 405) assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.doesNotMatch(await response.text(), /private-session|Private submitted content|do-not-reflect/);
    }
  }
});

test('unknown and apex hostnames do not redirect, preventing hostname confusion and self-redirect loops', async () => {
  for (const host of ['brendan-mulvany-photography.com', 'attacker.example', 'new.brendan-mulvany-photography.com.attacker.example',
    'www-brendan-mulvany-photography.com', 'new.brendan-mulvany-photography.com.']) {
    const response = await redirects.fetch(new Request(`https://${host}/image/123/`));
    assert.equal(response.status, 404, host);
    assert.equal(response.headers.get('location'), null, host);
    assert.equal(response.headers.get('set-cookie'), null);
    await response.text();
  }
});

test('nonstandard source ports cannot reach the destination and redirect responses leave saved fragments to the browser', async () => {
  const response = await redirects.fetch(new Request(`https://${hosts[0]}:8443/image/123/${query}`));
  const destination = new URL(response.headers.get('location'));
  assert.equal(destination.origin, apex);
  assert.equal(destination.port, '');
  assert.equal(destination.search, query);
  assert.equal(destination.hash, '');
  // The browser never sends #community in its HTTP request. A fragment-free
  // Location preserves its inheritance; actual browser navigation is checked
  // separately during deployment validation.
  const savedUrl = new URL(`https://${hosts[1]}/photos/123/#community`);
  savedUrl.hash = '';
  const savedResponse = await redirects.fetch(new Request(savedUrl));
  assert.equal(savedResponse.headers.get('location'), apex + '/photos/123/');
  assert.ok(!savedResponse.headers.get('location').includes('#'));
});
