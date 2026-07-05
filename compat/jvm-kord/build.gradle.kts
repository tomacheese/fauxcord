// Kord (kord-rest) compatibility verifier build config.
//
// Kotlin/ktor versions are pinned to what Kord 0.14.0 itself was built against
// (confirmed via kordlib/kord's gradle/libs.versions.toml at git tag `0.14.0`:
// kotlin = "1.9.24", ktor = "2.3.11") so the ktor-client-cio engine we add here
// is binary-compatible with the ktor-client-core version kord-rest:0.14.0 pulls
// in transitively.
plugins {
    application
    kotlin("jvm") version "1.9.25"
}

repositories {
    mavenCentral()
}

dependencies {
    // kord-rest is the gateway-free, standalone REST client module of Kord —
    // see the header comment in src/main/kotlin/Verify.kt for why this makes
    // Kord (unlike JDA, see ../jvm-jda/README.md) NOT gateway-blocked.
    implementation("dev.kord:kord-rest:0.18.1")

    // CIO is a pure-JVM/coroutine Ktor engine with no native dependencies,
    // matching the ktor version kord-rest:0.14.0 was compiled against.
    implementation("io.ktor:ktor-client-cio:2.3.13")
    implementation("io.ktor:ktor-client-core:2.3.13")

    // kotlinx-serialization-json is already a transitive dependency of
    // kord-rest; declared explicitly here since Verify.kt uses its JsonElement
    // API directly (parseToJsonElement) to read common/*.json without needing
    // the kotlinx.serialization compiler plugin (no @Serializable data classes
    // are declared in this module).
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
}

application {
    mainClass.set("VerifyKt")
}

kotlin {
    jvmToolchain(21)
}
