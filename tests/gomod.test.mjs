// Tokenizes go.mod and go.work lines with the real TextMate engine; see go.test.mjs for the notation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compact, loadGrammar, tokenize } from '../tools/orca-tokens.mjs';

const path = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const grammar = await loadGrammar(path('syntaxes/gomod.tmLanguage.json'));

const render = (line) =>
  compact(line.tokens)
    .map(([text, type]) => (type ? `${text}‹${type}›` : text))
    .join(' ');
const last = (source) => render(tokenize(grammar, source).at(-1));

test('single-line directives', () => {
  assert.equal(last('module github.com/example/store'), 'module‹keyword› github.com/example/store‹string›');
  assert.equal(last('go 1.24.0'), 'go‹keyword› 1.24.0‹number›');
  assert.equal(last('toolchain go1.24.3'), 'toolchain‹keyword› go1.24.3‹number›');
  assert.equal(
    last('require golang.org/x/sync v0.10.0 // indirect'),
    'require‹keyword› golang.org/x/sync‹string› v0.10.0‹number› // indirect‹comment›',
  );
  assert.equal(
    last('replace example.com/old v1.0.0 => ../fork'),
    'replace‹keyword› example.com/old‹string› v1.0.0‹number› =>‹operator› ../fork‹string›',
  );
  assert.equal(last('godebug default=go1.21'), 'godebug‹keyword› default‹identifier› =‹operator› go1.21‹constant›');
});

test('directive blocks', () => {
  assert.equal(last('require ('), 'require‹keyword› (‹delimiter›');
  assert.equal(
    last('require (\n\tmodernc.org/sqlite v1.34.4-0.20241201000000-abcdef123456'),
    'modernc.org/sqlite‹string› v1.34.4-0.20241201000000-abcdef123456‹number›',
  );
  assert.equal(
    last('require (\n\texample.com/legacy/v2 v2.0.0+incompatible'),
    'example.com/legacy/v2‹string› v2.0.0+incompatible‹number›',
  );
  assert.equal(
    last('retract (\n\t[v1.1.0, v1.1.5]'),
    '[‹delimiter› v1.1.0‹number› ,‹delimiter› v1.1.5‹number› ]‹delimiter›',
  );
  assert.equal(last('use (\n\t./cmd\n)'), ')‹delimiter›');
});

test('a version inside a module path is part of the path', () => {
  assert.equal(last('require gopkg.in/yaml.v3 v3.0.1'), 'require‹keyword› gopkg.in/yaml.v3‹string› v3.0.1‹number›');
  assert.equal(last('use ./v1.2.3/tool'), 'use‹keyword› ./v1.2.3/tool‹string›');
});

test('a directive name is a keyword only at the start of a line', () => {
  assert.equal(last('require example.com/go/tool v1.0.0'), 'require‹keyword› example.com/go/tool‹string› v1.0.0‹number›');
  assert.equal(last('use ./go'), 'use‹keyword› ./go‹string›');
});

test('the fixture has no line left without a colour', () => {
  for (const line of tokenize(grammar, readFileSync(path('examples/gomod/go.mod'), 'utf8'))) {
    if (!line.text.trim()) continue;
    assert.ok(line.tokens.every((token) => !token.text.trim() || token.type), line.text);
  }
});
