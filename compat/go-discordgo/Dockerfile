# syntax=docker/dockerfile:1
# Build context is compat/ (see compose.yaml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
FROM golang:1.22-alpine
WORKDIR /app
COPY go-discordgo/go.mod ./
COPY go-discordgo/verify.go ./
COPY common ./common
# go.sum is intentionally not vendored by hand: `go mod tidy` needs the
# source file present to see the discordgo import, and resolves/pins the
# exact release (plus its transitive deps) at build time, which is more
# robust than hand-computing a go.sum here.
RUN go mod tidy
RUN go build -o /verify verify.go
CMD ["/verify"]
