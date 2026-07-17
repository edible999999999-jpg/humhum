package com.humhum.mobile.app

import com.humhum.mobile.AnywhereGateway
import com.humhum.mobile.ConnectionStore
import com.humhum.mobile.MobileProtocol
import com.humhum.mobile.MonitorStore
import com.humhum.mobile.health.HealthRepository
import com.humhum.mobile.health.HealthUiState
import com.humhum.mobile.health.SyncTrigger
import java.io.Closeable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Owns the companion's single network lane while the legacy Activity is
 * incrementally reduced to rendering and platform permission callbacks.
 */
class MobileCompanionRepository @JvmOverloads constructor(
    private val networkExecutor: ExecutorService = Executors.newSingleThreadExecutor(),
    private val healthRepository: HealthRepository? = null,
) : Closeable {
    data class ActiveConnection(
        val connection: ConnectionStore.Connection,
        val protocol: MobileProtocol,
        val anywhere: AnywhereGateway?,
    )

    @Volatile
    private var activeConnection: ActiveConnection? = null

    @Volatile
    private var monitorStore: MonitorStore? = null

    @Volatile
    private var connectionStore: ConnectionStore? = null

    fun bindConnectionStore(store: ConnectionStore) {
        connectionStore = store
    }

    fun storedConnection(): ConnectionStore.Connection? = connectionStore?.load()

    fun bindConnection(
        connection: ConnectionStore.Connection,
        protocol: MobileProtocol,
        anywhere: AnywhereGateway?,
    ) {
        activeConnection = ActiveConnection(connection, protocol, anywhere)
    }

    fun clearConnection() {
        activeConnection = null
    }

    fun currentConnection(): ActiveConnection? = activeConnection

    fun bindMonitorStore(store: MonitorStore) {
        monitorStore = store
    }

    fun monitorEnabled(): Boolean = monitorStore?.isEnabled ?: false

    suspend fun refreshHealth(trigger: SyncTrigger): HealthUiState? =
        healthRepository?.refresh(trigger)

    fun executeNetwork(work: Runnable): Boolean {
        return try {
            networkExecutor.execute(work)
            true
        } catch (_: RejectedExecutionException) {
            false
        }
    }

    override fun close() {
        activeConnection = null
        connectionStore = null
        networkExecutor.shutdownNow()
    }
}
