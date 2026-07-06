package com.slushanka.audioplayer.dev

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.*

class PlaybackServiceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName() = "PlaybackService"

    @ReactMethod
    fun start(title: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, PlaybackForegroundService::class.java)
            intent.putExtra(PlaybackForegroundService.EXTRA_TITLE, title)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            val context = reactApplicationContext
            context.stopService(Intent(context, PlaybackForegroundService::class.java))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}
