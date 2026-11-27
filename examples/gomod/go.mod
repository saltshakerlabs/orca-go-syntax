// A highlighting fixture for go.mod and go.work files.
module github.com/example/store

go 1.24.0

toolchain go1.24.3

godebug default=go1.21

require golang.org/x/sync v0.10.0

require (
	github.com/google/uuid v1.6.0
	golang.org/x/sys v0.28.0 // indirect
	gopkg.in/yaml.v3 v3.0.1
	modernc.org/sqlite v1.34.4-0.20241201000000-abcdef123456
	example.com/legacy/v2 v2.0.0+incompatible
)

replace example.com/fork => ../fork

replace (
	example.com/old v1.0.0 => example.com/new v1.2.3
	"example.com/quoted path" => ./local
)

exclude example.com/broken v1.4.0

retract (
	v1.0.0 // published by mistake
	[v1.1.0, v1.1.5]
)

tool golang.org/x/tools/cmd/stringer

use (
	./cmd
	./internal/store
)

godebug (
	panicnil=1
	httplaxcontentlength=0
)
