#include "Effects.h"

namespace nxw
{
namespace
{
    constexpr double kDelaySteps[] = { 1, 2, 3, 4, 6, 8 };

    struct WetDry
    {
        dsp::Smoother dry, wet;
        void prepare (double sr, double mix) { dry.setTau (0.02, sr); wet.setTau (0.02, sr); set (mix); dry.snap(); wet.snap(); }
        void set (double m) { dry.setTarget (std::cos (m * dsp::kPi / 2)); wet.setTarget (std::sin (m * dsp::kPi / 2)); }
    };

    //==========================================================================
    class ShelfEq : public Effect
    {
    public:
        void prepare (double sampleRate, int) override
        {
            sr = sampleRate;
            for (auto* s : { &low, &mid, &midf, &high }) s->setTau (0.02, sr);
            lo.setup (dsp::Biquad::Lowshelf, sr); pk.setup (dsp::Biquad::Peaking, sr); hi.setup (dsp::Biquad::Highshelf, sr);
            low.snap(); mid.snap(); midf.snap(); high.snap();
            update();
        }
        void reset() override { lo.reset(); pk.reset(); hi.reset(); }
        void setParams (const FxModel& f) override
        {
            low.setTarget (f.p ("low", 0)); mid.setTarget (f.p ("mid", 0)); midf.setTarget (f.p ("midf", 1200)); high.setTarget (f.p ("high", 0));
            if (! primed) { low.snap(); mid.snap(); midf.snap(); high.snap(); primed = true; update(); }
        }
        void process (float* L, float* R, int n, int64) override
        {
            for (int i = 0; i < n; ++i)
            {
                if ((i & 31) == 0 && ! (low.settled() && mid.settled() && midf.settled() && high.settled())) update();
                low.next(); mid.next(); midf.next(); high.next();
                L[i] = hi.process (pk.process (lo.process (L[i], 0), 0), 0);
                R[i] = hi.process (pk.process (lo.process (R[i], 1), 1), 1);
            }
            lo.sanitise(); pk.sanitise(); hi.sanitise();
        }
    private:
        void update() { lo.set (140, 1, low.cur); pk.set (midf.cur, 0.9, mid.cur); hi.set (7000, 1, high.cur); }
        double sr = 48000;
        bool primed = false;
        dsp::Smoother low, mid, midf, high;
        dsp::Biquad lo, pk, hi;
    };

    //==========================================================================
    class SweepFilter : public Effect
    {
    public:
        void prepare (double sampleRate, int) override
        {
            sr = sampleRate;
            for (auto* s : { &cut, &res }) s->setTau (0.02, sr);
            for (auto* s : { &rate, &depth }) s->setTau (0.05, sr);
            cut.snap(); res.snap(); rate.snap(); depth.snap();
            f.setup (dsp::Biquad::Lowpass, sr);
        }
        void reset() override { f.reset(); }
        void setParams (const FxModel& fx) override
        {
            const int m = (int) fx.p ("mode", 0);
            const auto t = m == 1 ? dsp::Biquad::Highpass : m == 2 ? dsp::Biquad::Bandpass : dsp::Biquad::Lowpass;
            if (t != type) { type = t; f.setup (t, sr); }
            cut.setTarget (fx.p ("cut", 18000)); res.setTarget (fx.p ("res", 0.8));
            rate.setTarget (fx.p ("rate", 0.4)); depth.setTarget (fx.p ("lfo", 0) * 2400.0);
            if (! primed) { cut.snap(); res.snap(); rate.snap(); depth.snap(); primed = true; }
        }
        void process (float* L, float* R, int n, int64) override
        {
            for (int i = 0; i < n; ++i)
            {
                const double c = cut.next(), q = res.next(), r = rate.next(), d = depth.next();
                phase += r / sr; if (phase >= 1) phase -= 1;
                if ((i & 15) == 0)
                {
                    const double cents = std::sin (dsp::kTwoPi * phase) * d;
                    f.set (c * std::pow (2.0, cents / 1200.0), q);
                }
                L[i] = f.process (L[i], 0);
                R[i] = f.process (R[i], 1);
            }
            f.sanitise();
        }
    private:
        double sr = 48000, phase = 0;
        bool primed = false;
        dsp::Biquad::Type type = dsp::Biquad::Lowpass;
        dsp::Smoother cut, res, rate, depth;
        dsp::Biquad f;
    };

    //==========================================================================
    class TubeDrive : public Effect
    {
    public:
        void prepare (double sampleRate, int) override
        {
            sr = sampleRate;
            for (auto* s : { &drive, &post, &tone }) s->setTau (0.02, sr);
            wd.prepare (sr, 1);
            lp.setup (dsp::Biquad::Lowpass, sr);
            shaper.setK (1.6);
            wetL.prepare ((kShaperLatency + 8) / sr, sr);
            wetR.prepare ((kShaperLatency + 8) / sr, sr);
        }
        void reset() override { lp.reset(); wetL.clear(); wetR.clear(); }
        void setParams (const FxModel& fx) override
        {
            const double d = fx.p ("drive", 4);
            drive.setTarget (d);
            post.setTarget (dsp::dbToGain (fx.p ("out", 0)) / std::pow (d, 0.35));
            tone.setTarget (fx.p ("tone", 7000));
            wd.set (fx.p ("mix", 1));
            if (! primed) { drive.snap(); post.snap(); tone.snap(); wd.dry.snap(); wd.wet.snap(); primed = true; lp.set (tone.cur, 0.6); }
        }
        void process (float* L, float* R, int n, int64) override
        {
            for (int i = 0; i < n; ++i)
            {
                const double d = drive.next(), pg = post.next(), tn = tone.next();
                if ((i & 31) == 0) lp.set (tn, 0.6);
                const float dry = (float) wd.dry.next(), wet = (float) wd.wet.next();
                const float wl = lp.process (shaper ((float) (L[i] * d)), 0) * (float) pg;
                const float wr = lp.process (shaper ((float) (R[i] * d)), 1) * (float) pg;
                // Web Audio's 2x-oversampled shaper delays the driven signal by 128 samples; the
                // presets were voiced with that comb against the dry signal, so it is kept.
                wetL.push (wl); wetR.push (wr);
                const float dl = wetL.read (kShaperLatency), dr = wetR.read (kShaperLatency);
                L[i] = L[i] * dry + dl * wet;
                R[i] = R[i] * dry + dr * wet;
            }
            lp.sanitise();
        }
    private:
        double sr = 48000;
        bool primed = false;
        dsp::Smoother drive, post, tone;
        WetDry wd;
        dsp::Biquad lp;
        dsp::Shaper shaper;
        static constexpr int kShaperLatency = 128;
        dsp::DelayLine wetL, wetR;
    };

    //==========================================================================
    class GlueComp : public Effect
    {
    public:
        void prepare (double sampleRate, int) override { sr = sampleRate; comp.prepare (sr); makeup.setTau (0.02, sr); makeup.snap(); }
        void reset() override { comp.reset(); }
        void setParams (const FxModel& fx) override
        {
            comp.setParams (fx.p ("thr", -18), 6, fx.p ("ratio", 4), fx.p ("att", 0.01), fx.p ("rel", 0.2));
            makeup.setTarget (dsp::dbToGain (fx.p ("gain", 3)));
            if (! primed) { makeup.snap(); primed = true; }
        }
        void process (float* L, float* R, int n, int64) override
        {
            comp.process (L, R, n);
            for (int i = 0; i < n; ++i) { const float g = (float) makeup.next(); L[i] *= g; R[i] *= g; }
        }
        double reductionDb() const override { return comp.reductionDb(); }
        int latency() const override { return comp.latency(); }
    private:
        double sr = 48000;
        bool primed = false;
        dsp::Compressor comp;
        dsp::Smoother makeup;
    };

    //==========================================================================
    /** Tempo-locked ducker driven by the sequencer clock. */
    class Pump : public Effect
    {
    public:
        void prepare (double sampleRate, int) override { sr = sampleRate; g.reset (1.0, (double) clock); }
        void reset() override { g.reset (1.0, (double) clock); }
        void setParams (const FxModel& fx) override
        {
            every = (int) fx.p ("rate", 0) == 1 ? 2 : 4;
            depth = fx.p ("depth", 0.6);
            rel = fx.p ("rel", 0.55);
        }
        void onStep (int step, int64 when, double sps) override
        {
            if (step % every != 0) return;
            const double beat = sps * every;
            g.targetAt (1.0 - depth, (double) when, 0.004 * sr);
            g.targetAt (1.0, (double) when + 0.025 * sr, juce::jmax (0.01 * sr, rel * beat / 3.0));
        }
        void halt (int64 when) override
        {
            g.cancelFrom ((double) when);
            g.targetAt (1.0, (double) when, 0.03 * sr);
        }
        void process (float* L, float* R, int n, int64 blockStart) override
        {
            // Keep the timeline clock on the engine clock (it drifts only after a bypass or reset).
            if (std::abs (g.now() - (double) blockStart) > 0.5) g.jumpTo ((double) blockStart);

            for (int i = 0; i < n; ++i)
            {
                const float v = (float) g.next();
                L[i] *= v; R[i] *= v;
            }
            clock = blockStart + n;
        }
    private:
        double sr = 48000, depth = 0.6, rel = 0.55;
        int every = 4;
        int64 clock = 0;
        dsp::Timeline g;
    };

    //==========================================================================
    class DualChorus : public Effect
    {
    public:
        void prepare (double sampleRate, int) override
        {
            sr = sampleRate;
            for (auto& d : dl) d.prepare (0.1, sr);
            for (auto* s : { &rate, &depth }) s->setTau (0.05, sr);
            wd.prepare (sr, 0.5);
        }
        void reset() override { for (auto& d : dl) d.clear(); }
        void setParams (const FxModel& fx) override
        {
            rate.setTarget (fx.p ("rate", 0.35)); depth.setTarget (fx.p ("depth", 0.5)); wd.set (fx.p ("mix", 0.5));
            if (! primed) { rate.snap(); depth.snap(); wd.dry.snap(); wd.wet.snap(); primed = true; }
        }
        void process (float* L, float* R, int n, int64) override
        {
            constexpr float nearG = 0.97236992f, farG = 0.23344536f;
            for (int i = 0; i < n; ++i)
            {
                const double r = rate.next(), d = depth.next();
                p1 += r / sr; if (p1 >= 1) p1 -= 1;
                p2 += r * 1.17 / sr; if (p2 >= 1) p2 -= 1;
                const double t1 = (0.017 + std::sin (dsp::kTwoPi * p1) * d * 0.005) * sr;
                const double t2 = (0.023 + std::sin (dsp::kTwoPi * p2) * d * 0.0062) * sr;
                const float l = L[i], rr = R[i];
                dl[0].push (l); dl[1].push (rr); dl[2].push (l); dl[3].push (rr);
                const float d1l = dl[0].read (t1), d1r = dl[1].read (t1);
                const float d2l = dl[2].read (t2), d2r = dl[3].read (t2);
                // panners at -0.85 and +0.85 (stereo input law)
                const float wl = (d1l + d1r * nearG) + (d2l * farG);
                const float wr = (d1r * farG) + (d2r + d2l * nearG);
                const float dry = (float) wd.dry.next(), wet = (float) wd.wet.next();
                L[i] = l * dry + wl * wet;
                R[i] = rr * dry + wr * wet;
            }
        }
    private:
        double sr = 48000, p1 = 0, p2 = 0;
        bool primed = false;
        dsp::DelayLine dl[4];
        dsp::Smoother rate, depth;
        WetDry wd;
    };

    //==========================================================================
    class EchoPong : public Effect
    {
    public:
        void prepare (double sampleRate, int) override
        {
            sr = sampleRate;
            dlL.prepare (4.0, sr); dlR.prepare (4.0, sr);
            time.setTau (0.04, sr);
            for (auto* s : { &fb, &tone }) s->setTau (0.02, sr);
            wd.prepare (sr, 0.28);
            hp.setup (dsp::Biquad::Highpass, sr); hp.set (180, 0.5);
            lp.setup (dsp::Biquad::Lowpass, sr);
        }
        void reset() override { dlL.clear(); dlR.clear(); hp.reset(); lp.reset(); }
        void setParams (const FxModel& fx) override
        {
            timeIdx = juce::jlimit (0, 5, (int) fx.p ("time", 2));
            fb.setTarget (fx.p ("fb", 0.38)); tone.setTarget (fx.p ("tone", 4200)); wd.set (fx.p ("mix", 0.28));
            updateTime();
            if (! primed) { time.snap(); fb.snap(); tone.snap(); wd.dry.snap(); wd.wet.snap(); lp.set (tone.cur, 0.5); primed = true; }
        }
        void setStepLength (double sps) override { stepLen = sps; updateTime(); }
        void process (float* L, float* R, int n, int64) override
        {
            for (int i = 0; i < n; ++i)
            {
                const double t = time.next(), f = fb.next(), tn = tone.next();
                if ((i & 31) == 0) lp.set (tn, 0.5);
                const float mono = 0.5f * (L[i] + R[i]);
                const float h = hp.process (mono, 0);
                const float outL = dlL.read (t - 1), outR = dlR.read (t - 1);
                dlL.push (h + outR * (float) f);
                dlR.push (lp.process (outL, 0) * (float) f);
                const float dry = (float) wd.dry.next(), wet = (float) wd.wet.next();
                L[i] = L[i] * dry + outL * wet;
                R[i] = R[i] * dry + outR * wet;
            }
            hp.sanitise(); lp.sanitise();
        }
    private:
        void updateTime() { time.setTarget (dsp::clampv (kDelaySteps[timeIdx] * stepLen, 2.0, 3.9 * sr)); }
        double sr = 48000, stepLen = 5625;
        int timeIdx = 2;
        bool primed = false;
        dsp::DelayLine dlL, dlR;
        dsp::Smoother time, fb, tone;
        WetDry wd;
        dsp::Biquad hp, lp;
    };

    //==========================================================================
    class PlateHall : public Effect
    {
    public:
        // Large tail partitions keep the long impulse cheap; the 4096-sample head is
        // convolved in device-sized blocks, so the reverb adds no latency.
        PlateHall() : conv (juce::dsp::Convolution::NonUniform { 4096 }) {}

        void prepare (double sampleRate, int maxBlock) override
        {
            sr = sampleRate;
            spec = { sr, (juce::uint32) juce::jmax (1, maxBlock), 2 };
            pre.setTau (0.02, sr); damp.setTau (0.02, sr);
            dlL.prepare (0.5, sr); dlR.prepare (0.5, sr);
            wd.prepare (sr, 0.25);
            lowcut.setup (dsp::Biquad::Highpass, sr); lowcut.set (160, 0.5);
            lp.setup (dsp::Biquad::Lowpass, sr);
            wetBuf.setSize (2, juce::jmax (1, maxBlock));
            irSize = -1;
            if (lastSize > 0) loadIr (lastSize);
            conv.prepare (spec);            // installs a queued impulse synchronously
        }
        void reset() override { conv.reset(); dlL.clear(); dlR.clear(); lowcut.reset(); lp.reset(); }
        void setParams (const FxModel& fx) override
        {
            pre.setTarget (fx.p ("pre", 0.02) * sr);
            damp.setTarget (fx.p ("tone", 6500));
            wd.set (fx.p ("mix", 0.25));
            const double size = fx.p ("size", 2.2);
            if (std::abs (size - irSize) > 0.005)
            {
                loadIr (size);
                // A new reverb gets its impulse before it plays (so an export never starts
                // dry); later size changes load in the background and crossfade.
                if (! primed) conv.prepare (spec);
            }
            if (! primed) { pre.snap(); damp.snap(); wd.dry.snap(); wd.wet.snap(); lp.set (damp.cur, 0.5); primed = true; }
        }
        void process (float* L, float* R, int n, int64) override
        {
            if (wetBuf.getNumSamples() < n) return;   // never happens: blocks are split to maxBlock
            float* wl = wetBuf.getWritePointer (0);
            float* wr = wetBuf.getWritePointer (1);
            for (int i = 0; i < n; ++i)
            {
                const double d = pre.next();
                dlL.push (L[i]); dlR.push (R[i]);
                wl[i] = lowcut.process (d < 1 ? L[i] : dlL.read (d), 0);
                wr[i] = lowcut.process (d < 1 ? R[i] : dlR.read (d), 1);
            }
            float* chans[] = { wl, wr };
            juce::dsp::AudioBlock<float> block (chans, 2, (size_t) n);
            conv.process (juce::dsp::ProcessContextReplacing<float> (block));
            for (int i = 0; i < n; ++i)
            {
                const double dp = damp.next();
                if ((i & 31) == 0) lp.set (dp, 0.5);
                const float dry = (float) wd.dry.next(), wet = (float) wd.wet.next();
                L[i] = L[i] * dry + lp.process (wl[i], 0) * wet;
                R[i] = R[i] * dry + lp.process (wr[i], 1) * wet;
            }
            lowcut.sanitise(); lp.sanitise();
        }
    private:
        /** Same noise impulse as the browser, normalised the way Chromium's ConvolverNode does. */
        void loadIr (double size)
        {
            irSize = lastSize = size;
            const int len = juce::jmax (1, (int) std::floor (sr * size));
            juce::AudioBuffer<float> ir (2, len);
            juce::Random rnd;
            double power = 0;
            for (int ch = 0; ch < 2; ++ch)
            {
                auto* d = ir.getWritePointer (ch);
                for (int i = 0; i < len; ++i)
                {
                    const double x = i / (double) len;
                    const double fade = i < sr * 0.004 ? i / (sr * 0.004) : 1.0;
                    d[i] = (float) ((rnd.nextDouble() * 2 - 1) * std::exp (-x * 5.5) * (1 - x) * fade);
                    power += (double) d[i] * d[i];
                }
            }
            power = std::sqrt (power / (2.0 * len));
            power = juce::jmax (power, 0.000125);
            const double scale = (1.0 / power) * std::pow (10.0, -58.0 * 0.05) * (44100.0 / sr);
            ir.applyGain ((float) scale);
            conv.loadImpulseResponse (std::move (ir), sr, juce::dsp::Convolution::Stereo::yes,
                                      juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
        }

        double sr = 48000, irSize = -1, lastSize = -1;
        bool primed = false;
        juce::dsp::ProcessSpec spec { 48000, 512, 2 };
        juce::dsp::Convolution conv;
        dsp::Smoother pre, damp;
        dsp::DelayLine dlL, dlR;
        WetDry wd;
        dsp::Biquad lowcut, lp;
        juce::AudioBuffer<float> wetBuf;
    };

    /** Unknown effect types pass audio through. */
    class Passthrough : public Effect
    {
    public:
        void prepare (double, int) override {}
        void setParams (const FxModel&) override {}
        void process (float*, float*, int, int64) override {}
    };
}

std::unique_ptr<Effect> makeBuiltinEffect (const juce::String& type)
{
    std::unique_ptr<Effect> e;
    if (type == "eq")          e = std::make_unique<ShelfEq>();
    else if (type == "filter") e = std::make_unique<SweepFilter>();
    else if (type == "drive")  e = std::make_unique<TubeDrive>();
    else if (type == "comp")   e = std::make_unique<GlueComp>();
    else if (type == "pump")   e = std::make_unique<Pump>();
    else if (type == "chorus") e = std::make_unique<DualChorus>();
    else if (type == "delay")  e = std::make_unique<EchoPong>();
    else if (type == "reverb") e = std::make_unique<PlateHall>();
    else                       e = std::make_unique<Passthrough>();
    e->type = type;
    return e;
}

} // namespace nxw
