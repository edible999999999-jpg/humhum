package com.humhum.mobile.health

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import org.json.JSONObject

enum class HealthMetric(
    val kind: String,
    val unit: String,
    val sourceSegment: String,
) {
    STEPS("health.steps.daily", "count", "steps"),
    RESTING_HEART_RATE("health.resting_heart_rate.daily", "bpm", "resting-heart-rate"),
    SLEEP("health.sleep.daily", "minutes", "sleep");

    companion object {
        fun fromKind(kind: String): HealthMetric = entries.firstOrNull { it.kind == kind }
            ?: throw IllegalArgumentException("Health metric is invalid")
    }
}

enum class HealthSource(
    val wireValue: String,
    private val sourceIdPrefix: String,
    val quality: String,
) {
    HEALTH_CONNECT("health_connect", "health-connect", "trusted"),
    PHONE_STEP_COUNTER("phone_step_counter", "phone-step-counter", "device_estimate");

    fun sourceId(metric: HealthMetric, day: LocalDate): String =
        "$sourceIdPrefix:${metric.sourceSegment}:$day"

    fun localDayFromSourceId(metric: HealthMetric, value: String): LocalDate {
        val prefix = "$sourceIdPrefix:${metric.sourceSegment}:"
        require(value.startsWith(prefix)) { "Health signal source id is invalid" }
        val encodedDay = value.removePrefix(prefix)
        require(CANONICAL_DAY.matches(encodedDay)) { "Health signal source id is invalid" }
        val day = LocalDate.parse(encodedDay, DateTimeFormatter.ISO_LOCAL_DATE)
        require(sourceId(metric, day) == value) { "Health signal source id is invalid" }
        return day
    }

    companion object {
        private val CANONICAL_DAY = Regex("\\d{4}-\\d{2}-\\d{2}")

        fun fromWireValue(value: String): HealthSource = entries.firstOrNull {
            it.wireValue == value
        } ?: throw IllegalArgumentException("Health signal source is invalid")
    }
}

data class HealthSignal(
    val sourceId: String,
    val metric: HealthMetric,
    val value: Double,
    val source: HealthSource,
    val startedAt: Instant,
    val endedAt: Instant,
    val capturedAt: Instant,
    val localDay: LocalDate = source.localDayFromSourceId(metric, sourceId),
) {
    init {
        require(sourceId.isNotBlank() && sourceId.length <= MAX_SOURCE_ID_LENGTH) {
            "Health signal source id is invalid"
        }
        require(source.sourceId(metric, localDay) == sourceId) {
            "Health signal source id is invalid"
        }
        require(value.isFinite() && value >= 0.0) { "Health signal value is invalid" }
        require(startedAt.isBefore(endedAt)) { "Health signal interval is invalid" }
        val duration = Duration.between(startedAt, endedAt)
        require(duration >= MIN_DAILY_DURATION && duration <= MAX_DAILY_DURATION) {
            "Health signal must be a daily aggregate"
        }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("source_id", sourceId)
        .put("kind", metric.kind)
        .put("started_at", DateTimeFormatter.ISO_INSTANT.format(startedAt))
        .put("ended_at", DateTimeFormatter.ISO_INSTANT.format(endedAt))
        .put("value", value)
        .put("unit", metric.unit)
        .put("source", source.wireValue)
        .put("captured_at", DateTimeFormatter.ISO_INSTANT.format(capturedAt))
        .put("quality", source.quality)

    companion object {
        private const val MAX_SOURCE_ID_LENGTH = 512
        private val MIN_DAILY_DURATION = Duration.ofHours(20)
        private val MAX_DAILY_DURATION = Duration.ofHours(28)

        fun forLocalDay(
            metric: HealthMetric,
            value: Double,
            source: HealthSource,
            day: LocalDate,
            zone: ZoneId,
            capturedAt: Instant,
        ): HealthSignal {
            val startedAt = day.atStartOfDay(zone).toInstant()
            val endedAt = day.plusDays(1).atStartOfDay(zone).toInstant()
            return HealthSignal(
                sourceId = source.sourceId(metric, day),
                metric = metric,
                value = value,
                source = source,
                startedAt = startedAt,
                endedAt = endedAt,
                capturedAt = capturedAt,
                localDay = day,
            )
        }

        fun fromJson(value: JSONObject): HealthSignal {
            val metric = HealthMetric.fromKind(value.getString("kind"))
            require(value.getString("unit") == metric.unit) { "Health signal unit is invalid" }
            val source = HealthSource.fromWireValue(value.getString("source"))
            val sourceId = value.getString("source_id")
            val signal = HealthSignal(
                sourceId = sourceId,
                metric = metric,
                value = value.getDouble("value"),
                source = source,
                startedAt = Instant.parse(value.getString("started_at")),
                endedAt = Instant.parse(value.getString("ended_at")),
                capturedAt = Instant.parse(value.getString("captured_at")),
                localDay = source.localDayFromSourceId(metric, sourceId),
            )
            require(value.getString("quality") == signal.source.quality) {
                "Health signal quality is invalid"
            }
            return signal
        }
    }
}
