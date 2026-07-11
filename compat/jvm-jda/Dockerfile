# syntax=docker/dockerfile:1
# Build context is compat/ (see compat/compose.yaml's `verify-jda` service).
FROM gradle:9-jdk21
WORKDIR /app
COPY jvm-jda/build.gradle.kts ./
COPY jvm-jda/src ./src
COPY common ./common
CMD ["gradle", "run", "--no-daemon", "-q"]
