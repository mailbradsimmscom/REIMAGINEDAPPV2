// scripts/crawl-codebase.mjs
import fg from "fast-glob";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "acorn";
import * as acornWalk from "acorn-walk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..", "src");
const OUTPUT_DIR = path.join(__dirname, "..", "docs", "auto", "code");

await mkdir(OUTPUT_DIR, { recursive: true });

const files = await fg(["src/**/*.js"], { dot: false });

for (const file of files) {
  const fullPath = path.join(__dirname, "..", file);
  const content = await readFile(fullPath, "utf-8");

  let ast;
  try {
    ast = parse(content, { sourceType: "module", ecmaVersion: "latest" });
  } catch (err) {
    console.error("Failed to parse", file);
    continue;
  }

  const imports = [];
  const exports = [];
  const expressRoutes = [];

  acornWalk.simple(ast, {
    ImportDeclaration(node) {
      imports.push(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (node.declaration?.declarations) {
        node.declaration.declarations.forEach(d => exports.push(d.id.name));
      }
    },
    ExportDefaultDeclaration(node) {
      exports.push("default");
    },
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type === "MemberExpression") {
        const object = callee.object.name;
        const method = callee.property.name;
        if (["get", "post", "put", "delete", "use"].includes(method)) {
          expressRoutes.push(`${method.toUpperCase()} ${node.arguments[0]?.value}`);
        }
      }
    }
  });

  const moduleName = path.basename(file);
  const mdx = `# \`${moduleName}\`

- **Path**: \`${file}\`
- **Exports**: ${exports.join(", ") || "None"}
- **Imports**:
${imports.map(i => `  - \`${i}\``).join("\n") || "  - None"}

## Express Routes
${expressRoutes.length ? expressRoutes.map(r => `- ${r}`).join("\n") : "_None detected_"}

## Raw Content

\`\`\`js
${content.slice(0, 1000)}${content.length > 1000 ? "\n..." : ""}
\`\`\`
`;

  const outputFile = path.join(OUTPUT_DIR, `${moduleName.replace(/\.js$/, "")}.mdx`);
  await writeFile(outputFile, mdx);
  console.log("📄 Wrote:", outputFile);
}

console.log("✅ Crawl complete. Docs written to", OUTPUT_DIR);
