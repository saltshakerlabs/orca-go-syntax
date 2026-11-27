#!/usr/bin/env node
// Prints how Orca would color a file: each token followed by its token type.
//   node tools/tokens.mjs <file> [--grammar <path>]... [--scopes] [--lines 10-40]
// Untyped tokens (default foreground) print bare; typed ones print as text‹type›.
import { readFileSync } from 'node:fs';
import { loadGrammar, tokenize } from './orca-tokens.mjs';

const args = process.argv.slice(2);
const grammars = [];
let file;
let showScopes = false;
let range = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--grammar') grammars.push(args[(i += 1)]);
  else if (args[i] === '--scopes') showScopes = true;
  else if (args[i] === '--lines') range = args[(i += 1)].split('-').map(Number);
  else file = args[i];
}
if (!file) {
  console.error('usage: tokens.mjs <file> [--grammar <path>]... [--scopes] [--lines from-to]');
  process.exit(2);
}
if (grammars.length === 0) {
  grammars.push(new URL('../syntaxes/go.tmLanguage.json', import.meta.url).pathname);
}

const grammar = await loadGrammar(...grammars);
const lines = tokenize(grammar, readFileSync(file, 'utf8'));
let slowest = { ms: 0, number: 0 };
lines.forEach((line, index) => {
  const number = index + 1;
  if (line.ms > slowest.ms) slowest = { ms: line.ms, number };
  if (range && (number < range[0] || number > (range[1] ?? range[0]))) return;
  if (showScopes) {
    console.log(`${number}: ${line.text}`);
    for (const token of line.tokens) {
      if (token.text.trim()) {
        console.log(`    ${JSON.stringify(token.text)} ‹${token.type}› ${token.scopes.slice(1).join(' ')}`);
      }
    }
    return;
  }
  const rendered = line.tokens
    .map((token) => (token.type && token.text.trim() ? `${token.text}‹${token.type}›` : token.text))
    .join('');
  console.log(`${String(number).padStart(4)} ${line.plain ? '[PLAIN] ' : ''}${rendered}`);
});
console.error(`slowest line: ${slowest.number} (${slowest.ms.toFixed(2)} ms)`);
