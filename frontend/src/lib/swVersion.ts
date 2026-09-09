// Build-time injected by the swVersionVirtual plugin in vite.config.ts —
// reads the VERSION constant from public/sw.js so the app always knows which
// service-worker version its bundle was built against.
// (Ambient declaration lives in src/vite-env.d.ts, alongside the other
// virtual-module declarations.)
export { buildTimeSwVersion } from 'virtual:sw-version';
