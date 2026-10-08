import { configurationKey, configureCollector } from './config.ts';

// Cache trusted configuration and verifier keys, never request data or DB bindings.
let cached: { key: string; worker: ReturnType<typeof configureCollector> } | undefined;
function configured(env: CollectorEnv) {
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function')
    throw new TypeError('Missing collector DB binding');
  const key = configurationKey(env);
  if (!cached || cached.key !== key) cached = { key, worker: configureCollector(env) };
  return cached.worker;
}
export default {
  fetch(request, env) { return configured(env).fetch(request, env); },
  scheduled(controller, env) { return configured(env).scheduled(controller, env); },
} satisfies ExportedHandler<CollectorEnv>;
