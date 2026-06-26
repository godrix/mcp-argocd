import { cpSync, mkdirSync } from "node:fs";

mkdirSync("build/widgets", { recursive: true });
cpSync(
  "src/widgets/app-observability.html",
  "build/widgets/app-observability.html"
);
console.log("Copied widgets to build/widgets/");
