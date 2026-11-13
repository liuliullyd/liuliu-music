package com.liuliu.agentmusic

import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import org.junit.Assert.*
import org.junit.Test

class PlaybackUrlFailureTest {
  private fun rejected(code: Int) = HttpDataSource.InvalidResponseCodeException(code, "rejected", null,
    emptyMap(), dataSpec(), ByteArray(0))
  private fun dataSpec(): DataSpec {
    // URI parsing is outside this HTTP cause-classification test.
    val allocator = Class.forName("sun.misc.Unsafe")
    val field = allocator.getDeclaredField("theUnsafe").apply { isAccessible = true }
    return allocator.getMethod("allocateInstance", Class::class.java)
      .invoke(field.get(null), DataSpec::class.java) as DataSpec
  }
  private fun recoverable(error: Throwable?): Boolean {
    val method = MusicPlaybackService.Companion.javaClass.getDeclaredMethod("isExpiredUrl", Throwable::class.java)
    method.isAccessible = true
    return method.invoke(MusicPlaybackService.Companion, error) as Boolean
  }
  @Test fun deniedOrMissingSignedUrlsUseTheExistingBoundedReparsePath() {
    for (code in listOf(401, 403, 404, 410)) {
      assertTrue("HTTP $code must allow one fresh resolution", recoverable(IllegalStateException(rejected(code))))
    }
  }
  @Test fun unrelatedFailuresDoNotBecomeUrlExpiry() {
    for (code in listOf(400, 408, 429, 500, 502, 503)) assertFalse("HTTP $code", recoverable(rejected(code)))
    assertFalse(recoverable(java.net.SocketTimeoutException()))
    assertFalse(recoverable(java.io.FileNotFoundException()))
    assertFalse(recoverable(null))
  }
}
