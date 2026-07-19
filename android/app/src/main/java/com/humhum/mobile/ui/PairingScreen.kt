package com.humhum.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.ConnectionStatus
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.theme.Humi
import com.humhum.mobile.ui.theme.HumiSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.components.RoleRoomBackground

@Composable
fun PairingScreen(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    var recoveryOpen by rememberSaveable { mutableStateOf(false) }
    var address by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var fingerprint by rememberSaveable { mutableStateOf("") }
    var deviceName by rememberSaveable { mutableStateOf("") }
    val busy = state.connection == ConnectionStatus.SCANNING || state.connection == ConnectionStatus.PAIRING

    RoleRoomBackground(
        role = MobileRoleDashboard.Role.HUMI,
        modifier = modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("HUMHUM", style = MaterialTheme.typography.displaySmall, color = Ink)
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("连接这台电脑", style = MaterialTheme.typography.headlineMedium, color = Ink)
                Text(
                    "在 Mac 的 Hexa 右上角打开移动访问，然后扫描配对二维码。",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Muted,
                )
            }
            Button(
                onClick = callbacks.onScanPairing,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Humi),
            ) {
                Icon(Icons.Outlined.QrCodeScanner, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text("扫描电脑配对二维码")
            }
            OutlinedButton(
                onClick = callbacks.onPastePairing,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(8.dp),
            ) {
                Icon(Icons.Outlined.ContentPaste, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text("粘贴配对资料")
            }
            if (busy) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = Humi)
                    Text(state.statusMessage, style = MaterialTheme.typography.bodyMedium, color = Muted)
                }
            }
            state.errorMessage?.let { error ->
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.error.copy(alpha = 0.08f),
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.25f)),
                ) {
                    Row(modifier = Modifier.padding(13.dp), verticalAlignment = Alignment.Top) {
                        Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.size(9.dp))
                        Text(error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            Text(
                text = if (recoveryOpen) "收起连接恢复" else "连接遇到问题",
                style = MaterialTheme.typography.labelLarge,
                color = Humi,
                modifier = Modifier.fillMaxWidth().clickable { recoveryOpen = !recoveryOpen }.padding(vertical = 14.dp),
            )
            if (recoveryOpen) {
                Column(
                    modifier = Modifier.fillMaxWidth().testTag("manual-pairing-fields"),
                    verticalArrangement = Arrangement.spacedBy(11.dp),
                ) {
                    Text("仅在二维码无法使用时手动输入", style = MaterialTheme.typography.bodyMedium, color = Muted)
                    OutlinedTextField(
                        value = address,
                        onValueChange = { address = it },
                        label = { Text("Mac 地址") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it },
                        label = { Text("一次性配对码") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = fingerprint,
                        onValueChange = { fingerprint = it },
                        label = { Text("证书指纹") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = deviceName,
                        onValueChange = { deviceName = it },
                        label = { Text("设备名称（可选）") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        singleLine = true,
                    )
                    Button(
                        onClick = { callbacks.onManualPair(address, code, fingerprint, deviceName) },
                        enabled = !busy && address.isNotBlank() && code.isNotBlank() && fingerprint.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Humi),
                    ) { Text("安全配对") }
                }
            }
            Text(
                "默认只在你明确操作时连接。配对资料保存在 Android 私有应用存储中；健康队列与离线快照使用 Android Keystore 加密。",
                style = MaterialTheme.typography.bodyMedium,
                color = Muted,
            )
        }
    }
}
