// Base URL of the CallCost backend API (the Express server that exposes
// /api/event-cost).
//
// Defaults to localhost for local development. To point the built extension at
// a deployed backend, set VITE_SERVER_URL in apps/extension/.env (copy it from
// .env.example). Vite bakes the value in at build time. The same variable also
// drives the backend entry in host_permissions (manifest.config.ts), so the
// service worker is allowed to reach whichever origin you configure.
const DEFAULT_SERVER_URL = "http://localhost:3000";

export const SERVER_URL = (
  import.meta.env.VITE_SERVER_URL?.trim() || DEFAULT_SERVER_URL
).replace(/\/+$/, "");
