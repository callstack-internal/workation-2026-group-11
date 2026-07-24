import { defineManifest } from "@crxjs/vite-plugin";

// The server origin the extension is allowed to talk to.
// Update this (and rebuild) when you deploy the server somewhere else.
const SERVER_ORIGIN = "http://localhost:3000/*";

export default defineManifest({
  manifest_version: 3,
  name: "Workation Extension",
  version: "0.0.0",
  description: "Chrome extension that connects to the Workation server.",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Workation",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
    },
  ],
  permissions: ["storage"],
  host_permissions: [SERVER_ORIGIN],
});
