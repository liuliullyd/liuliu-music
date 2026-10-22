package com.liuliu.agentmusic;

/** RBJ biquads on decoded PCM. A calibration stage, never a system-EQ approximation. */
public final class HeadphoneDspEngine {
  public static final class Filter {
    public final String type; public final double frequency, gain, q;
    public Filter(String type, double frequency, double gain, double q) {
      if (!(type.equals("PK") || type.equals("LS") || type.equals("HS")) || !Double.isFinite(frequency)
          || frequency < 20 || frequency > 20000 || !Double.isFinite(gain) || gain < -24 || gain > 24
          || !Double.isFinite(q) || q < .1 || q > 20) throw new IllegalArgumentException("Invalid PEQ filter");
      this.type=type; this.frequency=frequency; this.gain=gain; this.q=q;
    }
    @Override public boolean equals(Object o) { if (!(o instanceof Filter)) return false; Filter f=(Filter)o; return type.equals(f.type)&&frequency==f.frequency&&gain==f.gain&&q==f.q; }
    @Override public int hashCode() { return java.util.Objects.hash(type,frequency,gain,q); }
  }
  public static final class Biquad {
    final double b0,b1,b2,a1,a2; double z1,z2;
    private Biquad(double b0,double b1,double b2,double a0,double a1,double a2) {
      this.b0=b0/a0;this.b1=b1/a0;this.b2=b2/a0;this.a1=a1/a0;this.a2=a2/a0;
    }
    public static Biquad create(Filter f, int rate) {
      if (f.gain==0) return new Biquad(1,0,0,1,0,0);
      if (f.frequency>=rate/2.0) throw new IllegalArgumentException("PEQ frequency exceeds decoder Nyquist frequency");
      double a=Math.pow(10,f.gain/40), w=2*Math.PI*f.frequency/rate, c=Math.cos(w), alpha=Math.sin(w)/(2*f.q);
      if(f.type.equals("PK")) return new Biquad(1+alpha*a,-2*c,1-alpha*a,1+alpha/a,-2*c,1-alpha/a);
      double r=2*Math.sqrt(a)*alpha;
      if(f.type.equals("LS")) return new Biquad(a*((a+1)-(a-1)*c+r),2*a*((a-1)-(a+1)*c),a*((a+1)-(a-1)*c-r),(a+1)+(a-1)*c+r,-2*((a-1)+(a+1)*c),(a+1)+(a-1)*c-r);
      return new Biquad(a*((a+1)+(a-1)*c+r),-2*a*((a-1)+(a+1)*c),a*((a+1)+(a-1)*c-r),(a+1)-(a-1)*c+r,2*((a-1)-(a+1)*c),(a+1)-(a-1)*c-r);
    }
    public double process(double x) { double y=b0*x+z1;z1=b1*x-a1*y+z2;z2=b2*x-a2*y;return y; }
    public double magnitude(double frequency,int rate) {
      double w=2*Math.PI*frequency/rate, nr=b0+b1*Math.cos(w)+b2*Math.cos(2*w), ni=-b1*Math.sin(w)-b2*Math.sin(2*w), dr=1+a1*Math.cos(w)+a2*Math.cos(2*w), di=-a1*Math.sin(w)-a2*Math.sin(2*w);
      return Math.sqrt((nr*nr+ni*ni)/(dr*dr+di*di));
    }
    public void copyState(Biquad old) { z1=old.z1; z2=old.z2; }
  }
  private final Biquad[][] filters;
  public HeadphoneDspEngine(Filter[] parameters,int rate,int channels) {
    if(parameters.length>128) throw new IllegalArgumentException("Too many PEQ filters");
    filters=new Biquad[channels][parameters.length];
    for(int c=0;c<channels;c++) for(int i=0;i<parameters.length;i++) filters[c][i]=Biquad.create(parameters[i],rate);
  }
  public double process(double sample,int channel) { for(Biquad f:filters[channel]) sample=f.process(sample);return sample; }
  public double magnitude(double frequency,int rate) { double value=1;for(Biquad f:filters[0]) value*=f.magnitude(frequency,rate);return value; }
  public void copyState(HeadphoneDspEngine old) { if(old==null||filters.length!=old.filters.length)return;for(int c=0;c<filters.length;c++)if(filters[c].length==old.filters[c].length)for(int i=0;i<filters[c].length;i++)filters[c][i].copyState(old.filters[c][i]); }
}
