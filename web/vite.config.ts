import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Production: the site (Firebase) calls the API Worker on workers.dev
// (VITE_API_BASE_URL in .env.production).
// Local dev: the app calls relative /api/... and Vite forwards it to
// `wrangler dev` on port 8787.
export default defineConfig({
	plugins: [react()],
	server: {
		proxy: {
			"/api": "http://localhost:8787",
		},
	},
});
