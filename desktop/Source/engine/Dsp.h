/*
    NXW Studio · DSP building blocks

    These mirror the Web Audio behaviour the browser version relies on, so a project
    sounds the same in the desktop engine:
      - Timeline: an AudioParam-style automation timeline (set / linear ramp /
        exponential ramp / set-target), evaluated one sample at a time.
      - Biquad: the Web Audio BiquadFilterNode formulas (note that for low-pass and
        high-pass the Q value is a resonance in dB, exactly as in the browser).
      - Band-limited oscillators, white noise, delay lines, smoothers, a compressor
        modelled on Chromium's DynamicsCompressor (including its automatic make-up gain).
*/
#pragma once

#include <juce_core/juce_core.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include <vector>

namespace nxw::dsp
{
constexpr double kPi    = 3.14159265358979323846;
constexpr double kTwoPi = 6.28318530717958647692;

inline double mtof (double key)        { return 440.0 * std::pow (2.0, (key - 69.0) / 12.0); }
inline double dbToGain (double db)     { return std::pow (10.0, db / 20.0); }
inline double gainToDb (double g)      { return g <= 1.0e-9 ? -180.0 : 20.0 * std::log10 (g); }
inline double volGain (double v)       { return v <= 0 ? 0.0 : 1.25 * v * v; }   // channel volume knob
inline double faderGain (double v)     { return v <= 0 ? 0.0 : 1.6 * v * v; }    // mixer fader, unity at 0.7906
template <typename T> inline T clampv (T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }

//==============================================================================
/** Fast deterministic white noise in [-1, 1). */
struct Noise
{
    uint32_t s = 0x9E3779B9u;
    void seed (uint32_t v) noexcept { s = v ? v : 0x9E3779B9u; }
    float next() noexcept
    {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        return (float) ((double) s * (2.0 / 4294967296.0) - 1.0);
    }
    float uniform01() noexcept { return 0.5f * (next() + 1.0f); }
};

inline Noise& sharedRandom() { static thread_local Noise n { 0x1234567u }; return n; }

//==============================================================================
/** AudioParam-style automation timeline, stepped one sample at a time.
    Times are in samples relative to whatever origin the owner uses. Events must be
    added in non-decreasing time order (as the Web Audio code does). */
class Timeline
{
public:
    enum Type : uint8_t { Set, Lin, Exp, Target };

    void reset (double value, double startTime = 0) noexcept
    {
        n = head = 0;
        t = startTime;
        v = anchorV = value;
        anchorT = startTime;
        lastType = Set;
        mode = Const;
        target = value;
        tau = 1.0;
    }

    void set (double value, double time)                     { push ({ time, value, 0.0, Set }); }
    void linearTo (double value, double time)                { push ({ time, value, 0.0, Lin }); }
    void expTo (double value, double time)                   { push ({ time, value, 0.0, Exp }); }
    void targetAt (double value, double time, double tauS)   { push ({ time, value, tauS, Target }); }

    /** Removes pending events at or after `time` and holds the present value
        (cancelAndHoldAtTime), so a cancelled ramp can never jump. */
    void cancelFrom (double time) noexcept
    {
        while (n > head && evs[n - 1].t >= time) --n;
        anchorT = t; anchorV = v; lastType = Set; mode = Const;
        segmentDirty = true;
    }

    /** Moves the evaluation clock to `time`, keeping scheduled events
        (events already in the past are applied on the next sample). */
    void jumpTo (double time) noexcept
    {
        if (mode == Approach) v = target + (v - target) * std::exp (-(time - t) / tau);
        t = time;
        segmentDirty = true;
    }

    double current() const noexcept { return v; }
    double now() const noexcept     { return t; }

    /** Returns the value at the current time, then advances one sample. */
    double next() noexcept
    {
        if ((head < n && evs[head].t <= t) || segmentDirty)
        {
            while (head < n && evs[head].t <= t)
                consume (evs[head++]);
            setupSegment();
        }

        const double out = v;

        switch (mode)
        {
            case Const:  break;
            case LinRamp: v += slope; break;
            case ExpRamp: v *= mul; break;
            case Approach: v = target + (v - target) * coef; break;
        }

        t += 1.0;
        return out;
    }

    /** True when nothing can change any more (useful to skip work). */
    bool isSettled() const noexcept { return head >= n && mode == Const; }

private:
    enum Mode : uint8_t { Const, LinRamp, ExpRamp, Approach };
    struct Ev { double t, v, tau; Type type; };

    void push (Ev e) noexcept
    {
        if (n >= cap)
        {
            if (head > 0)
            {
                std::move (evs + head, evs + n, evs);
                n -= head; head = 0;
            }
            else return;
        }
        // keep events sorted: insert before any later event
        int i = n;
        while (i > head && evs[i - 1].t > e.t) { evs[i] = evs[i - 1]; --i; }
        evs[i] = e;
        ++n;
        segmentDirty = true;
    }

    double valueAtAnchorFor (double time) const noexcept
    {
        if (lastType == Target) return target + (anchorV - target) * std::exp (-(time - anchorT) / tau);
        return anchorV;
    }

    void consume (const Ev& e) noexcept
    {
        // Value at the event time, given everything before it.
        double valueAtEvent = e.v;
        if (e.type == Target)
            valueAtEvent = (mode == Approach || lastType == Target) ? v : valueAtAnchorFor (e.t);

        anchorT = e.t;
        anchorV = valueAtEvent;
        lastType = e.type;
        if (e.type == Target) { target = e.v; tau = std::max (e.tau, 1.0e-3); }
    }

    void setupSegment() noexcept
    {
        segmentDirty = false;
        if (head < n && (evs[head].type == Lin || evs[head].type == Exp) && evs[head].t > anchorT)
        {
            const Ev& e = evs[head];
            const double dur = e.t - anchorT, pos = t - anchorT;
            if (e.type == Lin)
            {
                slope = (e.v - anchorV) / dur;
                v = anchorV + slope * pos;
                mode = LinRamp;
            }
            else if ((anchorV > 0.0 && e.v > 0.0) || (anchorV < 0.0 && e.v < 0.0))
            {
                const double lr = std::log (e.v / anchorV) / dur;
                mul = std::exp (lr);
                v = anchorV * std::exp (lr * pos);
                mode = ExpRamp;
            }
            else { v = anchorV; mode = Const; }
            return;
        }

        if (lastType == Target)
        {
            coef = std::exp (-1.0 / tau);
            v = target + (anchorV - target) * std::exp (-(t - anchorT) / tau);
            mode = Approach;
        }
        else { v = anchorV; mode = Const; }
    }

    static constexpr int cap = 40;
    Ev evs[cap] {};
    int n = 0, head = 0;
    double t = 0, v = 0, anchorT = 0, anchorV = 0, target = 0, tau = 1, slope = 0, mul = 1, coef = 0;
    Type lastType = Set;
    Mode mode = Const;
    bool segmentDirty = false;
};

//==============================================================================
/** Web Audio BiquadFilterNode, transposed direct form II. */
class Biquad
{
public:
    enum Type : uint8_t { Lowpass, Highpass, Bandpass, Lowshelf, Highshelf, Peaking };

    void setup (Type type, double sampleRate) noexcept { ty = type; sr = sampleRate; }
    void reset() noexcept { z1[0] = z2[0] = z1[1] = z2[1] = 0; }

    /** f in Hz, q as Web Audio (dB resonance for LP/HP), gain in dB for shelves/peaking. */
    void set (double f, double q, double gainDb = 0) noexcept
    {
        const double nyq = sr * 0.5;
        f = clampv (f, 0.0, nyq);
        const double w0 = kTwoPi * f / sr, cw = std::cos (w0), sw = std::sin (w0);
        double b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

        if (f >= nyq && (ty == Lowpass)) { setCoefs (1, 0, 0, 1, 0, 0); return; }
        if (f <= 0 && (ty == Highpass)) { setCoefs (1, 0, 0, 1, 0, 0); return; }

        switch (ty)
        {
            case Lowpass:
            {
                const double alpha = sw / (2.0 * std::pow (10.0, q / 20.0));
                b0 = (1 - cw) * 0.5; b1 = 1 - cw; b2 = (1 - cw) * 0.5;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            }
            case Highpass:
            {
                const double alpha = sw / (2.0 * std::pow (10.0, q / 20.0));
                b0 = (1 + cw) * 0.5; b1 = -(1 + cw); b2 = (1 + cw) * 0.5;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            }
            case Bandpass:
            {
                const double alpha = sw / (2.0 * std::max (q, 1.0e-4));
                b0 = alpha; b1 = 0; b2 = -alpha;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            }
            case Peaking:
            {
                const double A = std::pow (10.0, gainDb / 40.0), alpha = sw / (2.0 * std::max (q, 1.0e-4));
                b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
                a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
                break;
            }
            case Lowshelf:
            {
                const double A = std::pow (10.0, gainDb / 40.0), alpha = sw / 2.0 * std::sqrt (2.0), sa = 2.0 * std::sqrt (A) * alpha;
                b0 = A * ((A + 1) - (A - 1) * cw + sa);
                b1 = 2 * A * ((A - 1) - (A + 1) * cw);
                b2 = A * ((A + 1) - (A - 1) * cw - sa);
                a0 = (A + 1) + (A - 1) * cw + sa;
                a1 = -2 * ((A - 1) + (A + 1) * cw);
                a2 = (A + 1) + (A - 1) * cw - sa;
                break;
            }
            case Highshelf:
            {
                const double A = std::pow (10.0, gainDb / 40.0), alpha = sw / 2.0 * std::sqrt (2.0), sa = 2.0 * std::sqrt (A) * alpha;
                b0 = A * ((A + 1) + (A - 1) * cw + sa);
                b1 = -2 * A * ((A - 1) + (A + 1) * cw);
                b2 = A * ((A + 1) + (A - 1) * cw - sa);
                a0 = (A + 1) - (A - 1) * cw + sa;
                a1 = 2 * ((A - 1) - (A + 1) * cw);
                a2 = (A + 1) - (A - 1) * cw - sa;
                break;
            }
        }
        setCoefs (b0, b1, b2, a0, a1, a2);
    }

    inline float process (float x, int ch = 0) noexcept
    {
        const double y = c0 * x + z1[ch];
        z1[ch] = c1 * x - d1 * y + z2[ch];
        z2[ch] = c2 * x - d2 * y;
        return (float) y;
    }

    /** Flush denormals now and then. */
    void sanitise() noexcept
    {
        for (int ch = 0; ch < 2; ++ch)
        {
            if (std::abs (z1[ch]) < 1.0e-20) z1[ch] = 0;
            if (std::abs (z2[ch]) < 1.0e-20) z2[ch] = 0;
        }
    }

private:
    void setCoefs (double b0, double b1, double b2, double a0, double a1, double a2) noexcept
    {
        const double ia = 1.0 / a0;
        c0 = b0 * ia; c1 = b1 * ia; c2 = b2 * ia; d1 = a1 * ia; d2 = a2 * ia;
    }

    Type ty = Lowpass;
    double sr = 48000;
    double c0 = 1, c1 = 0, c2 = 0, d1 = 0, d2 = 0;
    double z1[2] {}, z2[2] {};
};

//==============================================================================
/** Band-limited oscillator (PolyBLEP saw and square, naive triangle, exact sine).
    Phases follow Web Audio: every waveform starts at its zero/rising point. */
class Osc
{
public:
    enum Wave : uint8_t { Sine, Triangle, Saw, Square };

    void start (Wave w, double startPhase = 0) noexcept { wave = w; phase = startPhase; }

    inline float next (double freq, double sampleRate) noexcept
    {
        const double inc = clampv (freq / sampleRate, 0.0, 0.5);
        double y = 0;

        switch (wave)
        {
            case Sine:
                y = std::sin (kTwoPi * phase);
                break;
            case Triangle:
            {
                const double p = phase;
                y = p < 0.25 ? 4 * p : (p < 0.75 ? 2 - 4 * p : 4 * p - 4);
                break;
            }
            case Saw:
            {
                double p = phase + 0.5; if (p >= 1) p -= 1;
                y = (2 * p - 1 - blep (p, inc)) * kSawNorm;
                break;
            }
            case Square:
            {
                y = phase < 0.5 ? 1.0 : -1.0;
                y += blep (phase, inc);
                double p2 = phase + 0.5; if (p2 >= 1) p2 -= 1;
                y -= blep (p2, inc);
                y *= kSquareNorm;
                break;
            }
        }

        phase += inc;
        if (phase >= 1) phase -= 1;
        return (float) y;
    }

private:
    // Web Audio scales its built-in saw and square so the band-limited table peaks at 1
    // (the Gibbs overshoot is about 1.179), which makes them 1.43 dB quieter than a naive wave.
    static constexpr double kSawNorm = 0.8483667, kSquareNorm = 0.8481910;

    static inline double blep (double t, double dt) noexcept
    {
        if (dt <= 0) return 0;
        if (t < dt)          { t /= dt; return t + t - t * t - 1.0; }
        if (t > 1.0 - dt)    { t = (t - 1.0) / dt; return t * t + t + t + 1.0; }
        return 0;
    }

    Wave wave = Sine;
    double phase = 0;
};

inline Osc::Wave waveFromName (const juce::String& s)
{
    if (s == "sawtooth") return Osc::Saw;
    if (s == "square")   return Osc::Square;
    if (s == "triangle") return Osc::Triangle;
    return Osc::Sine;
}

//==============================================================================
/** tanh-style waveshaper matching the browser's makeCurve(k) curve. */
struct Shaper
{
    double k = 1.6, norm = 1.0 / std::tanh (1.6);
    void setK (double kk) { k = kk; norm = 1.0 / std::tanh (kk); }
    inline float operator() (float x) const noexcept
    {
        const double c = clampv ((double) x, -1.0, 1.0);
        return (float) (std::tanh (k * c) * norm);
    }
};

/** The master soft clipper: linear to 0.86, then a tanh shoulder (input clamped to ±2). */
inline float softClip (float x) noexcept
{
    constexpr float k = 0.86f;
    const float u = clampv (x, -2.0f, 2.0f), m = std::abs (u);
    const float y = m < k ? m : k + (1 - k) * std::tanh ((m - k) / (1 - k));
    return u < 0 ? -y : y;
}

//==============================================================================
/** One-pole smoother matching setTargetAtTime(value, now, tau). */
struct Smoother
{
    double cur = 0, target = 0, coef = 0;
    void init (double v) noexcept { cur = target = v; }
    void setTau (double tauS, double sampleRate) noexcept { coef = std::exp (-1.0 / std::max (1.0, tauS * sampleRate)); }
    void setTarget (double v) noexcept { target = v; }
    inline double next() noexcept { cur = target + (cur - target) * coef; return cur; }
    bool settled() const noexcept { return std::abs (cur - target) < 1.0e-6; }
    void snap() noexcept { cur = target; }
};

//==============================================================================
/** Circular delay line with linear interpolation. */
class DelayLine
{
public:
    void prepare (double maxSeconds, double sampleRate)
    {
        size = (int) std::ceil (maxSeconds * sampleRate) + 4;
        buf.assign ((size_t) size, 0.0f);
        w = 0;
    }
    void clear() { std::fill (buf.begin(), buf.end(), 0.0f); }
    inline void push (float x) noexcept { buf[(size_t) w] = x; if (++w >= size) w = 0; }
    /** Reads `delaySamples` behind the most recently pushed sample. */
    inline float read (double delaySamples) const noexcept
    {
        delaySamples = clampv (delaySamples, 1.0, (double) size - 3.0);
        double r = (double) w - 1.0 - delaySamples;
        while (r < 0) r += size;
        const int i0 = (int) r;
        const int i1 = i0 + 1 >= size ? 0 : i0 + 1;
        const float fr = (float) (r - i0);
        return buf[(size_t) i0] + (buf[(size_t) i1] - buf[(size_t) i0]) * fr;
    }
private:
    std::vector<float> buf;
    int size = 0, w = 0;
};

//==============================================================================
/** Stereo panner with Web Audio's StereoPannerNode laws. */
struct PanLaw
{
    /** Mono source panned to stereo. */
    static inline void mono (float in, double pan, float& l, float& r) noexcept
    {
        const double x = (clampv (pan, -1.0, 1.0) + 1.0) * 0.5;
        l = (float) (in * std::cos (x * kPi * 0.5));
        r = (float) (in * std::sin (x * kPi * 0.5));
    }
    /** Gains for a stereo source: returns (ll, rl, lr, rr) so outL = inL*ll + inR*rl, outR = inL*lr + inR*rr. */
    static inline void stereoGains (double pan, float& ll, float& rl, float& lr, float& rr) noexcept
    {
        pan = clampv (pan, -1.0, 1.0);
        if (pan <= 0)
        {
            const double x = pan + 1.0;
            ll = 1.0f; rl = (float) std::cos (x * kPi * 0.5);
            lr = 0.0f; rr = (float) std::sin (x * kPi * 0.5);
        }
        else
        {
            const double x = pan;
            ll = (float) std::cos (x * kPi * 0.5); rl = 0.0f;
            lr = (float) std::sin (x * kPi * 0.5); rr = 1.0f;
        }
    }
};

//==============================================================================
/** Dynamics compressor: a port of Chromium's DynamicsCompressorKernel (the code behind
    Web Audio's DynamicsCompressorNode), so compression and the master limiter behave
    exactly like the browser engine: 6 ms look-ahead, exponential knee, adaptive release
    and the automatic make-up gain ((1 / fullRangeGain) ^ 0.6). Uses float maths like
    the original. */
class Compressor
{
public:
    void prepare (double sampleRate)
    {
        sr = (float) sampleRate;
        meterReleaseK = 1.0f - std::exp (-1.0f / (0.325f * sr));
        for (auto& b : pre) b.assign (kMaxPreDelay, 0.0f);
        lastPreDelay = 256;
        reset();
        dbThreshold = 1.0e9f;                   // forces the static curve to be rebuilt
        setParams (thr, knee, ratioIn, att, rel);
    }

    /** Starts from the settled state for silence. (Chromium starts its detector at 0, which
        ducks the first ~50 ms; in the browser that happens long before anything plays.) */
    void reset()
    {
        detectorAverage = 1;
        compressorGain = 1;
        meteringGain = 1;
        for (auto& b : pre) std::fill (b.begin(), b.end(), 0.0f);
        readIndex = 0;
        writeIndex = lastPreDelay;
        maxAttackDiffDb = -1;
        attackUnset = true;
        divCounter = 0;
    }

    void setParams (double thresholdDb, double kneeDb, double ratio, double attackS, double releaseS)
    {
        thr = (float) thresholdDb; knee = (float) kneeDb; ratioIn = (float) ratio; att = (float) attackS; rel = (float) releaseS;
        k = updateStaticCurve (juce::jlimit (-100.0f, 0.0f, thr), juce::jlimit (0.0f, 40.0f, knee), juce::jlimit (1.0f, 20.0f, ratioIn));
        const float fullRangeGain = saturate (1.0f, k);
        makeup = std::pow (1.0f / fullRangeGain, 0.6f);

        const float attackTime = std::max (0.001f, juce::jlimit (0.0f, 1.0f, att));
        attackFrames = attackTime * sr;
        const float releaseFrames = sr * juce::jlimit (0.0f, 1.0f, rel);
        satReleaseFrames = 0.0025f * sr;
        const float y1 = releaseFrames * 0.09f, y2 = releaseFrames * 0.16f, y3 = releaseFrames * 0.42f, y4 = releaseFrames * 0.98f;
        kA = 0.9999999999999998f * y1 + 1.8432219684323923e-16f * y2 - 1.9373394351676423e-16f * y3 + 8.824516011816245e-18f * y4;
        kB = -1.5788320352845888f * y1 + 2.3305837032074286f * y2 - 0.9141194204840429f * y3 + 0.1623677525612032f * y4;
        kC = 0.5334142869106424f * y1 - 1.272736789213631f * y2 + 0.9258856042207512f * y3 - 0.18656310191776226f * y4;
        kD = 0.08783463138207234f * y1 - 0.1694162967925622f * y2 + 0.08588057951595272f * y3 - 0.00429891410546283f * y4;
        kE = -0.042416883008123074f * y1 + 0.1115693827987602f * y2 - 0.09764676325265872f * y3 + 0.028494263462021576f * y4;

        // Pre-delay: 6 ms (the node's fixed default), truncated to whole frames.
        const int preDelay = std::min (kMaxPreDelay - 1, (int) (0.006f * sr));
        if (preDelay != lastPreDelay)
        {
            lastPreDelay = preDelay;
            for (auto& b : pre) std::fill (b.begin(), b.end(), 0.0f);
            readIndex = 0;
            writeIndex = preDelay;
        }
    }

    /** In-place stereo processing (R may be null for mono). */
    void process (float* L, float* R, int num) noexcept
    {
        for (int i = 0; i < num; ++i)
        {
            if (divCounter == 0) startDivision();
            if (++divCounter == kDivision) divCounter = 0;

            const float l = L[i], r = R ? R[i] : l;
            pre[0][(size_t) writeIndex] = l;
            pre[1][(size_t) writeIndex] = r;
            const float absInput = std::max (std::abs (l), std::abs (r));

            const float shaped = saturate (absInput, k);
            const float attenuation = absInput <= 0.0001f ? 1.0f : shaped / absInput;
            float attenuationDb = -linToDb (attenuation);
            attenuationDb = std::max (2.0f, attenuationDb);
            const float dbPerFrame = attenuationDb / satReleaseFrames;
            const float satReleaseRate = dbToLin (dbPerFrame) - 1.0f;
            const bool isRelease = attenuation > detectorAverage;
            const float rate = isRelease ? satReleaseRate : 1.0f;
            detectorAverage += (attenuation - detectorAverage) * rate;
            detectorAverage = std::min (1.0f, detectorAverage);
            if (! std::isfinite (detectorAverage)) detectorAverage = 1;

            if (envelopeRate < 1)
                compressorGain += (scaledDesiredGain - compressorGain) * envelopeRate;
            else
                compressorGain = std::min (1.0f, compressorGain * envelopeRate);

            const float postWarp = std::sin (kHalfPiF * compressorGain);
            const float totalGain = makeup * postWarp;

            const float dbReal = 20.0f * std::log10 (postWarp);
            if (dbReal < meteringGain) meteringGain = dbReal;
            else meteringGain += (dbReal - meteringGain) * meterReleaseK;

            L[i] = pre[0][(size_t) readIndex] * totalGain;
            if (R) R[i] = pre[1][(size_t) readIndex] * totalGain;
            readIndex = (readIndex + 1) & (kMaxPreDelay - 1);
            writeIndex = (writeIndex + 1) & (kMaxPreDelay - 1);
        }
        if (std::abs (detectorAverage) < 1.0e-30f) detectorAverage = 0;
        if (std::abs (compressorGain) < 1.0e-30f) compressorGain = 0;
    }

    /** Current gain reduction in dB (negative), as the node's `reduction` reports it. */
    double reductionDb() const noexcept { return std::isfinite (meteringGain) ? std::min (0.0f, meteringGain) : 0.0; }
    int latency() const noexcept { return lastPreDelay; }

private:
    static constexpr int kMaxPreDelay = 1024, kDivision = 32;
    static constexpr float kHalfPiF = 1.57079632679489661923f;

    static float linToDb (float x) noexcept { return 20.0f * std::log10 (x); }
    static float dbToLin (float x) noexcept { return std::pow (10.0f, 0.05f * x); }

    float kneeCurve (float x, float kk) const noexcept
    {
        if (x < linearThreshold) return x;
        return linearThreshold + (1 - std::exp (-kk * (x - linearThreshold))) / kk;
    }
    float saturate (float x, float kk) const noexcept
    {
        if (x < kneeThreshold) return kneeCurve (x, kk);
        const float xDb = linToDb (x);
        const float yDb = yKneeThresholdDb + slope * (xDb - kneeThresholdDb);
        return dbToLin (yDb);
    }
    float slopeAt (float x, float kk) const noexcept
    {
        if (x < linearThreshold) return 1;
        const float x2 = x * 1.001f;
        const float xDb = linToDb (x), x2Db = linToDb (x2);
        const float yDb = linToDb (kneeCurve (x, kk)), y2Db = linToDb (kneeCurve (x2, kk));
        return (y2Db - yDb) / (x2Db - xDb);
    }
    float kAtSlope (float desiredSlope) const noexcept
    {
        const float x = dbToLin (dbThreshold + dbKnee);
        float minK = 0.1f, maxK = 10000.0f, kk = 5.0f;
        for (int i = 0; i < 15; ++i)
        {
            if (slopeAt (x, kk) < desiredSlope) maxK = kk; else minK = kk;
            kk = std::sqrt (minK * maxK);
        }
        return kk;
    }
    float updateStaticCurve (float dbThr, float dbKn, float ratio)
    {
        auto differs = [] (float a, float b) { return std::abs (a - b) > 0.0f; };
        if (differs (dbThr, dbThreshold) || differs (dbKn, dbKnee) || differs (ratio, ratioCur))
        {
            dbThreshold = dbThr;
            linearThreshold = dbToLin (dbThr);
            dbKnee = dbKn;
            ratioCur = ratio;
            slope = 1 / ratio;
            const float kk = kAtSlope (1 / ratio);
            kneeThresholdDb = dbThr + dbKn;
            kneeThreshold = dbToLin (kneeThresholdDb);
            yKneeThresholdDb = linToDb (kneeCurve (kneeThreshold, kk));
            kCur = kk;
        }
        return kCur;
    }

    /** Once per 32 frames: where the gain is heading and how fast. */
    void startDivision() noexcept
    {
        if (! std::isfinite (detectorAverage)) detectorAverage = 1;
        const float desiredGain = detectorAverage;
        scaledDesiredGain = std::asin (desiredGain) / kHalfPiF;
        const bool isReleasing = scaledDesiredGain > compressorGain;
        float diffDb = linToDb (compressorGain / scaledDesiredGain);
        if (isReleasing)
        {
            maxAttackDiffDb = -1;
            attackUnset = true;
            if (! std::isfinite (diffDb)) diffDb = -1;
            float x = juce::jlimit (-12.0f, 0.0f, diffDb);
            x = 0.25f * (x + 12);
            const float x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
            const float releaseFrames = kA + kB * x + kC * x2 + kD * x3 + kE * x4;
            envelopeRate = dbToLin (5.0f / releaseFrames);
        }
        else
        {
            if (! std::isfinite (diffDb)) diffDb = 1;
            if (attackUnset || maxAttackDiffDb < diffDb) maxAttackDiffDb = diffDb;
            attackUnset = false;
            const float effDiffDb = std::max (0.5f, maxAttackDiffDb);
            const float x = 0.25f / effDiffDb;
            envelopeRate = 1 - std::pow (x, 1 / attackFrames);
        }
    }

    float sr = 48000;
    float thr = -24, knee = 30, ratioIn = 12, att = 0.003f, rel = 0.25f;
    float dbThreshold = 1.0e9f, dbKnee = -1, ratioCur = -1, linearThreshold = 0, slope = 1;
    float kneeThresholdDb = 0, kneeThreshold = 0, yKneeThresholdDb = 0, kCur = 1, k = 1, makeup = 1;
    float attackFrames = 1, satReleaseFrames = 1, kA = 0, kB = 0, kC = 0, kD = 0, kE = 0;
    float detectorAverage = 0, compressorGain = 1, meteringGain = 1, meterReleaseK = 0;
    float maxAttackDiffDb = -1, scaledDesiredGain = 0, envelopeRate = 1;
    bool attackUnset = true;
    std::vector<float> pre[2];
    int lastPreDelay = 256, readIndex = 0, writeIndex = 256, divCounter = 0;
};

} // namespace nxw::dsp
