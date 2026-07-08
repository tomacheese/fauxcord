// Kord (kord-rest) compatibility verifier build config.
//
// Kotlin/ktor versions are pinned to what Kord 0.14.0 itself was built against
// (confirmed via kordlib/kord's gradle/libs.versions.toml at git tag `0.14.0`:
// kotlin = "1.9.24", ktor = "2.3.11") so the ktor-client-cio engine we add here
// is binary-compatible with the ktor-client-core version kord-rest:0.14.0 pulls
// in transitively.
plugins {
    application
    kotlin("jvm") version "2.4.0"
}

repositories {
    mavenCentral()
}

dependencies {
    // kord-rest is the gateway-free, standalone REST client module of Kord —
    // see the header comment in src/main/kotlin/Verify.kt for why the REST phase
    // (unlike JDA, see ../jvm-jda/README.md) is NOT gateway-blocked.
    implementation("dev.kord:kord-rest:0.18.1")

    // kord-core is the high-level facade built on top of kord-rest + kord-gateway,
    // used only by the Gateway verification phase (verifyGateway in Verify.kt) via
    // the `Kord(token) { }` builder. Pinned to the same version as kord-rest above.
    implementation("dev.kord:kord-core:0.18.1")

    // CIO is a pure-JVM/coroutine Ktor engine with no native dependencies,
    // matching the ktor version kord-rest:0.14.0 was compiled against.
    implementation("io.ktor:ktor-client-cio:3.5.1")
    implementation("io.ktor:ktor-client-core:3.5.1")

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
