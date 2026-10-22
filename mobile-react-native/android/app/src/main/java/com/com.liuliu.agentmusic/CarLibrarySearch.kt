package com.liuliu.agentmusic

import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONObject

/** Media3 paging adapter over the same phone-owned search used by car transports. */
@UnstableApi
internal class CarLibrarySearch(
  private val fetch: (String, Int, Boolean) -> ListenableFuture<Page> = ::fetchShared,
  private val ready: () -> Boolean = { CarLibraryState.ready },
  private val remember: (List<MediaItem>) -> Unit = CarLibraryState::remember,
  private val clock: () -> Long = SystemClock::elapsedRealtime,
) {
  data class Page(val items: List<MediaItem>, val hasMore: Boolean, val scope: String = "online")
  data class Window(val items: List<MediaItem>, val hasMore: Boolean, val nextPage: Int,
    val knownCount: Int, val scope: String)
  private var query = ""
  private var generation = 0L
  private var touched = 0L
  private val pages = sortedMapOf<Int, Page>()

  @Synchronized fun clear() { query = ""; generation++; pages.clear(); touched = 0L }

  fun request(rawQuery: String, page: Int, pageSize: Int, reset: Boolean = false): ListenableFuture<Window> {
    val key = rawQuery.trim().take(160)
    if (!ready()) { clear(); return failed("请先在手机打开应用并完成启动") }
    if (key.isEmpty() || page < 0 || pageSize < 1) return failed("搜索或分页参数无效")
    // Legacy browsers may ask for MAX_VALUE. Every response still contains at most 20 rows.
    val size = minOf(pageSize, PAGE_SIZE)
    val offset = page.toLong() * size
    if (offset >= PAGE_SIZE * MAX_PAGES) return failed("搜索页已达上限，请重新搜索")
    val first = (offset / PAGE_SIZE).toInt()
    val last = ((offset + size - 1) / PAGE_SIZE).toInt().coerceAtMost(MAX_PAGES - 1)
    val token: Long
    synchronized(this) {
      if (reset || query != key || clock() - touched >= TTL_MS) {
        clear(); query = key
      }
      if (first > 0 && !pages.containsKey(first - 1)) return failed("请依次读取搜索页")
      token = generation; touched = clock()
    }
    // Revalidate the requested source page through shared search, including cached reads.
    // A different local search may have invalidated its generation since our previous call.
    return Futures.transformAsync(load(key, first, reset, token), { initial ->
      val source = requireNotNull(initial)
      val following = if (last > first && source.hasMore && source.items.size == PAGE_SIZE)
        load(key, last, false, token) else Futures.immediateFuture<Page?>(null)
      Futures.transform(following, { tail ->
        synchronized(this) {
          checkCurrent(key, token)
          val rows = source.items + (tail?.items ?: emptyList())
          val from = (offset % PAGE_SIZE).toInt()
          val items = rows.drop(from).take(size)
          val more = from + items.size < rows.size || (tail ?: source).hasMore
          remember(items)
          var count = 0
          for (index in 0 until MAX_PAGES) {
            val known = pages[index] ?: break
            count += known.items.size
          }
          Window(items, more, if (more) page + 1 else 0, count, source.scope)
        }
      }, MoreExecutors.directExecutor())
    }, MoreExecutors.directExecutor())
  }

  private fun load(key: String, page: Int, reset: Boolean, token: Long): ListenableFuture<Page> {
    val future = try { fetch(key, page, reset) } catch (error: Exception) { return Futures.immediateFailedFuture(error) }
    return Futures.transform(future, { value ->
      synchronized(this) {
        checkCurrent(key, token)
        val result = requireNotNull(value)
        require(result.items.size <= PAGE_SIZE && result.items.all {
          it.mediaId.startsWith("car:track:") && it.mediaMetadata.isPlayable == true && it.mediaMetadata.isBrowsable == false
        }) { "搜索返回了无效歌曲" }
        if (page == 0 && pages[0]?.items?.map { it.mediaId } != result.items.map { it.mediaId }) pages.clear()
        pages[page] = result; touched = clock()
        result
      }
    }, MoreExecutors.directExecutor())
  }

  private fun checkCurrent(key: String, token: Long) {
    check(ready() && query == key && generation == token && clock() - touched < TTL_MS) { "搜索会话已失效，请重新搜索" }
  }
  private fun failed(message: String): ListenableFuture<Window> = Futures.immediateFailedFuture(IllegalStateException(message))

  companion object {
    const val PAGE_SIZE = 20
    const val MAX_PAGES = 8
    private const val TTL_MS = 120_000L
    fun voiceQuery(query: String?, fields: Map<String, String>): String {
      require(fields["presetList"].isNullOrBlank() && fields["genre"].isNullOrBlank()) { "暂不支持按预设歌单或流派语音点播" }
      val structured = listOf("song", "singer", "album").mapNotNull { fields[it]?.trim()?.takeIf(String::isNotEmpty) }
      val keyword = (if (structured.isNotEmpty()) structured.distinct().joinToString(" ") else query.orEmpty())
        .trim().replace(Regex("\\s+"), " ").take(160)
      require(keyword.isNotEmpty()) { "请提供歌名、歌手或专辑搜索词" }
      return keyword
    }
    private fun fetchShared(query: String, page: Int, reset: Boolean): ListenableFuture<Page> =
      Futures.transform(CarConnectionState.request("search", JSONObject().put("query", query).put("page", page)
        .put("session", "local").put("reset", reset)), { reply ->
        val response = requireNotNull(reply)
        check(response.optBoolean("ok")) { response.optString("error", "搜索失败，请重试") }
        val rows = response.optJSONArray("result") ?: error("搜索结果缺失")
        require(rows.length() <= PAGE_SIZE) { "搜索结果超过分页上限" }
        val items = (0 until rows.length()).map { index ->
          val row = rows.getJSONObject(index)
          val parent = row.getString("parent")
          require(parent.startsWith("car:search:") && row.optBoolean("playable")) { "搜索歌曲身份无效" }
          val metadata = MediaMetadata.Builder().setTitle(row.getString("title")).setArtist(row.optString("artist"))
            .setAlbumTitle(row.optString("album"))
            .setIsBrowsable(false).setIsPlayable(true).setExtras(Bundle().apply { putString("carParent", parent) })
          row.optDouble("durationMs", -1.0).takeIf { it.isFinite() && it > 0 && it < 9_007_199_254_740_992.0 }
            ?.let { metadata.setDurationMs(it.toLong()) }
          row.optString("cover").takeIf { it.startsWith("https://") || it.startsWith("http://") || it.startsWith("content://") }
            ?.let { metadata.setArtworkUri(Uri.parse(it)) }
          MediaItem.Builder().setMediaId(row.getString("id")).setMediaMetadata(metadata.build()).build()
        }
        Page(items, response.optBoolean("hasMore"), response.optString("scope", "online"))
      }, MoreExecutors.directExecutor())
  }
}
