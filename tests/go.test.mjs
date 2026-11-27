// Tokenizes Go with the real TextMate engine and checks the token types Orca would color.
// A token is written `text‹type›`; a bare token has no type and takes the default foreground.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LINE_BUDGET_MS, compact, loadGrammar, tokenize } from '../tools/orca-tokens.mjs';

const path = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const grammar = await loadGrammar(path('syntaxes/go.tmLanguage.json'));

const render = (line) =>
  compact(line.tokens)
    .map(([text, type]) => (type ? `${text}‹${type}›` : text))
    .join(' ');

/** Renders the last line of `source`, so a case can set up context on earlier lines. */
const last = (source) => render(tokenize(grammar, source).at(-1));

const cases = {
  'type declarations': [
    ['type Store struct {', 'type‹keyword› Store‹type› struct‹keyword› {‹delimiter›'],
    ['type Outcome string', 'type‹keyword› Outcome‹type› string‹type›'],
    [
      'type Pair[K comparable, V any] struct {',
      'type‹keyword› Pair‹type› [‹delimiter› K‹type› comparable‹type› ,‹delimiter› V‹type› any‹type› ]‹delimiter› struct‹keyword› {‹delimiter›',
    ],
  ],
  'struct fields: exported ones are colored, and a package qualifier never is': [
    ['type T struct {\n\tName string', 'Name‹identifier› string‹type›'],
    ['type T struct {\n\tcloseErr error', 'closeErr error‹type›'],
    ['type T struct {\n\tw *sql.DB', 'w *‹operator› sql .‹delimiter› DB‹type›'],
    ['type T struct {\n\tPaused time.Time', 'Paused‹identifier› time .‹delimiter› Time‹type›'],
    [
      'type T struct {\n\tAttrs map[string][]byte',
      'Attrs‹identifier› map‹keyword› [‹delimiter› string‹type› ]‹delimiter› [‹delimiter› ]‹delimiter› byte‹type›',
    ],
  ],
  'functions: declarations, calls, parameters and receivers': [
    [
      'func Open(ctx context.Context, path string) (*Store, error) {',
      'func‹keyword› Open‹function› (‹delimiter› ctx‹variable.parameter› context .‹delimiter› Context‹type› ,‹delimiter› path‹variable.parameter› string‹type› )‹delimiter› (‹delimiter› *‹operator› Store‹type› ,‹delimiter› error‹type› )‹delimiter› {‹delimiter›',
    ],
    [
      'func (rs RecordSet) Empty() bool {',
      'func‹keyword› (‹delimiter› rs‹variable.parameter› RecordSet‹type› )‹delimiter› Empty‹function› (‹delimiter› )‹delimiter› bool‹type› {‹delimiter›',
    ],
    [
      'func Sum[N Number](xs ...N) (total N) {',
      'func‹keyword› Sum‹function› [‹delimiter› N‹type› Number‹type› ]‹delimiter› (‹delimiter› xs‹variable.parameter› ...‹operator› N‹type› )‹delimiter› (‹delimiter› total‹variable.parameter› N‹type› )‹delimiter› {‹delimiter›',
    ],
    [
      '\tw, err := sql.Open("sqlite", readerDSN(path))',
      'w ,‹delimiter› err :=‹operator› sql .‹delimiter› Open‹function› (‹delimiter› "‹string› sqlite‹string› "‹string› ,‹delimiter› readerDSN‹function› (‹delimiter› path )‹delimiter› )‹delimiter›',
    ],
    ['\tout := make([]U, 0, len(in))', 'out :=‹operator› make‹function› (‹delimiter› [‹delimiter› ]‹delimiter› U‹type› ,‹delimiter› 0‹number› ,‹delimiter› len‹function› (‹delimiter› in )‹delimiter› )‹delimiter›'],
  ],
  'variables: locals take the default foreground, exported names are colored': [
    ['var ErrStopped = errors.New("x")', 'var‹keyword› ErrStopped‹identifier› =‹operator› errors .‹delimiter› New‹function› (‹delimiter› "‹string› x‹string› "‹string› )‹delimiter›'],
    ['var defaultTimeout = 10 * time.Second', 'var‹keyword› defaultTimeout =‹operator› 10‹number› *‹operator› time .‹delimiter› Second‹constant›'],
    ['\treturn len(rs.Records) == 0', 'return‹keyword.flow› len‹function› (‹delimiter› rs .‹delimiter› Records‹identifier› )‹delimiter› ==‹operator› 0‹number›'],
    ['\treturn &Store{ctx: ctx, w: w}, nil', 'return‹keyword.flow› &‹operator› Store‹type› {‹delimiter› ctx :‹delimiter› ctx ,‹delimiter› w :‹delimiter› w }‹delimiter› ,‹delimiter› nil‹identifier›'],
    ['\tp := Pair{Key: "a"}', 'p :=‹operator› Pair‹type› {‹delimiter› Key‹identifier› :‹delimiter› "‹string› a‹string› "‹string› }‹delimiter›'],
    ['\tif p.next == nil {', 'if‹keyword.flow› p .‹delimiter› next ==‹operator› nil‹identifier› {‹delimiter›'],
  ],
  'exported names in an expression: constants, unless a field, an error or assigned to': [
    ['\tif v == SchemaVersion {', 'if‹keyword.flow› v ==‹operator› SchemaVersion‹constant› {‹delimiter›'],
    ['\tif c.Right == Call {', 'if‹keyword.flow› c .‹delimiter› Right‹identifier› ==‹operator› Call‹constant› {‹delimiter›'],
    ['\tswitch s {\n\tcase PM, AM:', 'case‹keyword.flow› PM‹constant› ,‹delimiter› AM‹constant› :‹delimiter›'],
    ['\treturn ErrStopped', 'return‹keyword.flow› ErrStopped‹identifier›'],
    ['\treturn io.EOF', 'return‹keyword.flow› io .‹delimiter› EOF‹identifier›'],
    ['\tVerbose = true', 'Verbose‹identifier› =‹operator› true‹constant›'],
    ['\td := 2 * time.Second', 'd :=‹operator› 2‹number› *‹operator› time .‹delimiter› Second‹constant›'],
    ['\tw.WriteHeader(http.StatusOK)', 'w .‹delimiter› WriteHeader‹function› (‹delimiter› http .‹delimiter› StatusOK‹constant› )‹delimiter›'],
    ['\tt := rec.Time.Second', 't :=‹operator› rec .‹delimiter› Time‹identifier› .‹delimiter› Second‹identifier›'],
  ],
  'constants: declared names and the builtin ones': [
    ['const pragmas = "x"', 'const‹keyword› pragmas‹constant› =‹operator› "‹string› x‹string› "‹string›'],
    ['const (\n\tAccepted Outcome = "accepted"', 'Accepted‹constant› Outcome‹type› =‹operator› "‹string› accepted‹string› "‹string›'],
    ['const (\n\tphaseOpen = iota', 'phaseOpen‹constant› =‹operator› iota‹constant›'],
    ['const (\n\tphaseOpen = iota\n\tphaseClosing', 'phaseClosing‹constant›'],
    ['\tok := true', 'ok :=‹operator› true‹constant›'],
  ],
  'literals: a number is one color, and verbs and escapes stand out in a string': [
    ['\tx := 1.5e3', 'x :=‹operator› 1‹number› .‹number› 5‹number› e‹number› 3‹number›'],
    ['\tx := 0b1010_0101', 'x :=‹operator› 0b‹number› 1010‹number› _‹number› 0101‹number›'],
    ['\tx := 0x1F', 'x :=‹operator› 0x‹number› 1F‹number›'],
    ['\ts := "open %s: %w\\n"', 's :=‹operator› "‹string› open‹string› %s‹regexp› :‹string› %w‹regexp› \\n‹regexp› "‹string›'],
    ["\tr := 'a'", "r :=‹operator› '‹string› a‹string› '‹string›"],
    ['\ts := `raw %d`', 's :=‹operator› `‹string› raw‹string› %d‹regexp› `‹string›'],
  ],
  'comments: a name from the code is left out of the comment color': [
    ['// Store is an open database file.', '//‹comment› Store is an open database file.‹comment›'],
    ['// pragmas are the settings.', '//‹comment› pragmas are the settings.‹comment›'],
    ['// A version may rebuild a table.', '// A version may rebuild a table.‹comment›'],
    ['// Open opens the file.\n// Then it reads the rows.', '// Then it reads the rows.‹comment›'],
    ['// It is returned by Commit once done.', '// It is returned by‹comment› Commit once done.‹comment›'],
    ['// It brings the schema to SchemaVersion.', '// It brings the schema to‹comment› SchemaVersion .‹comment›'],
    ['// It calls readerDSN() and fmt.Errorf.', '// It calls‹comment› readerDSN () and‹comment› fmt.Errorf .‹comment›'],
    ['// See [Store.Get] for more.', '// See [‹comment› Store.Get ] for more.‹comment›'],
    ['// This is Go code for SQLite and JSON.', '// This is Go code for SQLite and JSON.‹comment›'],
    ['\tx := 1 // set by Commit', 'x :=‹operator› 1‹number› // set by‹comment› Commit'],
    ['func f() {\n\t\t// retries is the count', '// retries is the count‹comment›'],
    ['//go:generate stringer -type=Outcome', '//go:generate stringer -type=Outcome‹comment›'],
  ],
  'keywords, comments, packages, imports and labels': [
    ['package store', 'package‹keyword› store'],
    ['import "database/sql"', 'import‹keyword.flow› "‹string› database/sql‹string› "‹string›'],
    ['\tx := 1 /* why */', 'x :=‹operator› 1‹number› /* why */‹comment›'],
    ['func f() {\nloop:', 'loop :‹delimiter›'],
    ['func f() {\n\tbreak loop', 'break‹keyword.flow› loop'],
    ['\tfor _, v := range in {', 'for‹keyword.flow› _ ,‹delimiter› v :=‹operator› range‹keyword.flow› in {‹delimiter›'],
    ['\tgo func(e Event) {', 'go‹keyword.flow› func‹keyword› (‹delimiter› e‹variable.parameter› Event‹type› )‹delimiter› {‹delimiter›'],
  ],
  'a case names a type in a type switch and a value in any other': [
    ['\tswitch x := v.(type) {\n\tcase fmt.Stringer:', 'case‹keyword.flow› fmt .‹delimiter› Stringer‹type› :‹delimiter›'],
    ['\tswitch x := v.(type) {\n\tcase int, []byte:', 'case‹keyword.flow› int‹type› ,‹delimiter› [‹delimiter› ]‹delimiter› byte‹type› :‹delimiter›'],
    ['\tswitch d {\n\tcase time.Second:', 'case‹keyword.flow› time .‹delimiter› Second‹constant› :‹delimiter›'],
  ],
};

for (const [name, lines] of Object.entries(cases)) {
  test(name, () => {
    for (const [source, expected] of lines) {
      assert.equal(last(source), expected, source);
    }
  });
}

test('the fixture tokenizes within the per-line budget Orca allows', () => {
  const lines = tokenize(grammar, readFileSync(path('tests/fixtures/constructs.go'), 'utf8'));
  assert.equal(lines.filter((line) => line.plain).length, 0, 'no line may fall back to plain');
  // Orca retries a slow line; the margin keeps a loaded machine from flaking the test.
  const slowest = lines.reduce((a, b) => (b.ms > a.ms ? b : a));
  assert.ok(slowest.ms < LINE_BUDGET_MS / 2, `${slowest.ms.toFixed(1)} ms: ${slowest.text}`);
});

test('a long line of chained calls stays inside the budget', () => {
  const call = 'fmt.Sprintf("%s: %w", rec.Name, err)';
  const source = `func f() {\n\treturn join(${Array(25).fill(call).join(', ')})\n}`;
  const lines = tokenize(grammar, source);
  assert.ok(lines[1].text.length > 900 && lines[1].text.length <= 1000);
  assert.equal(lines.filter((line) => line.plain).length, 0);
  assert.equal(render(lines[2]), '}‹delimiter›');
});

test('the committed grammar is what the build script produces', () => {
  execFileSync(process.execPath, [path('tools/build-grammar.mjs'), '--check'], { stdio: 'pipe' });
});
