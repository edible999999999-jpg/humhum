package com.humhum.mobile.health

import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject

object PhoneStepCheckpointCodec {
    @JvmStatic
    fun encode(checkpoint: PhoneStepCheckpoint): ByteArray = JSONObject()
        .put("version", CURRENT_VERSION)
        .put("day", checkpoint.day.toString())
        .put("carried_daily_steps", checkpoint.carriedDailySteps)
        .put("day_baseline_steps", checkpoint.dayBaselineSteps)
        .put("last_cumulative_steps", checkpoint.lastCumulativeSteps)
        .put("elapsed_realtime_millis", checkpoint.elapsedRealtimeMillis)
        .put("observed_at", checkpoint.observedAt.toString())
        .toString()
        .toByteArray(Charsets.UTF_8)

    @JvmStatic
    fun decode(plaintext: ByteArray): PhoneStepCheckpoint {
        val value = JSONObject(String(plaintext, Charsets.UTF_8))
        val version = value.getInt("version")
        val carriedDailySteps = when (version) {
            LEGACY_VERSION -> {
                require(value.length() == LEGACY_FIELD_COUNT) {
                    "Phone step checkpoint format is invalid"
                }
                0.0
            }
            CURRENT_VERSION -> {
                require(value.length() == CURRENT_FIELD_COUNT) {
                    "Phone step checkpoint format is invalid"
                }
                value.getDouble("carried_daily_steps")
            }
            else -> throw IllegalArgumentException("Phone step checkpoint version is invalid")
        }
        return PhoneStepCheckpoint(
            day = LocalDate.parse(value.getString("day")),
            carriedDailySteps = carriedDailySteps,
            dayBaselineSteps = value.getDouble("day_baseline_steps"),
            lastCumulativeSteps = value.getDouble("last_cumulative_steps"),
            elapsedRealtimeMillis = value.getLong("elapsed_realtime_millis"),
            observedAt = Instant.parse(value.getString("observed_at")),
        )
    }

    private const val LEGACY_VERSION = 1
    private const val CURRENT_VERSION = 2
    private const val LEGACY_FIELD_COUNT = 6
    private const val CURRENT_FIELD_COUNT = 7
}
