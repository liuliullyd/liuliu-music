# Only dynamic entry points need application-specific rules. RN/JNI/Media3
# retain their dependency consumer rules; never keep com.liuliu.agentmusic.**.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault

# React Native discovers these methods by annotation and exposes their names.
-keepclassmembers class com.liuliu.agentmusic.** {
    @com.facebook.react.bridge.ReactMethod <methods>;
}

# Imported scripts call these names through WebView's JavascriptInterface.
# The RuntimeBridge class may be renamed; the exposed methods must survive.
-keepclassmembers class com.liuliu.agentmusic.** {
    @android.webkit.JavascriptInterface <methods>;
}
