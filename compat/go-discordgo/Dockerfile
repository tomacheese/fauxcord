# syntax=docker/dockerfile:1
# Build context is compat/ (see compose.yaml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
FROM golang:1.26-alpine
WORKDIR /app
COPY go-discordgo/go.mod ./
COPY go-discordgo/verify.go ./
COPY common ./common
# go.sum is intentionally not hand-vendored: `go mod tidy` resolves and pins
# the exact release (and transitive deps) at build time, which is more robust.
RUN go mod tidy && go build -o /verify verify.go
CMD ["/verify"]
