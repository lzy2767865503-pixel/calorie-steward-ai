package com.clinicalclarity.app.data.image

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File

class ImageSanitizer(private val cacheDir: File) {
    fun sanitize(source: File): File {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "无法读取照片" }

        var sample = 1
        while (bounds.outWidth / sample > MAX_EDGE * 2 || bounds.outHeight / sample > MAX_EDGE * 2) sample *= 2
        val decoded = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: error("无法解码照片")
        val bitmap = decoded.applyExifOrientation(source)
            .also { if (it !== decoded) decoded.recycle() }

        val scale = minOf(1.0, MAX_EDGE.toDouble() / maxOf(bitmap.width, bitmap.height))
        val outputBitmap = if (scale < 1.0) {
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * scale).toInt(),
                (bitmap.height * scale).toInt(),
                true,
            ).also { if (it !== bitmap) bitmap.recycle() }
        } else bitmap

        val output = File(cacheDir, "sanitized_${System.currentTimeMillis()}.jpg")
        output.outputStream().use { stream ->
            check(outputBitmap.compress(Bitmap.CompressFormat.JPEG, 86, stream)) { "照片压缩失败" }
        }
        outputBitmap.recycle()
        return output
    }

    companion object {
        private const val MAX_EDGE = 1600
    }
}

private fun Bitmap.applyExifOrientation(source: File): Bitmap {
    val orientation = runCatching {
        ExifInterface(source).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                setRotate(90f)
                postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                setRotate(-90f)
                postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
        }
    }
    if (matrix.isIdentity) return this
    return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
}
