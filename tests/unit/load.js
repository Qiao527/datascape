// Reads the committed scan the same way the browser does (storm.json plus the
// deflated storm.bin), without fetch.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createStormData } from '../../src/storm/data.js';

const root = new URL('../../', import.meta.url);

export function readStorm() {
  const meta = JSON.parse(readFileSync(new URL('public/data/storm/storm.json', root), 'utf8'));
  const compressed = readFileSync(new URL('public/data/storm/storm.bin', root));
  const raw = inflateSync(compressed);
  const part = ({ offset, length }) => raw.subarray(offset, offset + length);
  const data = createStormData(meta, part(meta.layout.volume), part(meta.layout.low), part(meta.layout.upper));
  return { meta, raw, compressed, data };
}

export const readText = (path) => readFileSync(new URL(path, root), 'utf8');
