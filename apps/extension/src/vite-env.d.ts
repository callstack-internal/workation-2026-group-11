/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the CallCost backend API. Optional — the extension falls back
   * to http://localhost:3000 when unset. Configure it in apps/extension/.env
   * (see .env.example). Must be VITE_-prefixed so Vite exposes it to runtime
   * code via import.meta.env.
   */
  readonly VITE_SERVER_URL?: string;
}
