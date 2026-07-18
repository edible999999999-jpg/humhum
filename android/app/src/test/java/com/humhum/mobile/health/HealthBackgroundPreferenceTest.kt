package com.humhum.mobile.health

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthBackgroundPreferenceTest {
    @Test
    fun deniedRequestNeverLeavesBackgroundSyncEnabled() {
        val preference = HealthBackgroundPreference(FakeStore())

        preference.beginEnableRequest()
        assertFalse(preference.isEnabled())
        assertTrue(preference.isRequestPending())

        preference.completeEnableRequest(granted = false)

        assertFalse(preference.isEnabled())
        assertFalse(preference.isRequestPending())
    }

    @Test
    fun backgroundSyncBecomesEnabledOnlyAfterTheGrantReturns() {
        val preference = HealthBackgroundPreference(FakeStore())

        preference.beginEnableRequest()
        preference.completeEnableRequest(granted = true)

        assertTrue(preference.isEnabled())
        assertFalse(preference.isRequestPending())
    }

    private class FakeStore : HealthBackgroundPreference.Store {
        private val values = mutableMapOf<String, Boolean>()

        override fun getBoolean(key: String, fallback: Boolean): Boolean = values[key] ?: fallback

        override fun putBoolean(key: String, value: Boolean) {
            values[key] = value
        }

        override fun clear() {
            values.clear()
        }
    }
}
