import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
}

val signingPropertyNames = setOf("storeFile", "storePassword", "keyAlias", "keyPassword")
val signingPropertiesFile = file("${System.getProperty("user.home")}/.humhum/android-signing.properties")
val signingProperties = Properties()
fun quotedBuildValue(name: String): String {
    val value = providers.environmentVariable(name).orNull ?: ""
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}
val releaseSigningConfigured = signingPropertiesFile.isFile.also { exists ->
    if (exists) {
        FileInputStream(signingPropertiesFile).use(signingProperties::load)
        require(signingProperties.stringPropertyNames() == signingPropertyNames) {
            "HUMHUM Android signing properties must contain exactly four required values"
        }
        require(signingPropertyNames.all { !signingProperties.getProperty(it).isNullOrBlank() }) {
            "HUMHUM Android signing properties contain an empty value"
        }
        require(signingProperties.getProperty("keyAlias") == "humhum-release") {
            "HUMHUM Android signing alias is invalid"
        }
        val home = file(System.getProperty("user.home")).canonicalFile.toPath()
        val store = file(signingProperties.getProperty("storeFile")).canonicalFile
        require(store.isFile && store.toPath().startsWith(home)) {
            "HUMHUM Android release keystore must be a file under the current user home"
        }
    }
}

android {
    namespace = "com.humhum.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.humhum.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 7
        versionName = "0.3.4"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "FIREBASE_APPLICATION_ID", quotedBuildValue(
                "HUMHUM_FIREBASE_APPLICATION_ID"))
        buildConfigField("String", "FIREBASE_API_KEY", quotedBuildValue(
                "HUMHUM_FIREBASE_API_KEY"))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quotedBuildValue(
                "HUMHUM_FIREBASE_PROJECT_ID"))
        buildConfigField("String", "FIREBASE_SENDER_ID", quotedBuildValue(
                "HUMHUM_FIREBASE_SENDER_ID"))
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("humhumRelease") {
                storeFile = file(signingProperties.getProperty("storeFile"))
                storePassword = signingProperties.getProperty("storePassword")
                keyAlias = signingProperties.getProperty("keyAlias")
                keyPassword = signingProperties.getProperty("keyPassword")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }

    buildTypes {
        release {
            isDebuggable = false
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("humhumRelease")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

if (!releaseSigningConfigured) {
    tasks.configureEach {
        val lower = name.lowercase()
        if (lower.contains("release")
                && listOf("assemble", "package", "bundle", "sign").any(lower::startsWith)) {
            doFirst {
                throw GradleException(
                        "Release signing is not configured. Run android/scripts/setup-release-signing.sh first.")
            }
        }
    }
}

dependencies {
    implementation("com.google.firebase:firebase-messaging:25.1.0")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
