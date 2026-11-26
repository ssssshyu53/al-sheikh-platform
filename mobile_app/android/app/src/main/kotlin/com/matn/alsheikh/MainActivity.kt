package com.matn.alsheikh

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity

class MainActivity: FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // منع تصوير الشاشة أو تسجيل الفيديو نهائياً على هواتف الأندرويد (تظهر الشاشة سوداء لأي برنامج تسجيل)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
    }
}
