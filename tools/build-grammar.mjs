#!/usr/bin/env node
// Builds syntaxes/go.tmLanguage.json from the vendored upstream grammar
// (third_party/go-syntax, github.com/worlpaker/go-syntax, MIT).
//
// Upstream finds Go's structure well; what changes here is which scope each token gets, because
// Orca reduces every scope to one of 24 token types (see tools/orca-tokens.mjs) and a theme colours
// only those. The target is the GoLand colour model:
//
//   type names, builtin types          -> type        (entity.name.type, support.type)
//   function declarations and calls    -> function
//   parameters and receivers, declared -> variable.parameter
//   exported fields, variables, nil    -> identifier  (variable.other.*)
//   constants, true, false, iota       -> constant
//   format verbs and escapes           -> regexp      (string.regexp.*)
//   locals, package names, labels      -> no type: the editor's default foreground
//   names referred to in a comment     -> no type, so they stand out from the prose around them
//
// Run `node tools/build-grammar.mjs` after changing this file or updating third_party/.
import { readFileSync, writeFileSync } from 'node:fs';

const UPSTREAM = new URL('../third_party/go-syntax/go.tmLanguage.json', import.meta.url);
const OUTPUT = new URL('../syntaxes/go.tmLanguage.json', import.meta.url);

// Scope renames, first match wins. An empty replacement drops the scope, so the token keeps the
// scope of the rule around it.
const RENAMES = [
  // Builtin types are types, not keywords.
  [/^storage\.type\.(.+)\.go$/, 'support.type.builtin.$1.go'],
  // Orca types `constant.language` as a keyword. GoLand colours true, false and iota as constants,
  // and nil as the variable it is.
  [/^constant\.language\.null\.go$/, 'variable.other.builtin.nil.go'],
  [/^constant\.language\.(.+)\.go$/, 'support.constant.builtin.$1.go'],
  // Keep every part of a number literal one colour: prefixes, exponents, signs and separators.
  [/^keyword\.other\.unit\.(.+)\.go$/, 'constant.numeric.unit.$1.go'],
  [/^keyword\.operator\.(?:plus|minus)\.exponent\.(.+)\.go$/, 'constant.numeric.exponent.sign.$1.go'],
  [/^punctuation\.separator\.constant\.numeric\.go$/, 'constant.numeric.separator.go'],
  // A rune reads as a string.
  [/^constant\.other\.rune\.go$/, ''],
  // Format verbs and escapes are a small language inside a string. Orca would type
  // `constant.character.escape` as plain string, and `constant` cannot be coloured apart from
  // numbers; Go has no regexp literals, so its `regexp` type is free to carry them.
  [/^constant\.character\.escape\.go$/, 'string.regexp.escape.go'],
  [/^constant\.other\.placeholder\.go$/, 'string.regexp.placeholder.go'],
  // Names that take the default foreground.
  [/^entity\.name\.type\.package\.go$/, 'entity.name.package.go'],
  [/^variable\.other\.import\.go$/, 'entity.name.import.alias.go'],
  [/^variable\.other\.label\.go$/, 'entity.name.label.go'],
  // Declared constants.
  [/^variable\.other\.constant\.go$/, 'constant.other.declaration.go'],
];

// Upstream ends most rules in a catch-all `\w+` leaf. Each is swapped for a rule that looks at the
// identifier itself: Go exports a name by capitalising it, which is all a grammar can know about
// where a name was declared.
const LEAVES = {
  'entity.name.type.go': 'orca_type_name',
  'variable.other.go': 'orca_identifier',
  'variable.other.assignment.go': 'orca_variable',
  'variable.other.property.go': 'orca_field',
};

// Constants of the standard library that code names through their package. A grammar cannot tell
// `time.Second` from a field access, so the common ones are listed.
const STDLIB_CONSTANTS = {
  time: 'Nanosecond|Microsecond|Millisecond|Second|Minute|Hour|Layout|ANSIC|UnixDate|RubyDate|RFC\\w+|Kitchen|Stamp\\w*|DateTime|DateOnly|TimeOnly|January|February|March|April|May|June|July|August|September|October|November|December|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday',
  http: 'Status\\p{Lu}\\w*|Method\\p{Lu}\\w*|Default\\p{Lu}\\w*Bytes|TimeFormat|TrailerPrefix|SameSite\\w+',
  math: 'Pi|E|Phi|Sqrt\\w+|Ln\\w+|Log\\w+|Max\\p{Lu}\\w*|Min\\p{Lu}\\w*|SmallestNonzero\\w+',
  os: 'O_\\w+|Mode\\p{Lu}\\w*|PathSeparator|PathListSeparator|DevNull|SEEK_\\w+',
  io: 'Seek\\p{Lu}\\w*',
  fs: 'Mode\\p{Lu}\\w*',
  sql: 'Level\\p{Lu}\\w*',
  slog: 'Level\\p{Lu}\\w*|\\w+Key',
  syscall: 'SIG\\w+|E[A-Z]+|O_\\w+',
};

// Words that open a comment without naming what it documents.
const NOT_A_SUBJECT =
  'A|An|The|This|That|These|Those|It|Its|If|In|On|At|As|By|Of|Or|And|But|For|To|From|With|Without|We|You|When|While|Once|After|Before|Because|Since|Each|Every|All|Any|Some|No|Not|Only|Both|Most|Many|One|Two|There|Here|See|Note|NOTE|TODO|FIXME|BUG|XXX|HACK|Deprecated|Package|Copyright|Code|Use|Usage|Example|Examples';

// Capitalised words that turn up mid-sentence in comments and are not names from the code.
const NOT_A_NAME =
  'Go|I|Unicode|Windows|Linux|Unix|Darwin|Mac|Git|GitHub|Docker|Kubernetes|Postgres|English|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December';

const COMMENT = 'comment.line.double-slash.go';
const REFERENCE = 'meta.comment.reference.go';

const ADDED_RULES = {
  orca_type_name: {
    comment: 'a type name; the package qualifying it keeps the default foreground',
    patterns: [
      { match: '\\b\\w+(?=\\.\\w)', name: 'entity.name.package.go' },
      { match: '\\w+', name: 'entity.name.type.go' },
    ],
  },
  orca_identifier: {
    comment: 'a name in an expression; only an exported one says anything about what it is',
    patterns: [
      ...Object.entries(STDLIB_CONSTANTS).map(([pkg, names]) => ({
        match: `(?<=\\b${pkg}\\.)(?:${names})\\b`,
        name: 'support.constant.go',
      })),
      { match: '(?<=\\.)\\p{Lu}\\w*', name: 'variable.other.member.go' },
      { match: '\\b(?:Err(?:\\p{Lu}\\w*)?|EOF)\\b', name: 'variable.other.error.go' },
      { match: '\\b\\p{Lu}\\w*', name: 'constant.other.exported.go' },
      { match: '\\w+', name: 'meta.identifier.go' },
    ],
  },
  orca_variable: {
    comment: 'a name being declared or assigned to, so a variable: exported, or else local',
    patterns: [
      { match: '\\b\\p{Lu}\\w*', name: 'variable.other.exported.go' },
      { match: '\\w+', name: 'meta.identifier.go' },
    ],
  },
  orca_field: {
    comment: 'a field in a struct declaration or a composite literal key',
    patterns: [
      { match: '\\b\\p{Lu}\\w*', name: 'variable.other.field.go' },
      { match: '\\w+', name: 'meta.field.go' },
    ],
  },
  orca_comment_text: {
    comment:
      'The words of a line comment. A name from the code gets no comment scope, so it takes the default foreground; a grammar cannot look names up, so these are the shapes a name has in prose.',
    patterns: [
      { comment: 'a doc link: [Name], [pkg.Name]', match: '(?<=\\[)\\*?\\p{L}[\\w.]*(?=\\])', name: REFERENCE },
      { comment: 'qualified: pkg.Name, Type.Method', match: '\\b\\p{L}\\w*(?:\\.\\p{Lu}\\w*)+', name: REFERENCE },
      { comment: 'a call: name()', match: '\\b\\p{L}\\w*(?=\\(\\))', name: REFERENCE },
      { comment: 'mixed caps: readerDSN, SchemaVersion', match: '\\b(?:\\p{Ll}[\\p{Ll}\\d]*\\p{Lu}|\\p{Lu}[\\p{Ll}\\d]+\\p{Lu})\\w*', name: REFERENCE },
      {
        comment: 'capitalised in the middle of a sentence: "returned by Commit once"',
        match: `(?<=[\\p{Ll}\\d,;:] )(?!(?:${NOT_A_NAME})\\b)\\p{Lu}\\p{Ll}\\w*`,
        name: REFERENCE,
      },
      { match: '\\w+|\\W+', name: COMMENT },
    ],
  },
};

// Go's convention opens a doc comment with the name it documents: "Open opens the database".
// Only the first line of a comment can do that, so consecutive comment lines are taken as one
// block. Declarations and their members are documented at the left margin or one tab in, and the
// verb after the name ("is", "are", "returns") separates a doc comment from other prose.
const COMMENTS = {
  patterns: [
    {
      name: 'comment.block.go',
      begin: '(\\/\\*)',
      beginCaptures: { 1: { name: 'punctuation.definition.comment.go' } },
      end: '(\\*\\/)',
      endCaptures: { 1: { name: 'punctuation.definition.comment.go' } },
    },
    {
      comment: 'a block of line comments, with the name its first line documents',
      begin: `^\\t?(\\/\\/)(?:( )(?!(?:${NOT_A_SUBJECT})\\b)(\\p{L}\\w*)(?= (?:is|are|was|has|\\p{Ll}+s)\\b))?`,
      beginCaptures: {
        1: { name: `${COMMENT} punctuation.definition.comment.go` },
        2: { name: COMMENT },
        3: { name: REFERENCE },
      },
      while: '^\\t?(?=\\/\\/)',
      patterns: [{ include: '#orca_comment_text' }],
    },
    {
      comment: 'any other line comment',
      begin: '(\\/\\/)',
      beginCaptures: { 1: { name: `${COMMENT} punctuation.definition.comment.go` } },
      end: '(?:\\n|$)',
      patterns: [{ include: '#orca_comment_text' }],
    },
  ],
};

function renameScopes(value) {
  return value
    .split(/\s+/)
    .map((scope) => {
      for (const [pattern, replacement] of RENAMES) {
        if (pattern.test(scope)) return scope.replace(pattern, replacement);
      }
      return scope;
    })
    .filter(Boolean)
    .join(' ');
}

const isLeaf = (rule) =>
  rule.match === '\\w+' &&
  Object.keys(rule).every((key) => key === 'match' || key === 'name' || key === 'comment');

function transform(rule, context) {
  if (Array.isArray(rule)) return rule.map((child) => transform(child, context));
  if (!rule || typeof rule !== 'object') return rule;
  if (isLeaf(rule)) {
    // Type parameters are declared like parameters but are used as types.
    if (context.key === 'generic_param_types' && rule.name === 'variable.parameter.go') {
      return { match: rule.match, name: 'entity.name.type.parameter.go' };
    }
    if (LEAVES[rule.name]) return { include: `#${LEAVES[rule.name]}` };
  }
  const out = {};
  for (const [key, child] of Object.entries(rule)) {
    if (key === 'name' || key === 'contentName') {
      const renamed = renameScopes(child);
      if (renamed) out[key] = renamed;
    } else {
      out[key] = transform(child, context);
    }
  }
  return out;
}

const upstream = JSON.parse(readFileSync(UPSTREAM, 'utf8'));
const repository = {};
for (const [key, rule] of Object.entries(upstream.repository)) {
  // `hover` only serves VS Code's hover popups, which show Go signatures without a file around them.
  if (key === 'hover') continue;
  repository[key] = transform(rule, { key });
}
repository.statements.patterns = repository.statements.patterns.filter(
  (rule) => rule.include !== '#hover',
);
repository.comments = COMMENTS;
Object.assign(repository, ADDED_RULES);

const grammar = {
  name: 'Go',
  scopeName: upstream.scopeName,
  patterns: upstream.patterns,
  repository,
};
const built = `${JSON.stringify(grammar, null, 2)}\n`;
if (process.argv.includes('--check')) {
  // For the tests: the committed grammar must be what this script builds.
  if (readFileSync(OUTPUT, 'utf8') !== built) {
    console.error('syntaxes/go.tmLanguage.json is stale: run `node tools/build-grammar.mjs`');
    process.exit(1);
  }
} else {
  writeFileSync(OUTPUT, built);
  console.log(`wrote ${OUTPUT.pathname}`);
}
