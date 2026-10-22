package com.liuliu.agentmusic

internal fun shouldRejectMissingPersistedState(
  rawState: String?,
  firstInstallTime: Long,
  lastUpdateTime: Long,
): Boolean = rawState == null && lastUpdateTime > firstInstallTime
