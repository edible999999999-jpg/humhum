package com.humhum.mobile.health

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.humhum.mobile.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object HealthForegroundRefresh {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun register(application: Application) {
        application.registerActivityLifecycleCallbacks(object :
            Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                if (activity !is MainActivity) return
                scope.launch {
                    HealthRuntime.reconcileBackgroundSync(application)
                    HealthRuntime.refresh(application, SyncTrigger.FOREGROUND)
                }
            }

            override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }
}
