package com.humhum.mobile.health

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.humhum.mobile.MainActivity
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

internal class HealthForegroundCoordinator(
    private val scope: CoroutineScope,
    private val refresh: suspend () -> Unit,
) {
    private val inFlight = AtomicBoolean(false)

    fun request() {
        if (!inFlight.compareAndSet(false, true)) return
        scope.launch {
            try {
                refresh()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // A provider or transport failure must not escape the process lifecycle callback.
            } finally {
                inFlight.set(false)
            }
        }
    }
}

object HealthForegroundRefresh {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val registered = AtomicBoolean(false)

    fun register(application: Application) {
        if (!registered.compareAndSet(false, true)) return
        val coordinator = HealthForegroundCoordinator(scope) {
            HealthRuntime.reconcileBackgroundSync(application)
            HealthRuntime.refresh(application, SyncTrigger.FOREGROUND)
        }
        application.registerActivityLifecycleCallbacks(object :
            Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                if (activity !is MainActivity) return
                coordinator.request()
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
