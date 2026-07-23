import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const chunkDir = join(process.cwd(), ".next", "static", "chunks");

async function listJavaScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(fullPath);
      if (entry.isFile() && entry.name.endsWith(".js")) return [fullPath];
      return [];
    })
  );

  return files.flat();
}

function replaceNullishAssignment(code) {
  return code.replace(
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\?\?=([^,;})]+)/g,
    "($1??($1=$2))"
  );
}

const files = await listJavaScriptFiles(chunkDir);
let changed = 0;

for (const file of files) {
  const before = await readFile(file, "utf8");
  const after = replaceNullishAssignment(before);
  if (after !== before) {
    await writeFile(file, after);
    changed += 1;
  }
}

console.log(`Legacy browser JS fix: updated ${changed} file(s).`);
