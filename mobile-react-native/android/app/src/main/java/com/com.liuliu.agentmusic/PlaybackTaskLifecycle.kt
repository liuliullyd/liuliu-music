package com.liuliu.agentmusic

/** Process-local transport permission, reopened only by the phone activity. */
internal class PlaybackTaskLifecycle {
  @Volatile var allowed = true
    private set
  private val removed = java.util.concurrent.CopyOnWriteArraySet<() -> Unit>()

  fun observeRemoval(listener: () -> Unit): () -> Unit {
    removed.add(listener)
    return { removed.remove(listener) }
  }

  fun removeTask() {
    if (!allowed) return
    allowed = false
    removed.toList().forEach { it() }
  }

  fun openActivity() { allowed = true }
}
