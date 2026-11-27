// Package store is a highlighting fixture: it compiles, and it holds one of
// each construct the grammar colors.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	// ErrStopped is returned by Commit once the context has ended.
	ErrStopped = errors.New("store: the context has ended")

	// ErrConflict is returned for a record stored with different details.
	ErrConflict = errors.New("store: already stored with different details")

	defaultTimeout = 10 * time.Second
)

// pragmas are the connection settings the writer and the readers share.
const pragmas = "_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)"

// Outcome is a record's final outcome; "" while unconsumed.
type Outcome string

const (
	Accepted Outcome = "accepted"
	Refused  Outcome = "refused"
	// Lapsed is an outcome nothing consumed in time.
	Lapsed Outcome = "lapsed"
)

const (
	phaseOpen = iota
	phaseClosing
	phaseClosed
	maxRetries = 0x10
)

// ID names a record.
type ID int64

// Store is an open database file.
type Store struct {
	ctx       context.Context
	w         *sql.DB // the one write connection
	r         *sql.DB // the read pool
	closeOnce sync.Once
	closeErr  error
}

// Record is one row. Params is its configuration as JSON.
type Record struct {
	ID       ID
	Name     string `json:"name" db:"name"`
	Disabled bool
	Tags     []string
	Attrs    map[string][]byte
	Paused   time.Time
	Outcome  Outcome
	next     *Record
	onDone   func(ctx context.Context, id ID) error
	events   chan<- Event
	sync.Mutex
}

// Event is something that happened to a Record.
type Event struct {
	Record ID
	At     time.Time
}

// RecordSet is what one Commit writes.
type RecordSet struct {
	Records []Record
	Events  []Event
	Next    ID
}

// Reader reads records.
type Reader interface {
	Get(ctx context.Context, id ID) (*Record, error)
	List(ctx context.Context, limit int) ([]Record, error)
	fmt.Stringer
}

// Number is a constraint.
type Number interface {
	~int | ~int64 | ~float64
}

// Pair holds two values.
type Pair[K comparable, V any] struct {
	Key   K
	Value V
}

// Empty reports whether rs writes nothing.
func (rs RecordSet) Empty() bool {
	return len(rs.Records)+len(rs.Events) == 0
}

// Open opens or creates the database at path.
func Open(ctx context.Context, path string) (*Store, error) {
	w, err := sql.Open("sqlite", path+"?"+pragmas+"&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("store: open %s: %w", path, err)
	}
	w.SetMaxOpenConns(1)
	if err := migrate(ctx, w); err != nil {
		w.Close()
		return nil, fmt.Errorf("store: open %s: %w", path, err)
	}
	r, err := sql.Open("sqlite", readerDSN(path))
	if err != nil {
		w.Close()
		return nil, fmt.Errorf("store: open %s: %w", path, err)
	}
	return &Store{ctx: ctx, w: w, r: r}, nil
}

func readerDSN(path string) string {
	return path + "?mode=ro&" + pragmas
}

func migrate(ctx context.Context, db *sql.DB) error {
	const schema = `
		CREATE TABLE IF NOT EXISTS records (
			id   INTEGER PRIMARY KEY,
			name TEXT NOT NULL
		);`
	_, err := db.ExecContext(ctx, schema)
	return err
}

// Close closes the store once.
func (s *Store) Close() error {
	s.closeOnce.Do(func() {
		s.closeErr = errors.Join(s.w.Close(), s.r.Close())
	})
	return s.closeErr
}

// Get returns the record with id.
func (s *Store) Get(ctx context.Context, id ID) (rec *Record, err error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	rec = new(Record)
	row := s.r.QueryRowContext(ctx, "SELECT id, name FROM records WHERE id = ?", int64(id))
	switch err := row.Scan(&rec.ID, &rec.Name); {
	case errors.Is(err, sql.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, err
	default:
		return rec, nil
	}
}

// Map applies f to each element of in.
func Map[T, U any](in []T, f func(T) U) []U {
	out := make([]U, 0, len(in))
	for _, v := range in {
		out = append(out, f(v))
	}
	return out
}

// Sum adds up xs.
func Sum[N Number](xs ...N) (total N) {
	for i := 0; i < len(xs); i++ {
		total += xs[i]
	}
	return total
}

func describe(v any) string {
	switch x := v.(type) {
	case nil:
		return "nil"
	case int, int64:
		return fmt.Sprintf("int %d", x)
	case []byte:
		return fmt.Sprintf("%d bytes, first %q\n", len(x), 'a')
	case error:
		return x.Error()
	case fmt.Stringer:
		return x.String()
	}
	return fmt.Sprintf("%T(%+v) at %08.3f%%", v, v, 1.5e3)
}

func watch(ctx context.Context, events <-chan Event, out chan<- string) error {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	seen := map[ID]struct{}{}
	pairs := []Pair[string, int]{{Key: "a", Value: 1}, {"b", 2}}
	_ = pairs
loop:
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				break loop
			}
			if _, dup := seen[ev.Record]; dup {
				continue
			}
			seen[ev.Record] = struct{}{}
			go func(e Event) {
				out <- fmt.Sprint(e.Record, e.At.Format(time.RFC3339))
			}(ev)
		case <-ticker.C:
			var mask uint8 = 0b1010_0101 &^ 0o17
			if mask > 0 && len(seen) >= maxRetries {
				goto done
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
done:
	var (
		first  Record
		others = make([]*Record, 0)
	)
	first.Lock()
	defer first.Unlock()
	if p, ok := any(&first).(*Record); ok && p.next == nil {
		others = append(others, p)
	}
	/* block comment */
	return nil
}
