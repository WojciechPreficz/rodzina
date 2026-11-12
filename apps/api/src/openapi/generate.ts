import { writeFile } from 'node:fs/promises';
import { generateOpenApi } from './document.js';

const document = await generateOpenApi();
const output = new URL('../../../../docs/openapi.json', import.meta.url);
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
const operations = Object.values(document.paths).reduce((total, path) => total + Object.keys(path).length, 0);
console.log(`Zapisano docs/openapi.json (${operations} operacji).`);
