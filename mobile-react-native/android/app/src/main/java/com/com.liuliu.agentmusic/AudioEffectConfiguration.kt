package com.liuliu.agentmusic

import org.json.JSONObject

/** Parses both bridge requests and persisted native state through identical validation. */
object AudioEffectConfiguration {
  fun profile(gains: DoubleArray, json: String): TenBandTuning.Profile {
    val config=JSONObject(json)
    val a=config.optJSONObject("advanced") ?: JSONObject()
    fun amount(key: String): Double {
      val value=a.optDouble(key,0.0)
      require(value.isFinite() && value in 0.0..100.0) { "Invalid advanced effect: $key" }
      return value/100
    }
    val mode=a.optString("mode","headphones")
    require(mode in setOf("headphones","speakers","car")) { "Invalid output mode" }
    val headphone=config.optJSONObject("headphone")
    val filters=headphone?.optJSONArray("filters")
    val peq=Array(filters?.length() ?: 0) { index ->
      val f=filters!!.getJSONObject(index)
      HeadphoneDspEngine.Filter(f.getString("type"),f.getDouble("frequency"),f.getDouble("gain"),f.getDouble("q"))
    }
    val preamp=headphone?.getDouble("preampDb") ?: 0.0
    require(preamp.isFinite() && preamp in -30.0..12.0 && peq.size<=128) { "Invalid headphone preamp" }
    val dynamics=amount("dynamics")
    val compressor=a.optJSONObject("compressor")
    val dsp=EffectDspSettings(
      if(a.has("width")) amount("width") else -1.0,
      a.optDouble("preampDb",0.0),
      compressor?.getDouble("ratio") ?: (1+2*dynamics),
      compressor?.getDouble("thresholdDb") ?: -18.0,
      compressor?.getDouble("attackMs") ?: 12.0,
      compressor?.getDouble("releaseMs") ?: 120.0,
      compressor?.getDouble("kneeDb") ?: 0.0,
      if(a.has("loudness")) a.getBoolean("loudness") else false,
    )
    return TenBandTuning.configured(gains,amount("clarity"),amount("reverb"),amount("surround"),amount("bass"),dynamics,mode,peq,preamp,dsp)
  }
}
