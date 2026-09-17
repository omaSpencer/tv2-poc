import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = new URL('../dist/assets/', import.meta.url);
const budgets = { '.js': 800 * 1024, '.css': 64 * 1024 };
const totals = { '.js': 0, '.css': 0 };
let largestJavaScript = { path: '', bytes: 0 };

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    const extension = extname(name);
    if (!(extension in totals)) continue;
    totals[extension] += stat.size;
    if (extension === '.js' && stat.size > largestJavaScript.bytes) {
      largestJavaScript = { path: relative(new URL('../dist/', import.meta.url).pathname, path), bytes: stat.size };
    }
  }
}

walk(root.pathname);
for (const extension of Object.keys(totals)) {
  if (totals[extension] > budgets[extension]) {
    throw new Error(`Bundle budget exceeded for ${extension}: ${totals[extension]} > ${budgets[extension]} bytes.`);
  }
}

console.log(JSON.stringify({
  event: 'bundle_baseline',
  javascriptBytes: totals['.js'],
  cssBytes: totals['.css'],
  largestJavaScript,
  budgets,
}));
