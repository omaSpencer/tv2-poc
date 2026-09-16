import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const compilerMarker = 'react.memo_cache_sentinel';

let assetNames;

try {
  assetNames = await readdir(assetsDirectory);
} catch {
  throw new Error('A React Compiler ellenőrzése előtt futtasd az npm run build parancsot.');
}

const javascriptAssets = assetNames.filter((assetName) => assetName.endsWith('.js'));
const compilerOutputFound = (
  await Promise.all(
    javascriptAssets.map((assetName) => readFile(join(assetsDirectory.pathname, assetName), 'utf8')),
  )
).some((source) => source.includes(compilerMarker));

if (!compilerOutputFound) {
  throw new Error(
    'A production build nem tartalmaz React Compiler memoizációs kimenetet. Ellenőrizd a Vite compiler konfigurációját.',
  );
}

console.log('React Compiler ellenőrizve: a production build automatikus memoizációt tartalmaz.');
