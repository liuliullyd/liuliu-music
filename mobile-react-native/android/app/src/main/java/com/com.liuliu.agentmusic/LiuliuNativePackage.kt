package com.liuliu.agentmusic

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LiuliuNativePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(LiuliuCarConnectionModule(context), LiuliuPlayerModule(context), LiuliuStorageModule(context), LiuliuCoverModule(context), LiuliuNetworkModule(context), LiuliuDesktopLyricsModule(context), LiuliuMediaLibraryModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
