import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },

      // adapter-node, not adapter-auto: this deploys as a plain Node
      // process (Render), which adapter-auto doesn't zero-config-detect
      // (it only recognizes Vercel/Netlify/Cloudflare/Azure SWA).
      adapter: adapter(),
    }),
  ],
});
