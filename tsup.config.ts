import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/tool-selector.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	shims: true,
	banner: {
		js: "#!/usr/bin/env node",
	},
	onSuccess: "chmod +x dist/index.js",
});
