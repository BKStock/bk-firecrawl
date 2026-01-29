#!/usr/bin/env node
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const entryPoint = path.join(__dirname, "index.ts");
const outFile = path.join(__dirname, "bundle.generated.ts");
const pasteableFile = path.join(__dirname, "branding-script.pasteable.js");

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      minify: true,
      format: "iife",
      globalName: "__extractBrandDesign",
      target: ["es2020"],
      write: false,
    });

    const bundledCode = result.outputFiles[0].text;

    // Wrap in a self-executing function that returns the result
    const scriptContent = `(function __extractBrandDesign() {
${bundledCode}
return __extractBrandDesign.extractBrandDesign();
})();`;

    // Escape backticks and backslashes for template literal
    const escaped = scriptContent
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${");

    // Generate TypeScript file that exports the script as a const
    const tsContent = `// AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
// Run \`pnpm build:branding\` to regenerate from source modules
// Source: ./index.ts and related modules

export const BRANDING_SCRIPT = \`${escaped}\`;
`;

    fs.writeFileSync(outFile, tsContent, "utf-8");
    console.log(`Branding script built successfully: ${outFile}`);

    // Pasteable file: only in dev mode (raw script for pasting in browser console)
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      const pasteableHeader = `// Paste this entire file into the browser console to run the branding script.
// AUTO-GENERATED - run \`pnpm build:branding\` with NODE_ENV=development to regenerate.

`;
      fs.writeFileSync(pasteableFile, pasteableHeader + scriptContent, "utf-8");
      console.log(`Pasteable script written: ${pasteableFile}`);
    }

    console.log(`Size: ${(scriptContent.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
