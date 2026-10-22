package com.liuliu.agentmusic;

/** Device-independent, frame-preserving tuning. No player, queue or network access. */
public final class TenBandTuning {
  public static final double[] FREQUENCIES = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};

  public static final class Profile {
    public final String name;
    private final double[] frequencies;
    private final double[] gains;
    public final double clarity, reverb, dynamics;
    public final double surround, bass, preampDb;
    public final String mode;
    public final HeadphoneDspEngine.Filter[] headphoneFilters;
    public final EffectDspSettings dsp;
    private Profile(String name, double[] frequencies, double[] gains,
        double clarity, double reverb, double dynamics) {
      this(name,frequencies,gains,clarity,reverb,0,0,dynamics,"speakers",new HeadphoneDspEngine.Filter[0],0);
    }
    private Profile(String name,double[] frequencies,double[] gains,double clarity,double reverb,double surround,double bass,double dynamics,String mode,HeadphoneDspEngine.Filter[] headphoneFilters,double preampDb) {
      this(name,frequencies,gains,clarity,reverb,surround,bass,dynamics,mode,headphoneFilters,preampDb,EffectDspSettings.legacy(dynamics));
    }
    private Profile(String name,double[] frequencies,double[] gains,double clarity,double reverb,double surround,double bass,double dynamics,String mode,HeadphoneDspEngine.Filter[] headphoneFilters,double preampDb,EffectDspSettings dsp) {
      this.name = name;
      this.frequencies = frequencies.clone();
      this.gains = gains.clone();
      this.clarity = clarity;
      this.reverb = reverb;
      this.dynamics = dynamics;
      this.surround=surround;this.bass=bass;this.mode=mode;this.headphoneFilters=headphoneFilters.clone();this.preampDb=preampDb;
      this.dsp=dsp;
    }
    public double[] gains() { return gains.clone(); }
    public double[] frequencies() { return frequencies.clone(); }
    @Override public boolean equals(Object other) {
      if (!(other instanceof Profile)) return false;
      Profile p = (Profile) other;
      return name.equals(p.name) && java.util.Arrays.equals(gains, p.gains)
          && java.util.Arrays.equals(frequencies, p.frequencies)
          && clarity == p.clarity && reverb == p.reverb && dynamics == p.dynamics && surround==p.surround && bass==p.bass && mode.equals(p.mode) && preampDb==p.preampDb && dsp.equals(p.dsp) && java.util.Arrays.equals(headphoneFilters,p.headphoneFilters);
    }
    @Override public int hashCode() { return name.hashCode() * 31 + java.util.Arrays.hashCode(gains); }
  }

  public static Profile preset(String name) {
    switch (name) {
      case "\u5f00\u8f66\u65c5\u9014": return new Profile(name, FREQUENCIES,
          new double[]{6, 10, 3, 0, -1, -1, 0, -1, 2, 6}, 0, 0, 0);
      case "\u8d85\u91cd\u4f4e\u97f3": return new Profile(name, FREQUENCIES,
          new double[]{-6.5, -5, -3, 1.5, 3, -1, -2.5, -.5, 3.5, 5}, .30, .20, .40);
      case "\u8f66\u8f7d\u97f3\u54cd": return new Profile(name, FREQUENCIES,
          new double[]{12, 6, -3, 1, -2, 1, -3, 2, -3, 2}, 0, 0, 0);
      default: return null;
    }
  }

  public static Profile custom(double[] gains) {
    if (gains == null || gains.length != 10) throw new IllegalArgumentException("\u9700\u8981\u5b8c\u6574\u7684\u5341\u6bb5\u5747\u8861\u5668\u53c2\u6570");
    for (double gain : gains) {
      if (!Double.isFinite(gain) || gain < -12 || gain > 12)
        throw new IllegalArgumentException("\u5747\u8861\u5668\u589e\u76ca\u5fc5\u987b\u5728 -12 \u81f3 +12 dB \u4e4b\u95f4");
    }
    return new Profile("Custom", FREQUENCIES, gains, 0, 0, 0);
  }
  public static Profile configured(double[] gains,double clarity,double reverb,double surround,double bass,double dynamics,String mode,HeadphoneDspEngine.Filter[] peq,double preampDb) {
    return configured(gains,clarity,reverb,surround,bass,dynamics,mode,peq,preampDb,EffectDspSettings.legacy(dynamics));
  }
  public static Profile configured(double[] gains,double clarity,double reverb,double surround,double bass,double dynamics,String mode,HeadphoneDspEngine.Filter[] peq,double preampDb,EffectDspSettings dsp) {
    custom(gains);
    for(double v:new double[]{clarity,reverb,surround,bass,dynamics}) if(!Double.isFinite(v)||v<0||v>1)throw new IllegalArgumentException("Invalid advanced effect");
    if(!Double.isFinite(preampDb)||preampDb< -30||preampDb>12||peq.length>128)throw new IllegalArgumentException("Invalid calibration");
    return new Profile("Custom",FREQUENCIES,gains,clarity,reverb,surround,bass,dynamics,mode,peq,preampDb,dsp);
  }

  /** A stateful kernel belongs exclusively to one decoder stream/audio thread. */
  public static final class Kernel {
    private final Biquad[][] filters;
    private final double[][][] delays;
    private final int[][] delayPositions;
    private final double[] envelopes;
    private final double preGain, reverb, dynamics, attack, release;
    private final boolean identity;
    private final HeadphoneDspEngine headphone;
    private final double surround;
    private final String mode;
    private final double[][] crossDelay;
    private int crossPosition;
    private final EffectDspSettings dsp;
    private double linkedEnvelope;

    public Kernel(Profile profile, int sampleRate, int channels) {
      this(profile,sampleRate,channels,1);
    }
    public Kernel(Profile profile, int sampleRate, int channels, double loudnessAmount) {
      if (sampleRate < 8000 || channels < 1 || channels > 8)
        throw new IllegalArgumentException("\u4e0d\u652f\u6301\u7684\u97f3\u9891\u683c\u5f0f");
      headphone=new HeadphoneDspEngine(profile.headphoneFilters,sampleRate,channels);
      dsp=profile.dsp;
      double compensation=dsp.loudness?Math.max(0,Math.min(1,loudnessAmount)):1;
      surround=profile.surround;mode=profile.mode;
      crossDelay=new double[2][Math.max(1,(int)(sampleRate*.00035))];
      filters = new Biquad[channels][10+(profile.clarity>0?1:0)+(profile.bass>0?1:0)];
      for (int channel = 0; channel < channels; channel++) {
        for (int i = 0; i < 10; i++) {
          filters[channel][i] = Biquad.peak(sampleRate,
              profile.frequencies[i], profile.gains[i]*compensation, 1.41421356237);
        }
        // A modest high shelf implements software clarity; no proprietary DTS claim.
        if (profile.clarity > 0)
          filters[channel][10] = Biquad.shelf(sampleRate, 6000, 3 * profile.clarity);
        if(profile.bass>0) filters[channel][10+(profile.clarity>0?1:0)]=Biquad.lowShelf(sampleRate,90,8*profile.bass);
      }
      reverb = profile.reverb;
      dynamics = profile.dynamics;
      identity = profile.clarity == 0 && reverb == 0 && dsp.ratio == 1 && surround==0 && dsp.width<=0 && profile.bass==0 && profile.headphoneFilters.length==0 && profile.preampDb==0 && dsp.preampDb*compensation==0
          && (compensation==0||java.util.Arrays.stream(profile.gains).allMatch(gain -> gain == 0));
      envelopes = new double[channels];
      attack = Math.exp(-1.0 / (dsp.attackMs*.001 * sampleRate));
      release = Math.exp(-1.0 / (dsp.releaseMs*.001 * sampleRate));
      delays = reverb > 0 ? new double[channels][3][] : null;
      delayPositions = reverb > 0 ? new int[channels][3] : null;
      if (delays != null) {
        double[] seconds = mode.equals("car")?new double[]{.013,.023,.037}:new double[]{.029,.043,.071};
        for (int channel = 0; channel < channels; channel++)
          for (int tap = 0; tap < 3; tap++)
            delays[channel][tap] = new double[Math.max(1, (int)(sampleRate * (seconds[tap] + channel * .001)))];
      }
      // Measure the combined filter response instead of assuming the largest band
      // alone covers overlapping boosts. Preserve all-zero custom EQ exactly.
      double maximum = 1;
      for (int i = 0; i < 1024; i++) {
        double frequency = 10 * Math.pow((sampleRate * .49) / 10, i / 1023.0);
        double magnitude = headphone.magnitude(frequency,sampleRate);
        for (Biquad filter : filters[0]) magnitude *= filter.magnitude(frequency, sampleRate);
        maximum = Math.max(maximum, magnitude);
      }
      double specified=Math.pow(10,(profile.preampDb+dsp.preampDb*compensation)/20.0);
      double spatialHeadroom=(1+surround*.65)*(1+Math.max(0,dsp.width)*.65);
      preGain = maximum*specified*spatialHeadroom > 1.000001 || reverb > 0 || dsp.ratio > 1
          ? Math.min(specified,1 / (maximum * spatialHeadroom * Math.pow(10, 1.5 / 20.0))) : specified;
    }

    public double preGain() { return preGain; }

    private double processChannel(double sample, int channel) {
      if (identity) return sample;
      double output = headphone.process(sample,channel);
      for (Biquad filter : filters[channel]) output = filter.process(output);
      if (dsp.ratio > 1 && dsp.width < 0) {
        double magnitude = Math.abs(output);
        double coefficient = magnitude > envelopes[channel] ? attack : release;
        double envelope = envelopes[channel] = coefficient * envelopes[channel] + (1 - coefficient) * magnitude;
        output *= dsp.compressionGain(envelope);
      }
      if (delays != null) {
        double reflected = 0;
        for (int tap = 0; tap < 3; tap++) {
          int position = delayPositions[channel][tap];
          double delayed = delays[channel][tap][position];
          reflected += delayed / 3;
          delays[channel][tap][position] = output + delayed * .22;
          delayPositions[channel][tap] = (position + 1) % delays[channel][tap].length;
        }
        output = output * (1 - reverb) + reflected * reverb;
      }
      return output;
    }
    private double limit(double output) {
      // Final preamp and peak protection cover the complete combined chain.
      output*=preGain;
      if (Math.abs(output) > .95) {
        output = Math.copySign(.95 + .05 * Math.tanh((Math.abs(output) - .95) / .05), output);
      }
      return Double.isFinite(output) ? output : 0;
    }
    public double process(double sample,int channel) {
      if(identity)return sample;
      double output=processChannel(sample,channel);
      if(dsp.ratio>1&&dsp.width>=0) {
        double magnitude=Math.abs(output),coefficient=magnitude>envelopes[channel]?attack:release;
        envelopes[channel]=coefficient*envelopes[channel]+(1-coefficient)*magnitude;
        output*=dsp.compressionGain(envelopes[channel]);
      }
      return limit(output);
    }
    public void processFrame(double[] frame) {
      if(identity)return;
      for(int c=0;c<frame.length;c++) frame[c]=processChannel(frame[c],c);
      if(dsp.ratio>1&&dsp.width>=0) {
        double peak=0;for(double value:frame)peak=Math.max(peak,Math.abs(value));
        double coefficient=peak>linkedEnvelope?attack:release;
        linkedEnvelope=coefficient*linkedEnvelope+(1-coefficient)*peak;
        double gain=dsp.compressionGain(linkedEnvelope);
        for(int c=0;c<frame.length;c++)frame[c]*=gain;
      }
      if(frame.length>=2&&dsp.width>0) {
        double mid=(frame[0]+frame[1])*.5,side=(frame[0]-frame[1])*.5*(1+.65*dsp.width);
        frame[0]=mid+side;frame[1]=mid-side;
      }
      if(frame.length>=2&&surround>0) {
        double l=frame[0],r=frame[1];
        if(mode.equals("headphones")||dsp.width>=0) {
          frame[0]=l+surround*.25*(crossDelay[1][crossPosition]-l);
          frame[1]=r+surround*.25*(crossDelay[0][crossPosition]-r);
          crossDelay[0][crossPosition]=l;crossDelay[1][crossPosition]=r;crossPosition=(crossPosition+1)%crossDelay[0].length;
        } else {
          double mid=(l+r)*.5,side=(l-r)*.5*(1+surround*(mode.equals("car")?.25:.65));
          frame[0]=mid+side;frame[1]=mid-side;
        }
      }
      for(int c=0;c<frame.length;c++)frame[c]=limit(frame[c]);
    }
    public void copyState(Kernel old) {
      if(old==null||envelopes.length!=old.envelopes.length)return;
      System.arraycopy(old.envelopes,0,envelopes,0,envelopes.length);
      linkedEnvelope=old.linkedEnvelope;
      headphone.copyState(old.headphone);
      for(int c=0;c<filters.length;c++)for(int i=0;i<Math.min(filters[c].length,old.filters[c].length);i++){filters[c][i].z1=old.filters[c][i].z1;filters[c][i].z2=old.filters[c][i].z2;}
      if(delays!=null&&old.delays!=null)for(int c=0;c<delays.length;c++)for(int t=0;t<3;t++)if(delays[c][t].length==old.delays[c][t].length){System.arraycopy(old.delays[c][t],0,delays[c][t],0,delays[c][t].length);delayPositions[c][t]=old.delayPositions[c][t];}
      if(crossDelay[0].length==old.crossDelay[0].length){for(int c=0;c<2;c++)System.arraycopy(old.crossDelay[c],0,crossDelay[c],0,crossDelay[c].length);crossPosition=old.crossPosition;}
    }
  }

  private static final class Biquad {
    final double b0, b1, b2, a1, a2;
    double z1, z2;
    Biquad(double b0, double b1, double b2, double a0, double a1, double a2) {
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
      this.a1 = a1 / a0; this.a2 = a2 / a0;
    }
    static Biquad peak(int rate, double frequency, double gain, double q) {
      if (gain == 0 || frequency >= rate * .49) return new Biquad(1, 0, 0, 1, 0, 0);
      double a = Math.pow(10, gain / 40), w = 2 * Math.PI * frequency / rate;
      double alpha = Math.sin(w) / (2 * q), cosine = Math.cos(w);
      return new Biquad(1 + alpha * a, -2 * cosine, 1 - alpha * a,
          1 + alpha / a, -2 * cosine, 1 - alpha / a);
    }
    static Biquad shelf(int rate, double frequency, double gain) {
      if (frequency >= rate * .49) return new Biquad(1, 0, 0, 1, 0, 0);
      double a = Math.pow(10, gain / 40), w = 2 * Math.PI * frequency / rate;
      double c = Math.cos(w), alpha = Math.sin(w) / Math.sqrt(2), root = 2 * Math.sqrt(a) * alpha;
      return new Biquad(a * ((a + 1) + (a - 1) * c + root),
          -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - root),
          (a + 1) - (a - 1) * c + root, 2 * ((a - 1) - (a + 1) * c),
          (a + 1) - (a - 1) * c - root);
    }
    static Biquad lowShelf(int rate,double frequency,double gain) {
      double a=Math.pow(10,gain/40),w=2*Math.PI*frequency/rate,c=Math.cos(w),r=2*Math.sqrt(a)*Math.sin(w)/Math.sqrt(2);
      return new Biquad(a*((a+1)-(a-1)*c+r),2*a*((a-1)-(a+1)*c),a*((a+1)-(a-1)*c-r),(a+1)+(a-1)*c+r,-2*((a-1)+(a+1)*c),(a+1)+(a-1)*c-r);
    }
    double process(double input) {
      double output = b0 * input + z1;
      z1 = b1 * input - a1 * output + z2;
      z2 = b2 * input - a2 * output;
      return output;
    }
    double magnitude(double frequency, int rate) {
      double w = 2 * Math.PI * frequency / rate;
      double nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w);
      double ni = -b1 * Math.sin(w) - b2 * Math.sin(2 * w);
      double dr = 1 + a1 * Math.cos(w) + a2 * Math.cos(2 * w);
      double di = -a1 * Math.sin(w) - a2 * Math.sin(2 * w);
      return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
  }
}
