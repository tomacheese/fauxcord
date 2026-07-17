// Kord (kord-rest) compatibility verifier build config.
//
// Actual pinned version: kord-rest/kord-core 0.18.1 (see dependencies below),
// which is built against the Ktor 3.x line. The ktor-client-cio engine we add
// here is pinned to the same 3.5.1 version as ktor-client-core (see below), so
// the CIO engine stays binary-compatible with the ktor-client-core that
// kord-rest pulls in transitively.
plugins {
    application
    kotlin("jvm") version "2.4.10"
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
    // matching the ktor version kord-rest was compiled against (see header
    // comment above).
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
