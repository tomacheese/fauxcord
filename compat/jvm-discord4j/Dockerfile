# syntax=docker/dockerfile:1
FROM gradle:9-jdk21
WORKDIR /app
COPY jvm-discord4j/build.gradle.kts ./
COPY jvm-discord4j/src ./src
COPY common ./common
CMD ["gradle", "run", "--no-daemon", "-q"]
