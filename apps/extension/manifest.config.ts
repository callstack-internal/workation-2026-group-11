import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "CallCost",
  version: "0.1.0",
  description:
    "Keep an eye on the cost of your meetings. Baseline UI — Google Meet cost tracking coming soon.",
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
  permissions: ["storage"],
  content_scripts: [
    {
      matches: ["https://calendar.google.com/*"],
      js: ["src/content/content.ts"],
      run_at: "document_idle",
    },
  ],
});
