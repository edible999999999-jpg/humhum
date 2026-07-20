package com.humhum.mobile.ui

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonalContextFreshnessTest {
    private val zone = ZoneId.of("UTC")
    private val now = Instant.parse("2026-07-20T10:00:00Z")

    @Test
    fun activeContextReportsItsRealRelativeAge() {
        val freshness = personalContextFreshness(
            generatedAt = "2026-07-20T09:36:00Z",
            expiresAt = "2026-07-20T11:00:00Z",
            now = now,
            zone = zone,
        )

        assertFalse(freshness.expired)
        assertEquals("24 分钟前同步", freshness.label)
    }

    @Test
    fun expiredContextNeverClaimsItWasJustSynced() {
        val freshness = personalContextFreshness(
            generatedAt = "2026-07-20T09:58:00Z",
            expiresAt = "2026-07-20T09:59:00Z",
            now = now,
            zone = zone,
        )

        assertTrue(freshness.expired)
        assertEquals("已过期 · 09:58 更新", freshness.label)
    }

    @Test
    fun itemTimestampFallsBackHonestlyWhenItCannotBeParsed() {
        assertEquals(
            "时间未知",
            relativeTimestampLabel("not-a-time", now = now, zone = zone),
        )
    }
}
