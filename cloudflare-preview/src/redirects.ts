const PUBLIC_ORIGIN = 'https://brendan-mulvany-photography.com';
const aliases = new Set(['www.brendan-mulvany-photography.com', 'new.brendan-mulvany-photography.com']);

// This separate, stateless Worker keeps hostname redirects off the main site's
// static-asset path. It has no database, email, session or secret bindings.
export default {
  async fetch(request: Request): Promise<Response> {
    const source = new URL(request.url);
    const headers = {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'};
    if (!aliases.has(source.hostname)) return new Response('Not found.', {status: 404, headers});
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Open the main archive website before submitting this request.', {
        status: 405, headers: {...headers, allow: 'GET, HEAD'},
      });
    }
    // Assign path/search separately: a path beginning // must never become a
    // protocol-relative destination. Omitting a fragment preserves saved anchors.
    const destination = new URL(PUBLIC_ORIGIN);
    destination.pathname = source.pathname;
    destination.search = source.search;
    return new Response(null, {status: 301, headers: {
      location: destination.href,
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    }});
  },
} satisfies ExportedHandler;
