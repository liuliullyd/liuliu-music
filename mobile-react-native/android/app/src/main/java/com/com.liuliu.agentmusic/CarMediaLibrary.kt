package com.liuliu.agentmusic

import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors

/** Directory callbacks add browsing to the existing media session; all transport stays shared. */
@UnstableApi
internal class CarMediaLibrary(private val controls: MediaSession.Callback,
  private val search: CarLibrarySearch = CarLibrarySearch(),
  private val browse: (String, Int, Int) -> ListenableFuture<List<MediaItem>> =
    { parent, page, size -> CarLibraryState.request(parent, page, size, strict = true) },
  private val notifySearch: (MediaLibraryService.MediaLibrarySession, MediaSession.ControllerInfo, String, Int, MediaLibraryService.LibraryParams) -> Unit =
    { session, controller, query, count, params -> session.notifySearchResultChanged(controller, query, count, params) },
) : MediaLibraryService.MediaLibrarySession.Callback,
  MediaSession.Callback by controls {
  private val observedParents = linkedSetOf(CarLibraryState.ROOT)
  /** Availability refreshes every visited node. Metadata updates keep remote page caches untouched. */
  fun notifyChanged(session: MediaLibraryService.MediaLibrarySession, availabilityChanged: Boolean) {
    if (availabilityChanged) search.clear()
    observedParents.toList().filter { availabilityChanged || !it.startsWith("car:linked:") }.forEach { parent ->
      session.notifyChildrenChanged(parent, if (CarLibraryState.ready) Int.MAX_VALUE else 1, null)
    }
  }
  override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
    val original = controls.onConnect(session, controller)
    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
      .setAvailablePlayerCommands(original.availablePlayerCommands)
      .setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
        .apply { original.availableSessionCommands.commands.forEach { add(it) } }.build())
      .setMediaButtonPreferences(original.mediaButtonPreferences).build()
  }
  private fun item(id: String, title: String, browsable: Boolean) = MediaItem.Builder().setMediaId(id)
    .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setIsBrowsable(browsable).setIsPlayable(false).build()).build()
  private fun effectivePage(page: Int, options: MediaLibraryService.LibraryParams?): Int? {
    val extras = options?.extras
    val actual = if (extras?.containsKey("ucar.media.bundle.PAGE_INDEX") == true) {
      // CarWith uses this vendor key, while Media3's legacy adapter only maps the
      // standard EXTRA_PAGE key. A wrong vendor field type must not silently become 0.
      extras.get("ucar.media.bundle.PAGE_INDEX") as? Int ?: return null
    } else page
    return actual.takeIf { it in 0..100_000 }
  }
  private fun pagedItems(items: List<MediaItem>, hasMore: Boolean, nextPage: Int): List<MediaItem> {
    if (items.isEmpty()) return items
    // CarWith p9.a.W reads pagination from the last MediaDescription's extras.
    // LibraryResult.params alone is not carried to legacy onChildrenLoaded items.
    val last = items.last()
    val extras = Bundle(last.mediaMetadata.extras ?: Bundle.EMPTY).apply {
      putBoolean("ucar.media.bundle.HAS_MORE", hasMore)
      putInt("ucar.media.bundle.NEXT_PAGE_INDEX", if (hasMore) nextPage else 0)
    }
    val result = items.dropLast(1) + last.buildUpon().setMediaMetadata(last.mediaMetadata.buildUpon().setExtras(extras).build()).build()
    CarLibraryState.remember(result)
    return result
  }
  private fun params(original: MediaLibraryService.LibraryParams?, hasMore: Boolean? = null, nextPage: Int = 0,
    scope: String? = null): MediaLibraryService.LibraryParams = MediaLibraryService.LibraryParams.Builder()
    .setOffline(original?.isOffline == true).setRecent(original?.isRecent == true).setSuggested(original?.isSuggested == true)
    .setExtras(Bundle().apply {
      original?.extras?.let { putAll(it) }
      putBoolean("UCAR", true)
      if (hasMore != null) {
        putBoolean("ucar.media.bundle.HAS_MORE", hasMore)
        putInt("ucar.media.bundle.NEXT_PAGE_INDEX", if (hasMore) nextPage else 0)
      }
      if (scope != null) putString("com.liuliu.agentmusic.SEARCH_SCOPE", scope)
    }).build()
  override fun onGetLibraryRoot(session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo,
    params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
    Futures.immediateFuture(LibraryResult.ofItem(CarLibraryState.root(), params(params)))
  override fun onGetChildren(session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo,
    parentId: String, page: Int, pageSize: Int, params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val actualPage = effectivePage(page, params)
    if (parentId.startsWith("car:")) {
      observedParents.remove(parentId); observedParents.add(parentId)
      if (observedParents.size > 128) observedParents.remove(observedParents.first { it != CarLibraryState.ROOT })
    }
    if (actualPage == null || pageSize < 1 || !parentId.startsWith("car:"))
      return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
    if (!CarLibraryState.ready) return Futures.immediateFuture(LibraryResult.ofItemList(
      pagedItems(if (actualPage == 0) listOf(item("car:open-phone", "请先在手机打开应用并完成启动", false)) else emptyList(), false, 0), params(params, false)))
    val size = minOf(pageSize, 20)
    // Both slices share the same parent/cache and run in parallel. In particular this does
    // not open a linked playlist's next-parent folder or fetch its next remote music page.
    val current = browse(parentId, actualPage, size)
    val next = browse(parentId, actualPage + 1, size)
    return Futures.catching(Futures.transform(Futures.allAsList(current, next), { slices ->
      check(CarLibraryState.ready) { "手机曲库已关闭" }
      val values = requireNotNull(slices)
      val more = values[1].isNotEmpty()
      LibraryResult.ofItemList(pagedItems(values[0], more, actualPage + 1), params(params, more, actualPage + 1))
    }, MoreExecutors.directExecutor()), Exception::class.java,
      { LibraryResult.ofError<ImmutableList<MediaItem>>(LibraryResult.RESULT_ERROR_INVALID_STATE) }, MoreExecutors.directExecutor())
  }
  override fun onGetItem(session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo,
    mediaId: String): ListenableFuture<LibraryResult<MediaItem>> =
    Futures.immediateFuture(CarLibraryState.item(mediaId)?.let { LibraryResult.ofItem(it, null) }
      ?: LibraryResult.ofError(LibraryResult.RESULT_ERROR_NOT_SUPPORTED))
  override fun onSearch(session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo,
    query: String, params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<Void>> = searchResult(
      search.request(query, 0, CarLibrarySearch.PAGE_SIZE, reset = true)) { result ->
      val replyParams = params(params, result.hasMore, result.nextPage, result.scope)
      // This is the number actually loaded, not an invented remote total.
      notifySearch(session, browser, query, result.knownCount, replyParams)
      LibraryResult.ofVoid(replyParams)
    }
  override fun onGetSearchResult(session: MediaLibraryService.MediaLibrarySession, browser: MediaSession.ControllerInfo,
    query: String, page: Int, pageSize: Int, params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val actualPage = effectivePage(page, params)
      ?: return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
    return searchResult(search.request(query, actualPage, pageSize)) { result ->
      LibraryResult.ofItemList(pagedItems(result.items, result.hasMore, result.nextPage), params(params, result.hasMore, result.nextPage, result.scope))
    }
  }
  private fun <T : Any> searchResult(future: ListenableFuture<CarLibrarySearch.Window>,
    build: (CarLibrarySearch.Window) -> LibraryResult<T>): ListenableFuture<LibraryResult<T>> =
    Futures.catching(Futures.transform(future, { result -> build(requireNotNull(result)) }, MoreExecutors.directExecutor()),
      Exception::class.java, { LibraryResult.ofError<T>(LibraryResult.RESULT_ERROR_INVALID_STATE) }, MoreExecutors.directExecutor())
  private fun voiceSearch(item: MediaItem): Boolean = item.requestMetadata.searchQuery != null ||
    item.requestMetadata.extras?.let { extras -> extras.getBoolean("UCAR") &&
      listOf("song", "singer", "album", "presetList", "genre").any { extras.containsKey(it) } } == true
  override fun onAddMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo,
    mediaItems: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> {
    if (mediaItems.any(::voiceSearch)) {
      if (mediaItems.size != 1) return Futures.immediateFailedFuture(IllegalArgumentException("请一次搜索一首歌曲"))
      val request = mediaItems.single().requestMetadata
      val query = try { CarLibrarySearch.voiceQuery(request.searchQuery,
        listOf("song", "singer", "album", "presetList", "genre").associateWith { request.extras?.getString(it).orEmpty() })
      } catch (error: IllegalArgumentException) { return Futures.immediateFailedFuture(error) }
      return Futures.transform(search.request(query, 0, CarLibrarySearch.PAGE_SIZE, reset = true), { found ->
        // Search only supplies an issued directory ID. MediaTransportPlayer selects it
        // through the existing phone queue, source checks and actual-player identity ack.
        val selected = found?.items?.firstOrNull() ?: error("未找到可播放歌曲")
        mutableListOf(selected)
      }, MoreExecutors.directExecutor())
    }
    // Only IDs issued by our browser may arrive without a URI. The transport wrapper
    // dispatches them to React before ExoPlayer ever sees them.
    if (mediaItems.any { it.mediaId.startsWith("car:") }) {
      val resolved = mediaItems.map { CarLibraryState.item(it.mediaId) }
      if (!CarLibraryState.ready || resolved.any { it == null || !it.mediaId.startsWith("car:track:") || it.mediaMetadata.isPlayable != true })
        return Futures.immediateFailedFuture(IllegalArgumentException("请先在手机打开应用并从歌单选择歌曲"))
      return Futures.immediateFuture(resolved.filterNotNull().toMutableList())
    }
    return Futures.immediateFuture(mediaItems)
  }
  override fun onSetMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo,
    mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
    val voice = mediaItems.any(::voiceSearch)
    if (!voice && mediaItems.none { it.mediaId.startsWith("car:") })
      return controls.onSetMediaItems(session, controller, mediaItems, startIndex, startPositionMs)
    return Futures.transform(onAddMediaItems(session, controller, mediaItems), { resolved ->
      MediaSession.MediaItemsWithStartPosition(requireNotNull(resolved), if (voice) 0 else startIndex, if (voice) 0 else startPositionMs)
    }, MoreExecutors.directExecutor())
  }
}
