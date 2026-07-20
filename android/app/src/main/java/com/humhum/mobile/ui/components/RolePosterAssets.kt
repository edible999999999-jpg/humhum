package com.humhum.mobile.ui.components

import androidx.annotation.DrawableRes
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R

@DrawableRes
fun roomPosterBackgroundFor(role: MobileRoleDashboard.Role): Int = when (role) {
    MobileRoleDashboard.Role.HUMI -> R.drawable.room_humi
    MobileRoleDashboard.Role.HYPE -> R.drawable.room_hype
    MobileRoleDashboard.Role.HUSH -> R.drawable.room_hush
    MobileRoleDashboard.Role.HEXA -> R.drawable.room_hexa
}
