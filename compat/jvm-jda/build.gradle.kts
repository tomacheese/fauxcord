// JDA (net.dv8tion:JDA) compatibility verifier build config.
//
// Pinned to the latest stable release confirmed against Maven Central's
// maven-metadata.xml at https://repo1.maven.org/maven2/net/dv8tion/JDA/ (6.5.0,
// published 2026-07-05). JDA bundles its own OkHttp/WebSocket/Jackson dependencies, so no
// extra HTTP client library is needed here; jackson-databind is added explicitly (rather
// than relying on JDA's transitive dependency) since the verifier's own JSON I/O depends
// on it directly.
plugins {
    application
    java
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("net.dv8tion:JDA:6.5.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.2")
    // JDA logs a "no SLF4J binding" warning without one; slf4j-simple silences it.
    implementation("org.slf4j:slf4j-simple:2.0.18")
}

application {
    mainClass.set("Verify")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
