package com.humhum.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.QrCode
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Security
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
import com.humhum.mobile.app.ConnectionStatus
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.theme.Humi
import com.humhum.mobile.ui.theme.HumiSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.Canvas

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

    Box(modifier = modifier.fillMaxSize().background(Canvas)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("HUMHUM", style = MaterialTheme.typography.titleLarge, color = Ink)
                Spacer(Modifier.weight(1f))
                Icon(
                    Icons.Outlined.Security,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = Color(0xFF22A566),
                )
                Spacer(Modifier.size(5.dp))
                Text("本地优先", style = MaterialTheme.typography.labelMedium, color = Color(0xFF218F5B))
            }
            Spacer(Modifier.height(30.dp))
            Surface(
                modifier = Modifier.size(88.dp).align(Alignment.CenterHorizontally),
                shape = RoundedCornerShape(24.dp),
                color = HumiSoft,
                border = BorderStroke(1.dp, Humi.copy(alpha = 0.14f)),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.QrCode,
                        contentDescription = null,
                        modifier = Modifier.size(38.dp),
                        tint = Humi,
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("连接你的 Mac", style = MaterialTheme.typography.headlineMedium, color = Ink)
                Text(
                    "在电脑端 Hexa 打开移动访问，扫描二维码即可完成安全配对。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            }
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = callbacks.onScanPairing,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Humi),
            ) {
                Icon(Icons.Outlined.QrCodeScanner, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text("扫描配对二维码")
            }
            OutlinedButton(
                onClick = callbacks.onPastePairing,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, Humi.copy(alpha = 0.22f)),
            ) {
                Icon(Icons.Outlined.ContentPaste, contentDescription = null, tint = Ink)
                Spacer(Modifier.size(8.dp))
                Text("粘贴配对资料", color = Ink)
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
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.25f)),
                ) {
                    Row(modifier = Modifier.padding(13.dp), verticalAlignment = Alignment.Top) {
                        Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.size(9.dp))
                        Text(error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            Row(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .clickable { recoveryOpen = !recoveryOpen }
                    .padding(horizontal = 12.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.HelpOutline,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = Muted,
                )
                Text(
                    text = if (recoveryOpen) "收起连接恢复" else "连接遇到问题",
                    style = MaterialTheme.typography.labelLarge,
                    color = Muted,
                )
            }
            if (recoveryOpen) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("manual-pairing-fields")
                        .padding(top = 4.dp),
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
            Spacer(Modifier.height(12.dp))
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = Color.Transparent,
            ) {
                Text(
                    "连接凭证保存在 Android 私有应用存储中；个人上下文与编排权限仍需在 Mac 端分别授权。",
                    style = MaterialTheme.typography.labelMedium,
                    color = Muted,
                )
            }
        }
    }
}
