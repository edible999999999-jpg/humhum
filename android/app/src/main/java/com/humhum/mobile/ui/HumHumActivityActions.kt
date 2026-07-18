package com.humhum.mobile.ui

import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.app.HealthPermission

interface HumHumActivityActions {
    fun selectRole(role: MobileRoleDashboard.Role)
    fun openSettings()
    fun closeSettings()
    fun refresh()
    fun adjustToday()
    fun scanPairing()
    fun pastePairing()
    fun manualPair(address: String, code: String, fingerprint: String, deviceName: String)
    fun disconnect()
    fun requestHealthPermission(permission: HealthPermission)
    fun setBackgroundHealth(enabled: Boolean)
    fun setMonitor(enabled: Boolean)
    fun openDeviceCare()
    fun deleteLocalData()
    fun openConversation(session: Models.Session)
    fun closeConversation()
    fun resolve(session: Models.Session, action: Models.Action, approved: Boolean)
    fun sendFollowUp(session: Models.Session, message: String)
}
