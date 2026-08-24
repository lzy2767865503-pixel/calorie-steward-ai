package com.clinicalclarity.app.ui.scan

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.clinicalclarity.app.data.camera.BarcodeAnalyzer
import com.clinicalclarity.app.ui.ScanMode
import com.clinicalclarity.app.ui.theme.ClinicalNavy
import com.clinicalclarity.app.ui.theme.ClinicalTeal
import java.io.File

@Composable
fun CameraCapture(
    scanMode: ScanMode,
    onCaptured: (File) -> Unit,
    onBarcode: (String) -> Unit,
    onOpenGallery: () -> Unit,
    onError: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var permissionGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> permissionGranted = granted }

    LaunchedEffect(Unit) {
        if (!permissionGranted) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    if (!permissionGranted) {
        CameraPermissionPanel(
            onRequestPermission = { permissionLauncher.launch(Manifest.permission.CAMERA) },
            onOpenGallery = onOpenGallery,
            modifier = modifier,
        )
        return
    }

    val mainExecutor = remember(context) { ContextCompat.getMainExecutor(context) }
    val controller = remember(context) {
        LifecycleCameraController(context).apply {
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            setEnabledUseCases(CameraController.IMAGE_CAPTURE or CameraController.IMAGE_ANALYSIS)
        }
    }
    DisposableEffect(controller, lifecycleOwner) {
        controller.bindToLifecycle(lifecycleOwner)
        onDispose { controller.unbind() }
    }
    DisposableEffect(controller) {
        val initialization = controller.initializationFuture
        initialization.addListener(
            {
                runCatching {
                    initialization.get()
                    val availableSelector = when {
                        controller.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) -> CameraSelector.DEFAULT_BACK_CAMERA
                        controller.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) -> CameraSelector.DEFAULT_FRONT_CAMERA
                        else -> null
                    }
                    if (availableSelector == null) {
                        onError("设备没有可用相机，请从相册选择照片。")
                    } else if (controller.cameraSelector != availableSelector) {
                        controller.cameraSelector = availableSelector
                    }
                }.onFailure {
                    onError("相机初始化失败，仍可从相册选择照片。")
                }
            },
            mainExecutor,
        )
        val analyzer = BarcodeAnalyzer(onBarcode)
        controller.setImageAnalysisAnalyzer(mainExecutor, analyzer)
        onDispose {
            controller.clearImageAnalysisAnalyzer()
            analyzer.close()
        }
    }

    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(430.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(Color(0xFF0C1725)),
        ) {
            AndroidView(
                factory = { viewContext ->
                    PreviewView(viewContext).apply {
                        scaleType = PreviewView.ScaleType.FILL_CENTER
                        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                        this.controller = controller
                    }
                },
                update = { it.controller = controller },
                modifier = Modifier.fillMaxSize(),
            )

            CameraGuide(
                scanMode = scanMode,
                modifier = Modifier.align(Alignment.Center),
            )

            Text(
                text = if (scanMode == ScanMode.PACKAGED) "对准条码，或拍摄完整营养标签" else "让餐盘完整入镜 · 保持光线均匀",
                color = Color.White,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 18.dp)
                    .background(Color.Black.copy(alpha = 0.48f), RoundedCornerShape(99.dp))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )

            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(horizontal = 28.dp, vertical = 22.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(
                    onClick = onOpenGallery,
                    modifier = Modifier
                        .size(52.dp)
                        .background(Color.Black.copy(alpha = 0.52f), CircleShape),
                ) {
                    Icon(Icons.Outlined.PhotoLibrary, contentDescription = "从相册选择", tint = Color.White)
                }

                IconButton(
                    onClick = {
                        val target = File(context.cacheDir, "capture_${System.currentTimeMillis()}.jpg")
                        val options = ImageCapture.OutputFileOptions.Builder(target).build()
                        controller.takePicture(
                            options,
                            mainExecutor,
                            object : ImageCapture.OnImageSavedCallback {
                                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                                    onCaptured(target)
                                }

                                override fun onError(exception: ImageCaptureException) {
                                    target.delete()
                                    onError(exception.message ?: "拍摄失败，请重试。")
                                }
                            },
                        )
                    },
                    modifier = Modifier
                        .size(76.dp)
                        .background(Color.White, CircleShape)
                        .border(5.dp, Color.White.copy(alpha = 0.48f), CircleShape),
                ) {
                    Icon(
                        Icons.Outlined.CameraAlt,
                        contentDescription = if (scanMode == ScanMode.PACKAGED) "拍摄营养标签" else "拍摄餐食",
                        tint = ClinicalNavy,
                        modifier = Modifier.size(32.dp),
                    )
                }

                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(52.dp)
                        .background(Color.Black.copy(alpha = 0.52f), CircleShape),
                ) {
                    Icon(
                        if (scanMode == ScanMode.PACKAGED) Icons.Outlined.QrCodeScanner else Icons.Outlined.CameraAlt,
                        contentDescription = null,
                        tint = Color.White,
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = if (scanMode == ScanMode.PACKAGED) {
                "条码命中后将使用本地审核数据库精确计算"
            } else {
                "照片会移除 EXIF/GPS；已收录条码也会自动识别"
            },
            color = Color(0xFF667085),
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun CameraGuide(scanMode: ScanMode, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(if (scanMode == ScanMode.PACKAGED) 12.dp else 120.dp)
    Box(
        modifier = modifier
            .size(
                width = if (scanMode == ScanMode.PACKAGED) 250.dp else 280.dp,
                height = if (scanMode == ScanMode.PACKAGED) 150.dp else 245.dp,
            )
            .border(2.dp, ClinicalTeal.copy(alpha = 0.95f), shape),
    )
}

@Composable
private fun CameraPermissionPanel(
    onRequestPermission: () -> Unit,
    onOpenGallery: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .height(430.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Color(0xFFF5F8FB))
            .padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.CameraAlt, contentDescription = null, tint = ClinicalTeal, modifier = Modifier.size(46.dp))
        Spacer(Modifier.height(18.dp))
        Text("需要相机权限才能拍摄餐食", fontWeight = FontWeight.Bold, color = ClinicalNavy)
        Spacer(Modifier.height(8.dp))
        Text("也可不授权，直接从相册选择照片。", color = Color(0xFF667085), fontSize = 13.sp)
        Spacer(Modifier.height(22.dp))
        Button(
            onClick = onRequestPermission,
            colors = ButtonDefaults.buttonColors(containerColor = ClinicalNavy),
        ) { Text("授予相机权限") }
        Button(
            onClick = onOpenGallery,
            colors = ButtonDefaults.buttonColors(containerColor = ClinicalTeal),
        ) { Text("从相册选择") }
    }
}
