import { defineManifest } from "@crxjs/vite-plugin";

/**
 * Builds the manifest, injecting the OAuth client ID from the environment.
 * `env` comes from Vite's loadEnv (see vite.config.ts), which reads .env files.
 */
export function buildManifest(env: Record<string, string>) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID is not set. Copy apps/extension/.env.example to " +
        "apps/extension/.env and fill in the value."
    );
  }

  // Backend origin the service worker is allowed to call. Derived from the same
  // VITE_SERVER_URL that src/config.ts reads (defaults to localhost) so the two
  // never drift. Only the origin matters for host_permissions.
  const DEFAULT_SERVER_URL = "http://localhost:3000";
  const serverUrl =
    (env.VITE_SERVER_URL || "").trim() || DEFAULT_SERVER_URL;
  let serverOrigin: string;
  try {
    serverOrigin = new URL(serverUrl).origin;
  } catch {
    throw new Error(
      `Invalid VITE_SERVER_URL: "${serverUrl}". It must be an absolute URL ` +
        "like http://localhost:3000 or https://api.example.com."
    );
  }

  return defineManifest({
    manifest_version: 3,
    name: "CallCost",
    version: "0.1.0",
    description:
      "Keep an eye on the cost of your meetings. Baseline UI — Google Meet cost tracking coming soon.",
    // Pinned public key → stable extension ID (nblafpggejpkjeelebiigcdghkceknea)
    // across every machine/path. Required so the Google OAuth client (bound to
    // that ID) works for the whole team, not just whoever first loaded it.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuygbMeWEn9ai/oZ82ZSHSp6ISJUUruydcLDsp5HISXX6nTK1uV21YAao/ypaVtO5rFzTLI74p54mCSHdfdynsHAjBur54a/Kr3poOG/5b5Feak692zxOiyO/Lg8HqrVru9rtJXh7nYcfGmY87BlIRiRHJXrpGY0oBQKq1dIJ0IlQE1gDrL+pYlZ0TzOrqnv2oekY65d5PpXdKTbw30jX+9rF0kxQlWfCxXxhJ+CnyQwSR8hZ/IEFO8Dn/oRiwMDapNqEtOB7KYvk/t5CbuJua/8JiOtbYoewlNuqjTr5ZIes1ZVWIj9AxnJFFcABnxxdhm4zwWxhrFz4vdpMRUfhCwIDAQAB",
    action: {
      default_popup: "src/popup/index.html",
      default_title: "CallCost",
      default_icon: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png",
      },
    },
    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
    permissions: ["storage", "identity"],
    host_permissions: [
      "https://www.googleapis.com/*",
      // CallCost backend — derived from VITE_SERVER_URL (see .env.example),
      // defaulting to http://localhost:3000. src/config.ts reads the same var.
      `${serverOrigin}/*`,
    ],
    background: {
      service_worker: "src/background.ts",
      type: "module",
    },
    content_scripts: [
      {
        // Data: reads attendees + scheduled duration via the Calendar API.
        matches: ["https://calendar.google.com/*"],
        js: ["src/content/calendar.ts"],
        run_at: "document_idle",
      },
      {
        // UI: injects the estimated-cost row into the event dialog.
        matches: ["https://calendar.google.com/*"],
        js: ["src/content/content.ts"],
        run_at: "document_idle",
      },
    ],
    oauth2: {
      client_id: clientId,
      scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    },
  });
}
