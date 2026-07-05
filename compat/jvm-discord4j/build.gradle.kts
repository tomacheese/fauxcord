plugins {
    application
    java
}

repositories {
    mavenCentral()
}

dependencies {
    // Kept in sync with the version documented/asserted in Verify.java's header comment.
    implementation("com.discord4j:discord4j-core:3.2.6")
}

application {
    mainClass.set("Verify")
}
