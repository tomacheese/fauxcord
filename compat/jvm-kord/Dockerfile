# syntax=docker/dockerfile:1
# Build context is compat/ (see compat/compose.yaml's `verify-kord` service).
FROM gradle:8-jdk21
WORKDIR /app
COPY jvm-kord/build.gradle.kts ./
COPY jvm-kord/src ./src
COPY common ./common
CMD ["gradle", "run", "--no-daemon", "-q"]
