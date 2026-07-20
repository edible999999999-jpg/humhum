package com.humhum.mobile.ui

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal data class PersonalContextFreshness(
    val label: String,
    val expired: Boolean,
)

internal fun personalContextFreshness(
    generatedAt: String,
    expiresAt: String,
    now: Instant = Instant.now(),
    zone: ZoneId = ZoneId.systemDefault(),
): PersonalContextFreshness {
    val generated = generatedAt.toInstantOrNull()
    val expires = expiresAt.toInstantOrNull()
    val expired = expires?.let { !it.isAfter(now) } ?: false
    val label = when {
        expired && generated != null ->
            "已过期 · ${absoluteTimestampLabel(generated, now, zone)} 更新"
        expired -> "已过期 · 更新时间未知"
        generated != null -> "${relativeTimestampLabel(generated, now, zone)}同步"
        else -> "同步时间未知"
    }
    return PersonalContextFreshness(label = label, expired = expired)
}

internal fun relativeTimestampLabel(
    value: String,
    now: Instant = Instant.now(),
    zone: ZoneId = ZoneId.systemDefault(),
): String = value.toInstantOrNull()?.let { relativeTimestampLabel(it, now, zone) }
    ?: "时间未知"

private fun relativeTimestampLabel(
    value: Instant,
    now: Instant,
    zone: ZoneId,
): String {
    val age = Duration.between(value, now)
    if (age.isNegative || age.toMinutes() < 5) return "刚刚"
    if (age.toMinutes() < 60) return "${age.toMinutes()} 分钟前"
    if (age.toHours() < 24) return "${age.toHours()} 小时前"
    return absoluteTimestampLabel(value, now, zone)
}

private fun absoluteTimestampLabel(value: Instant, now: Instant, zone: ZoneId): String {
    val date = value.atZone(zone)
    val pattern = if (date.toLocalDate() == now.atZone(zone).toLocalDate()) {
        "HH:mm"
    } else {
        "M月d日 HH:mm"
    }
    return date.format(DateTimeFormatter.ofPattern(pattern))
}

private fun String.toInstantOrNull(): Instant? = runCatching { Instant.parse(this) }.getOrNull()
