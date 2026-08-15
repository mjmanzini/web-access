/**
 * Force every request through the Access-protected custom domain.
 *
 * Cloudflare Access policies attach to hostnames in the zone, so they guard
 * home.mjmanziniholdings.co.za but not the Pages-assigned *.pages.dev hosts
 * (the project URL and every per-deployment preview URL). Without this, those
 * URLs serve the dashboard while skipping the email/PIN gate entirely.
 *
 * Anything arriving on a *.pages.dev host is redirected to the canonical
 * hostname, preserving path and query so deep links still land correctly.
 * Requests already on the custom domain fall through to normal asset serving,
 * which keeps _redirects (SPA fallback) and _headers applied.
 */
const CANONICAL_HOST = 'home.mjmanziniholdings.co.za';

export const onRequest = async (context) => {
  const url = new URL(context.request.url);

  if (url.hostname.endsWith('.pages.dev')) {
    url.hostname = CANONICAL_HOST;
    url.port = '';
    return Response.redirect(url.toString(), 302);
  }

  return context.next();
};
