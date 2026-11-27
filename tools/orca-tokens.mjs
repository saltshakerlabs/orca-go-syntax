// Tokenizes text the way Orca's plugin grammar worker does: vscode-textmate on Oniguruma, then
// each token's scope stack is flattened to one of Orca's 24 token types. The tables below are
// copied from Orca 1.4.277 (plugin-grammar.worker); a token Orca gives no type renders in the
// editor's default foreground, which this module reports as `null`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const require = createRequire(import.meta.url);

export const TOKEN_TYPES = [
  'comment', 'string', 'regexp', 'number', 'constant', 'keyword', 'keyword.flow', 'type',
  'variable.parameter', 'variable.predefined', 'tag', 'attribute.name', 'attribute.value',
  'delimiter', 'annotation', 'invalid', 'emphasis', 'strong', 'function', 'identifier',
  'operator', 'keyword.heading', 'string.link', 'string.raw',
];

// Order matters: the first prefix that matches a scope wins.
const SCOPE_TO_TYPE = [
  ['comment', 'comment'], ['string.regexp', 'regexp'], ['string', 'string'],
  ['constant.numeric', 'number'], ['constant.language', 'keyword'],
  ['constant.character.escape', 'string'], ['constant', 'constant'],
  ['support.constant', 'constant'], ['keyword.control', 'keyword.flow'],
  ['keyword.operator', 'operator'], ['keyword', 'keyword'], ['storage', 'keyword'],
  ['variable.language', 'keyword'], ['variable.parameter', 'variable.parameter'],
  ['support.variable', 'variable.predefined'], ['variable', 'identifier'],
  ['entity.name.function', 'function'], ['support.function', 'function'],
  ['entity.name.type', 'type'], ['entity.name.class', 'type'], ['entity.name.namespace', 'type'],
  ['entity.other.inherited-class', 'type'], ['support.type', 'type'], ['support.class', 'type'],
  ['entity.name.tag', 'tag'], ['entity.other.attribute-name', 'attribute.name'],
  ['meta.attribute-value', 'attribute.value'], ['entity.name.decorator', 'annotation'],
  ['meta.decorator', 'annotation'], ['markup.heading', 'keyword.heading'],
  ['markup.bold', 'strong'], ['markup.italic', 'emphasis'], ['markup.raw', 'string.raw'],
  ['markup.inline.raw', 'string.raw'], ['markup.underline.link', 'string.link'],
  ['invalid', 'invalid'],
];

export const LINE_MAX_CHARS = 1000;
export const LINE_BUDGET_MS = 50;
const LINE_ATTEMPTS = 3;

function typeOfScope(scope) {
  for (const [prefix, type] of SCOPE_TO_TYPE) {
    if (scope === prefix || scope.startsWith(`${prefix}.`)) return type;
  }
  return null;
}

/** Innermost scope with a type wins; `punctuation.*` is skipped and falls back to `delimiter`. */
export function typeOfScopes(scopes) {
  let sawPunctuation = false;
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (scopes[i].startsWith('punctuation.')) {
      sawPunctuation = true;
      continue;
    }
    const type = typeOfScope(scopes[i]);
    if (type) return type;
  }
  return sawPunctuation ? 'delimiter' : null;
}

let onigLib;
function loadOniguruma() {
  onigLib ??= oniguruma
    .loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer)
    .then(() => ({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }));
  return onigLib;
}

/** Loads grammar files (the first is the one to tokenize with; the rest resolve its includes). */
export async function loadGrammar(...paths) {
  const grammars = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
  const byScope = new Map(grammars.map((grammar) => [grammar.scopeName, grammar]));
  const registry = new textmate.Registry({
    onigLib: loadOniguruma(),
    loadGrammar: async (scopeName) => byScope.get(scopeName) ?? null,
  });
  return registry.loadGrammar(grammars[0].scopeName);
}

/**
 * Returns one entry per line: `{ text, ms, tokens: [{ text, type, scopes }] }`. Like Orca, stops at
 * the first line that is too long or keeps exceeding the time budget; later lines get `plain: true`.
 */
export function tokenize(grammar, source) {
  const lines = [];
  let state = textmate.INITIAL;
  let stopped = false;
  for (const text of source.split(/\r\n|\r|\n/)) {
    if (stopped || text.length > LINE_MAX_CHARS) {
      stopped = true;
      lines.push({ text, ms: 0, plain: true, tokens: [{ text, type: null, scopes: [] }] });
      continue;
    }
    const started = performance.now();
    let result = grammar.tokenizeLine(text, state, LINE_BUDGET_MS);
    for (let attempt = 1; result.stoppedEarly && attempt < LINE_ATTEMPTS; attempt += 1) {
      result = grammar.tokenizeLine(text, state, LINE_BUDGET_MS);
    }
    const ms = performance.now() - started;
    if (result.stoppedEarly) {
      stopped = true;
      lines.push({ text, ms, plain: true, tokens: [{ text, type: null, scopes: [] }] });
      continue;
    }
    state = result.ruleStack;
    lines.push({
      text,
      ms,
      tokens: result.tokens
        .map((token) => ({
          text: text.slice(token.startIndex, token.endIndex),
          type: typeOfScopes(token.scopes),
          scopes: token.scopes,
        }))
        .filter((token) => token.text.length > 0),
    });
  }
  return lines;
}

/**
 * `[text, type]` pairs for one line of code, whitespace dropped. Comment prose is tokenized word
 * by word, so neighbouring comment tokens are joined back into one.
 */
export function compact(tokens) {
  const out = [];
  let comment = null;
  const flush = () => {
    if (comment?.trim()) out.push([comment.trim(), 'comment']);
    comment = null;
  };
  for (const token of tokens) {
    if (token.type === 'comment') {
      comment = (comment ?? '') + token.text;
      continue;
    }
    flush();
    if (token.text.trim()) out.push([token.text.trim(), token.type]);
  }
  flush();
  return out;
}
