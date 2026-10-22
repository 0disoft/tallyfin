export default {
  /** @param {Request} request @param {AdminEnv} env */
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    // Reserve API routes before assets, including navigation requests accepting HTML.
    if (pathname === "/v1" || pathname.startsWith("/v1/")) {
      if (!env.COLLECTOR || typeof env.COLLECTOR.fetch !== "function") return unavailable(request);
      try {
        // Stream once; never retry writes or follow redirects with the caller's bearer token.
        const upstream = await env.COLLECTOR.fetch(new Request(request, { redirect: "manual" }));
        const response = new Response(upstream.body, upstream);
        response.headers.set("Cache-Control", "no-store");
        return response;
      } catch {
        console.error(JSON.stringify({ code: "admin_api_unavailable" }));
        return unavailable(request);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method) || pathname.startsWith("/assets/")) {
      return response;
    }

    try {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/index.html";
      indexUrl.search = "";
      return env.ASSETS.fetch(new Request(indexUrl, request));
    } finally {
      // This 404 is discarded. The returned fallback stream belongs to the caller.
      try { void response.body?.cancel().catch(() => {}); } catch { /* Preserve the fallback outcome. */ }
    }
  },
};

/** @param {Request} request */
function unavailable(request) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: { code: "admin_api_unavailable" } }), {
    status: 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" },
  });
}
