export function collectorOrigin(value = 'http://127.0.0.1:5188') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
    url.search || url.hash || url.pathname !== '/' || url.origin !== value) {
    throw new Error('Collector proxy must use an explicit loopback HTTP origin');
  }
  return url.origin;
}

export function collectorProxy(value) {
  return { '^/v1(?:/|\\?|$)': { target: collectorOrigin(value), changeOrigin: false,
    timeout: 15_000, proxyTimeout: 15_000 } };
}
