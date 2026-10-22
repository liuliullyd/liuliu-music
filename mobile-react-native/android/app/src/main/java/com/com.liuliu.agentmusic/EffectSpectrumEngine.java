package com.liuliu.agentmusic;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Bounded input/output observation. All FFT work is performed by analyze() on a worker. */
public final class EffectSpectrumEngine {
  public static final int SIZE = 8192, BANDS = 64;
  public static final double FLOOR_DB = -96;
  private float[][] input, output;
  private int rate, channels, observedChannels, filled, pending;
  private boolean ready;
  private long generation;

  public static final class Frame {
    public final int sampleRate;
    public final long generation, timestampNanos;
    public final double[] frequencies, inputDb, outputDb;
    Frame(int rate, long generation, double[] frequencies, double[] in, double[] out) {
      this.sampleRate = rate; this.generation = generation;
      this.frequencies = frequencies; inputDb = in; outputDb = out;
      timestampNanos = System.nanoTime();
    }
  }

  public synchronized void clear() {
    generation++; input = null; output = null; filled = pending = 0; ready = false;
  }
  public synchronized boolean isCurrent(Frame frame) { return frame.generation == generation; }

  public synchronized void offerInput(ByteBuffer buffer, boolean floating, int sampleRate, int channelCount) {
    pending = 0;
    if (sampleRate < 8000 || channelCount < 1 || channelCount > 8) return;
    if (input == null || rate != sampleRate || channels != channelCount) {
      generation++; rate = sampleRate; channels = channelCount;
      observedChannels = Math.min(2, channels);
      input = new float[observedChannels][SIZE]; output = new float[observedChannels][SIZE];
      filled = 0; ready = false;
    }
    if (ready) return;
    int bytes = floating ? 4 : 2;
    pending = Math.min(SIZE - filled, buffer.remaining() / (bytes * channels));
    ByteBuffer view = buffer.duplicate().order(ByteOrder.nativeOrder());
    for (int i = 0; i < pending; i++) for (int c = 0; c < observedChannels; c++) {
      int offset = view.position() + (i * channels + c) * bytes;
      input[c][filled + i] = floating ? view.getFloat(offset) : view.getShort(offset) / 32768f;
    }
  }
  public synchronized boolean offerOutput(ByteBuffer buffer, boolean floating) {
    if (pending == 0 || input == null || ready) return false;
    int bytes = floating ? 4 : 2;
    if (buffer.remaining() / (bytes * channels) < pending) { clear(); return false; }
    ByteBuffer view = buffer.duplicate().order(ByteOrder.nativeOrder());
    for (int i = 0; i < pending; i++) for (int c = 0; c < observedChannels; c++) {
      int offset = view.position() + (i * channels + c) * bytes;
      output[c][filled + i] = floating ? view.getFloat(offset) : view.getShort(offset) / 32768f;
    }
    filled += pending; pending = 0; ready = filled == SIZE;
    return ready;
  }

  public Frame analyze() {
    final float[][] in, out;
    final int sampleRate;
    final long version;
    synchronized (this) {
      if (!ready) return null;
      in = input; out = output; sampleRate = rate; version = generation;
    }
    double[] frequencies = new double[BANDS];
    double upper = Math.min(20000, sampleRate / 2.0);
    for (int i = 0; i < BANDS; i++) frequencies[i] = 20 * Math.pow(upper / 20, i / (double)(BANDS - 1));
    Frame frame = new Frame(sampleRate, version, frequencies,
      spectrum(in, sampleRate, frequencies), spectrum(out, sampleRate, frequencies));
    synchronized (this) {
      if (version != generation) return null;
      filled = 0; ready = false;
    }
    return frame;
  }

  private static double[] spectrum(float[][] samples, int rate, double[] frequencies) {
    double[] power = new double[SIZE / 2 + 1];
    for (float[] channel : samples) {
      double[] re = new double[SIZE], im = new double[SIZE];
      double windowSum = 0;
      for (int i = 0; i < SIZE; i++) {
        double window = .5 - .5 * Math.cos(2 * Math.PI * i / (SIZE - 1));
        re[i] = (Float.isFinite(channel[i]) ? channel[i] : 0) * window;
        windowSum += window;
      }
      fft(re, im);
      double normalization = 4 / (windowSum * windowSum * samples.length);
      for (int i = 0; i < power.length; i++) power[i] += (re[i] * re[i] + im[i] * im[i]) * normalization;
    }
    double[] db = new double[BANDS];
    for (int i = 0; i < BANDS; i++) {
      double low = i == 0 ? 20 : Math.sqrt(frequencies[i - 1] * frequencies[i]);
      double high = i == BANDS - 1 ? Math.min(20000, rate / 2.0) : Math.sqrt(frequencies[i] * frequencies[i + 1]);
      int from = Math.max(1, (int)Math.ceil(low * SIZE / rate));
      int to = Math.min(power.length - 1, (int)Math.floor(high * SIZE / rate));
      if (to < from) from = to = Math.max(1, Math.min(power.length - 1, (int)Math.round(frequencies[i] * SIZE / rate)));
      double peak = 0;
      for (int b = from; b <= to; b++) peak = Math.max(peak, power[b]);
      db[i] = Math.max(FLOOR_DB, Math.min(0, 10 * Math.log10(Math.max(1e-12, peak))));
    }
    return db;
  }

  private static void fft(double[] re, double[] im) {
    for (int i = 1, j = 0; i < SIZE; i++) {
      int bit = SIZE >> 1;
      for (; (j & bit) != 0; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { double x = re[i]; re[i] = re[j]; re[j] = x; }
    }
    for (int len = 2; len <= SIZE; len <<= 1) {
      double a = -2 * Math.PI / len, wr0 = Math.cos(a), wi0 = Math.sin(a);
      for (int start = 0; start < SIZE; start += len) {
        double wr = 1, wi = 0;
        for (int j = 0; j < len / 2; j++) {
          int p = start + j, q = p + len / 2;
          double r = wr * re[q] - wi * im[q], v = wr * im[q] + wi * re[q];
          re[q] = re[p] - r; im[q] = im[p] - v; re[p] += r; im[p] += v;
          double next = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = next;
        }
      }
    }
  }
}
