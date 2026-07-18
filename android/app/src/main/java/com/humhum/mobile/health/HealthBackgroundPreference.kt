package com.humhum.mobile.health

import android.content.Context
import android.content.SharedPreferences

class HealthBackgroundPreference internal constructor(
    private val store: Store,
) {
    constructor(context: Context) : this(
        SharedPreferencesStore(
            context.applicationContext.getSharedPreferences(
                PREFERENCES_NAME,
                Context.MODE_PRIVATE,
            ),
        ),
    )

    fun isEnabled(): Boolean = store.getBoolean(ENABLED_KEY, false)

    fun isRequestPending(): Boolean = store.getBoolean(PENDING_KEY, false)

    fun beginEnableRequest() {
        store.putBoolean(ENABLED_KEY, false)
        store.putBoolean(PENDING_KEY, true)
    }

    fun completeEnableRequest(granted: Boolean) {
        store.putBoolean(ENABLED_KEY, granted)
        store.putBoolean(PENDING_KEY, false)
    }

    fun setEnabled(enabled: Boolean) {
        store.putBoolean(ENABLED_KEY, enabled)
        store.putBoolean(PENDING_KEY, false)
    }

    fun clear() {
        store.clear()
    }

    internal interface Store {
        fun getBoolean(key: String, fallback: Boolean): Boolean
        fun putBoolean(key: String, value: Boolean)
        fun clear()
    }

    private class SharedPreferencesStore(
        private val preferences: SharedPreferences,
    ) : Store {
        override fun getBoolean(key: String, fallback: Boolean): Boolean =
            preferences.getBoolean(key, fallback)

        override fun putBoolean(key: String, value: Boolean) {
            preferences.edit().putBoolean(key, value).apply()
        }

        override fun clear() {
            preferences.edit().clear().apply()
        }
    }

    private companion object {
        const val PREFERENCES_NAME = "humhum_health_preferences"
        const val ENABLED_KEY = "background_sync_enabled"
        const val PENDING_KEY = "background_sync_request_pending"
    }
}
