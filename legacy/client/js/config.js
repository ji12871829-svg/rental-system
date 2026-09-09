// config.js — runtime API base URL. Point this at the deployed backend in
// production WITHOUT needing a rebuild (there is no build step by design).
//
// The web app now authenticates with httpOnly + SameSite cookies (see
// api.js), which are treated as same-origin credentials by the browser. For a
// TRUE cross-origin deploy (frontend on :5173, backend on :4000) the backend
// must reflect CORS_ORIGIN and the client origin must be 127.0.0.1/localhost
// (same-site) for SameSite=Lax cookies to be attached. Two options:
//   1. Simplest + recommended: serve the static client from the SAME origin
//      as the API (e.g. backend also serves client/static, or a proxy).
//   2. Local dev: keep them on different ports — it still works for
//      localhost (browsers treat localhost ports as same-site) and for a
//      production setup where a reverse proxy puts both behind one hostname.
window.RMS_CONFIG = {
  API_BASE_URL: 'http://localhost:4000/api',
};