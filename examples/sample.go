// Package jobs runs a piece of work until it succeeds or runs out of tries.
package jobs

import (
	"errors"
	"fmt"
	"time"
)

const (
	MaxAttempts  = 3               // tries before Run gives up
	DefaultDelay = 2 * time.Second // the wait between two tries
)

// State is where a Job stands.
type State int

const (
	Pending State = iota
	Done
	Failed // set when Run returns ErrGaveUp
)

// ErrGaveUp is returned by Run once a Job has failed MaxAttempts times.
var ErrGaveUp = errors.New("jobs: gave up")

// Job is one piece of work and its result. Create one with New.
type Job[T any] struct {
	Name  string
	State State
	work  func() (T, error)
	delay time.Duration
}

// New returns a Pending Job that waits DefaultDelay between tries.
func New[T any](name string, work func() (T, error)) *Job[T] {
	return &Job[T]{Name: name, work: work, delay: DefaultDelay}
}

// Run calls the work until it succeeds, or reports ErrGaveUp.
func (j *Job[T]) Run() (result T, err error) {
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		if result, err = j.work(); err == nil {
			j.State = Done
			return result, nil
		}
		fmt.Printf("%s: try %d of %d: %v\n", j.Name, attempt, MaxAttempts, err)
		time.Sleep(j.delay)
	}
	j.State = Failed
	return result, fmt.Errorf("job %q: %w", j.Name, ErrGaveUp)
}
