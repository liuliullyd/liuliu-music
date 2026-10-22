package com.liuliu.agentmusic;

/** Explicit algorithm parameters. No player, storage, device, or network dependency. */
public final class EffectDspSettings {
  public final double width, preampDb, ratio, thresholdDb, attackMs, releaseMs, kneeDb;
  public final boolean loudness;
  public EffectDspSettings(double width, double preampDb, double ratio, double thresholdDb,
      double attackMs, double releaseMs, double kneeDb, boolean loudness) {
    range(width,-1,1);range(preampDb,-30,12);range(ratio,1,12);range(thresholdDb,-60,0);
    range(attackMs,.1,200);range(releaseMs,5,3000);range(kneeDb,0,24);
    this.width=width;this.preampDb=preampDb;this.ratio=ratio;this.thresholdDb=thresholdDb;
    this.attackMs=attackMs;this.releaseMs=releaseMs;this.kneeDb=kneeDb;this.loudness=loudness;
  }
  private static void range(double value,double min,double max) {
    if(!Double.isFinite(value)||value<min||value>max)throw new IllegalArgumentException("Invalid DSP parameter");
  }
  public static EffectDspSettings legacy(double dynamics) {
    return new EffectDspSettings(-1,0,1+2*dynamics,-18,12,120,0,false);
  }
  /** Relative attenuation only, not calibrated ear-level SPL or ISO 226 numerical data. */
  public static double loudnessAmount(double attenuationDb, boolean muted) {
    if(muted||!Double.isFinite(attenuationDb))return 0;
    return Math.max(0,Math.min(1,(-attenuationDb-6)/24));
  }
  public double compressionGain(double envelope) {
    if(ratio<=1||envelope<=0)return 1;
    double over=20*Math.log10(envelope)-thresholdDb;
    double reduction;
    if(kneeDb>0&&over>-kneeDb/2&&over<kneeDb/2)
      reduction=(1/ratio-1)*Math.pow(over+kneeDb/2,2)/(2*kneeDb);
    else reduction=over>0?(1/ratio-1)*over:0;
    return Math.pow(10,reduction/20);
  }
  @Override public boolean equals(Object other) {
    if(!(other instanceof EffectDspSettings))return false;
    EffectDspSettings d=(EffectDspSettings)other;
    return width==d.width&&preampDb==d.preampDb&&ratio==d.ratio&&thresholdDb==d.thresholdDb&&
      attackMs==d.attackMs&&releaseMs==d.releaseMs&&kneeDb==d.kneeDb&&loudness==d.loudness;
  }
  @Override public int hashCode(){return java.util.Objects.hash(width,preampDb,ratio,thresholdDb,attackMs,releaseMs,kneeDb,loudness);}
}
