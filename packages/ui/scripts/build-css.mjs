import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toCssVariables } = require('../dist/index.js');
writeFileSync(new URL('../tokens.css', import.meta.url), toCssVariables());
