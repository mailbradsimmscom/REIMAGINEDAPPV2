import listEndpoints from "express-list-endpoints";

// Adjust this path if your app file is in a different place.
// `app.js` must export the configured Express app WITHOUT calling app.listen.
import app from "../src/index.js";

const endpoints = listEndpoints(app).sort((a, b) =>
  a.path.localeCompare(b.path)
);

const header = "| Method | Path | Middlewares |\n|---|---|---|";
const lines = endpoints.map(
  r =>
    `| ${r.methods.join(", ")} | \`${r.path}\` | ${
      r.middlewares?.join(", ") || ""
    } |`
);

const mdx = `# Express Routes

> Auto-generated via \`express-list-endpoints\`.

${[header, ...lines].join("\n")}
`;

process.stdout.write(mdx);
