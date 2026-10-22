package com.liuliu.agentmusic

/** The edge ring is two pixels wide on the 24px thumbnail (about 8% per side). */
internal fun weightedCoverTone(width: Int, height: Int, edgesOnly: Boolean, pixelAt: (Int, Int) -> Int): String? {
  val border = 2
  var red = 0.0
  var green = 0.0
  var blue = 0.0
  var weight = 0.0
  for (y in 0 until height) for (x in 0 until width) {
    if (edgesOnly && x >= border && y >= border && x < width - border && y < height - border) continue
    val pixel = pixelAt(x, y)
    val alpha = ((pixel ushr 24) and 255) / 255.0
    if (alpha < 0.4) continue
    val r = ((pixel ushr 16) and 255).toDouble()
    val g = ((pixel ushr 8) and 255).toDouble()
    val b = (pixel and 255).toDouble()
    val saturation = (maxOf(r, g, b) - minOf(r, g, b)) / 255.0
    val luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
    val pixelWeight = alpha * (0.65 + saturation * 1.35) * (0.55 + luminance * 0.45)
    red += r * pixelWeight
    green += g * pixelWeight
    blue += b * pixelWeight
    weight += pixelWeight
  }
  if (weight <= 0.0) return null
  return String.format("#%02X%02X%02X", (red / weight).toInt().coerceIn(0, 255), (green / weight).toInt().coerceIn(0, 255), (blue / weight).toInt().coerceIn(0, 255))
}
