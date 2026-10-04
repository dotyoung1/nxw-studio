#include "Instruments.h"

namespace nxw
{
namespace
{
    /** expEnv(g, t, peak, a, d) from the browser engine. */
    void expEnv (dsp::Timeline& tl, double sr, double peak, double a, double d)
    {
        tl.reset (0.0001);
        tl.set (0.0001, 0);
        tl.expTo (juce::jmax (0.0002, peak), a * sr);
        tl.expTo (0.0001, (a + d) * sr);
    }

    template <typename V, size_t N>
    V& allocate (std::array<V, N>& pool)
    {
        V* best = nullptr;
        for (auto& v : pool)
            if (! v.c.active) return v;
        for (auto& v : pool)
            if (best == nullptr || v.c.start < best->c.start) best = &v;
        return *best;
    }

    template <typename V, size_t N>
    int countActive (const std::array<V, N>& pool)
    {
        int n = 0;
        for (auto& v : pool) n += v.c.active ? 1 : 0;
        return n;
    }

    void initCommon (VoiceCommon& c, int64 when, int key, juce::uint32 tag, double outGain)
    {
        c.active = true;
        c.start = when;
        c.key = key;
        c.tag = tag;
        c.localT = 0;
        c.relAt = -1;
        c.held = false;
        c.stopAt = 1.0e18;
        c.out.reset (outGain);
    }

    template <typename V, size_t N>
    void chokePool (std::array<V, N>& pool, int64 when, double sr)
    {
        const int64 guard = (int64) (0.0005 * sr);
        for (auto& v : pool)
        {
            auto& c = v.c;
            const int64 started = c.start;
            if (c.active && started < when - guard && (double) started + c.stopAt > (double) when)
                c.chokeAt (when, sr);
        }
    }

    inline float hermite (const float* d, int len, double pos) noexcept
    {
        const int i = (int) pos;
        const float f = (float) (pos - i);
        const float xm1 = d[i > 0 ? i - 1 : 0];
        const float x0  = d[i];
        const float x1  = d[i + 1 < len ? i + 1 : len - 1];
        const float x2  = d[i + 2 < len ? i + 2 : len - 1];
        const float c1 = 0.5f * (x1 - xm1);
        const float c2 = xm1 - 2.5f * x0 + 2.0f * x1 - 0.5f * x2;
        const float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
        return ((c3 * f + c2) * f + c1) * f + x0;
    }
}

//==============================================================================
// Drums
//==============================================================================
void DrumInstrument::setup (Voice& v, int key, float vel)
{
    const auto& p = params;
    const double pm = std::pow (2.0, (p.tune + key - 60) / 12.0), dm = p.decay, tn = p.tone;
    v.kind = p.kind;
    v.nOsc = 0;
    v.freqAutomated = false;
    v.preGain = 1; v.noiseGain = 1;
    v.noise.seed ((juce::uint32) juce::Random::getSystemRandom().nextInt() | 1u);
    v.shaper.setK (1.6);
    for (auto* f : { &v.fa1, &v.fa2, &v.fb1 }) f->reset();
    v.envB.reset (0);
    v.c.out.reset (vel * p.level);

    auto osc = [&] (dsp::Osc::Wave w, double hz) { v.osc[v.nOsc].start (w); v.freq[v.nOsc] = hz; ++v.nOsc; };
    auto filt = [&] (dsp::Biquad& b, dsp::Biquad::Type t, double hz, double q, double gain = 0)
    {
        b.setup (t, sr);
        b.set (juce::jmin (hz, 20000.0), q, gain);
        b.reset();
    };
    double end = 0.5;

    switch (p.kind)
    {
        case DrumKind::Kick:
        {
            osc (dsp::Osc::Sine, 50);
            const double fEnd = 46 * pm, fStart = fEnd * (3 + tn * 6), d = 0.42 * dm;
            v.freqTl.reset (fStart); v.freqTl.set (fStart, 0); v.freqTl.expTo (fEnd, (0.045 + 0.05 * (1 - tn)) * sr);
            v.freqAutomated = true;
            expEnv (v.envA, sr, 1, 0.002, d);
            filt (v.fb1, dsp::Biquad::Highpass, 2600, 1);
            expEnv (v.envB, sr, 0.2 + 0.45 * tn, 0.001, 0.012);
            end = d + 0.06;
            break;
        }
        case DrumKind::K808:
        {
            const double f = dsp::mtof (key - 24 + p.tune);
            osc (dsp::Osc::Sine, f);
            v.freqTl.reset (f * 2.2); v.freqTl.set (f * 2.2, 0); v.freqTl.expTo (f, 0.045 * sr);
            v.freqAutomated = true;
            v.preGain = 1 + tn * 5;
            const double d = 1.15 * dm;
            expEnv (v.envA, sr, 0.85, 0.003, d);
            end = d + 0.06;
            break;
        }
        case DrumKind::Snare:
        {
            osc (dsp::Osc::Triangle, 190 * pm);
            v.freqTl.reset (250 * pm); v.freqTl.set (250 * pm, 0); v.freqTl.expTo (175 * pm, 0.05 * sr);
            v.freqAutomated = true;
            expEnv (v.envA, sr, 0.75, 0.001, 0.11 * dm);
            filt (v.fb1, dsp::Biquad::Highpass, 900 + tn * 1600, 0.7);
            filt (v.fa2, dsp::Biquad::Peaking, 5200, 1.2, 5);
            const double d = (0.14 + 0.1 * tn) * dm;
            expEnv (v.envB, sr, 0.72, 0.001, d);
            end = juce::jmax (d, 0.12 * dm) + 0.06;
            break;
        }
        case DrumKind::Clap:
        {
            filt (v.fa1, dsp::Biquad::Bandpass, 1150 * pm, 1.1);
            filt (v.fa2, dsp::Biquad::Highpass, 520, 1);
            v.envA.reset (0.0001);
            v.envA.set (0.0001, 0);
            for (int i = 0; i < 3; ++i)
            {
                const double ti = i * 0.0105;
                v.envA.set (3, ti * sr);
                v.envA.expTo (0.3, (ti + 0.0095) * sr);
            }
            const double tail = 0.032, d = (0.16 + 0.16 * tn) * dm;
            v.envA.set (2.7, tail * sr);
            v.envA.expTo (0.0001, (tail + d) * sr);
            end = tail + d + 0.06;
            break;
        }
        case DrumKind::Hat:
        case DrumKind::OHat:
        case DrumKind::Crash:
        {
            const bool crash = p.kind == DrumKind::Crash;
            const double mul = (crash ? 1.45 : 1.0) * pm;
            for (double f : { 205.3, 304.4, 369.6, 522.7, 540.0, 800.0 })
                osc (dsp::Osc::Square, f * mul);
            v.noiseGain = 0.6 + 0.5 * tn;
            filt (v.fa1, dsp::Biquad::Bandpass, crash ? 8200 : 9000 + 3000 * tn, 0.75);
            filt (v.fa2, dsp::Biquad::Highpass, crash ? 4200 : 6800, 0.7);
            const double d = (p.kind == DrumKind::Hat ? 0.055 : p.kind == DrumKind::OHat ? 0.34 : 1.5) * dm;
            expEnv (v.envA, sr, crash ? 1.1 : 1.5, 0.001, d);
            end = d + 0.06;
            break;
        }
        case DrumKind::Tom:
        {
            osc (dsp::Osc::Sine, 150 * pm);
            const double d = 0.4 * dm;
            v.freqTl.reset (200 * pm); v.freqTl.set (200 * pm, 0); v.freqTl.expTo (105 * pm, 0.28 * dm * sr);
            v.freqAutomated = true;
            expEnv (v.envA, sr, 1, 0.002, d);
            filt (v.fb1, dsp::Biquad::Bandpass, 2500, 0.8);
            expEnv (v.envB, sr, 0.25 * (0.5 + tn), 0.001, 0.02);
            end = d + 0.06;
            break;
        }
        case DrumKind::Rim:
        {
            osc (dsp::Osc::Square, 820 * pm);
            osc (dsp::Osc::Triangle, 1650 * pm);
            filt (v.fa1, dsp::Biquad::Bandpass, 1900 * pm, 3.5);
            const double d = 0.05 * dm;
            expEnv (v.envA, sr, 1.6, 0.0006, d);
            end = d + 0.05;
            break;
        }
        case DrumKind::Bell:
        {
            osc (dsp::Osc::Square, 540 * pm);
            osc (dsp::Osc::Square, 800 * pm);
            filt (v.fa1, dsp::Biquad::Bandpass, 2640 * pm, 1.4);
            const double d = 0.32 * dm;
            v.envA.reset (0.0001);
            v.envA.set (0.0001, 0);
            v.envA.expTo (1.6, 0.002 * sr);
            v.envA.expTo (0.5, 0.03 * sr);
            v.envA.expTo (0.0001, d * sr);
            end = d + 0.05;
            break;
        }
        case DrumKind::Shaker:
        {
            filt (v.fa1, dsp::Biquad::Bandpass, 6500 * pm, 1.4);
            filt (v.fa2, dsp::Biquad::Highpass, 3200, 1);
            const double d = 0.1 * dm;
            v.envA.reset (0.0001);
            v.envA.set (0.0001, 0);
            v.envA.expTo (1.7, (0.012 + 0.025 * tn) * sr);
            v.envA.expTo (0.0001, (0.03 + d) * sr);
            end = d + 0.08;
            break;
        }
    }
    v.c.stopAt = end * sr;
}

void DrumInstrument::noteOn (int64 when, int key, float vel, double, juce::uint32 tag)
{
    auto& v = allocate (voices);
    initCommon (v.c, when, key, tag, vel * params.level);
    setup (v, key, vel);
}

void DrumInstrument::choke (int64 when) { chokePool (voices, when, sr); }
int DrumInstrument::activeVoices() const { return countActive (voices); }

bool DrumInstrument::render (float* L, float* R, int64 blockStart, int n)
{
    for (auto& v : voices)
    {
        if (! v.c.active || v.c.start >= blockStart + n) continue;
        const int i0 = (int) juce::jmax ((int64) 0, v.c.start - blockStart);
        auto& c = v.c;

        for (int i = i0; i < n; ++i)
        {
            if (c.localT >= c.stopAt) { c.active = false; break; }
            float y = 0;
            switch (v.kind)
            {
                case DrumKind::Kick:
                {
                    const double f = v.freqTl.next();
                    y = v.shaper (v.osc[0].next (f, sr)) * (float) v.envA.next();
                    y += v.fb1.process (v.noise.next()) * (float) v.envB.next();
                    break;
                }
                case DrumKind::K808:
                {
                    const double f = v.freqTl.next();
                    y = v.shaper ((float) (v.osc[0].next (f, sr) * v.preGain)) * (float) v.envA.next();
                    break;
                }
                case DrumKind::Snare:
                {
                    const double f = v.freqTl.next();
                    y = v.osc[0].next (f, sr) * (float) v.envA.next();
                    y += v.fa2.process (v.fb1.process (v.noise.next())) * (float) v.envB.next();
                    break;
                }
                case DrumKind::Clap:
                    y = v.fa2.process (v.fa1.process (v.noise.next())) * (float) v.envA.next();
                    break;
                case DrumKind::Hat:
                case DrumKind::OHat:
                case DrumKind::Crash:
                {
                    float src = 0;
                    for (int k = 0; k < v.nOsc; ++k) src += v.osc[k].next (v.freq[k], sr);
                    src = src * 0.55f + v.noise.next() * (float) v.noiseGain;
                    y = v.fa2.process (v.fa1.process (src)) * (float) v.envA.next();
                    break;
                }
                case DrumKind::Tom:
                {
                    const double f = v.freqTl.next();
                    y = v.osc[0].next (f, sr) * (float) v.envA.next();
                    y += v.fb1.process (v.noise.next()) * (float) v.envB.next();
                    break;
                }
                case DrumKind::Rim:
                {
                    const float src = v.osc[0].next (v.freq[0], sr) + v.osc[1].next (v.freq[1], sr);
                    y = v.fa1.process (src) * (float) v.envA.next();
                    break;
                }
                case DrumKind::Bell:
                {
                    const float src = 0.5f * (v.osc[0].next (v.freq[0], sr) + v.osc[1].next (v.freq[1], sr));
                    y = v.fa1.process (src) * (float) v.envA.next();
                    break;
                }
                case DrumKind::Shaker:
                    y = v.fa2.process (v.fa1.process (v.noise.next())) * (float) v.envA.next();
                    break;
            }
            y *= (float) c.out.next();
            L[i] += y; R[i] += y;
            c.localT += 1;
        }
        v.fa1.sanitise(); v.fa2.sanitise(); v.fb1.sanitise();
    }
    return false;   // drum voices are mono
}

//==============================================================================
// NX-3 synth
//==============================================================================
void SynthInstrument::noteOn (int64 when, int key, float vel, double durSamples, juce::uint32 tag)
{
    auto& v = allocate (voices);
    initCommon (v.c, when, key, tag, 1.0);
    v.c.held = durSamples < 0;
    v.p = params;
    const auto& p = v.p;

    const double f = dsp::mtof (key);
    const int uni = juce::jlimit (1, 7, p.uni);
    const double nrm = 1.0 / std::sqrt ((double) uni), f2 = f * std::pow (2.0, p.semi2 / 12.0);
    v.nSlots = 0;
    v.stereo = false;

    auto add = [&] (dsp::Osc::Wave w, double hz, double cents, double g, double pan)
    {
        if (g <= 0.0005 || v.nSlots >= 15) return;
        auto& s = v.slots[v.nSlots++];
        s.osc.start (w);
        s.hz = hz * std::pow (2.0, cents / 1200.0);
        s.gain = g;
        s.side = pan < -0.01 ? 1 : (pan > 0.01 ? 2 : 0);
        s.delay = uni > 1 ? dsp::sharedRandom().uniform01() * 0.003 * sr : 0.0;
        if (s.side != 0) v.stereo = true;
    };

    for (int u = 0; u < uni; ++u)
    {
        const double s = uni == 1 ? 0.0 : (u / (double) (uni - 1)) * 2.0 - 1.0;
        add (p.w1, f, s * p.spread, (1 - p.mix) * nrm, s);
        add (p.w2, f2, p.det + s * p.spread * 0.85, p.mix * nrm, -s);
    }
    add (dsp::Osc::Sine, f / 2, 0, p.sub * 0.8, 0);

    const double kt = std::pow (2.0, ((key - 60) / 12.0) * 0.35);
    const double base = dsp::clampv (p.cut * kt, 30.0, 20000.0), peakF = dsp::clampv (base * std::pow (2.0, p.env * 6), 30.0, 20000.0);
    v.cutoff.reset (base);
    v.cutoff.set (base, 0);
    if (std::abs (p.env) > 0.01)
    {
        v.cutoff.expTo (peakF, p.fatt * sr);
        v.cutoff.targetAt (base, p.fatt * sr, p.fdec / 3.0 * sr);
    }
    const double peak = vel * p.gain * 0.8;
    v.vca.reset (0);
    v.vca.set (0, 0);
    v.vca.linearTo (peak, p.att * sr);
    v.vca.targetAt (peak * p.sus, p.att * sr, juce::jmax (0.003, p.dec / 3.0) * sr);

    v.filter.setup (dsp::Biquad::Lowpass, sr);
    v.filter.reset();
    v.lastCut = -1;
    v.coefCountdown = 0;
    v.c.stopAt = 600.0 * sr;
    if (durSamples >= 0) release (v, durSamples);
}

void SynthInstrument::release (Voice& v, double te)
{
    te = juce::jmax (te, (v.p.att + 0.001) * sr);
    if (v.c.relAt >= 0 && v.c.relAt <= te) return;
    v.c.relAt = te;
    v.vca.targetAt (0, te, juce::jmax (0.004, v.p.rel / 4.0) * sr);
    v.c.stopAt = te + (v.p.rel * 2 + 0.06) * sr;
}

void SynthInstrument::noteOff (int64 when, int key, juce::uint32 tag)
{
    for (auto& v : voices)
        if (v.c.active && (tag != 0 ? v.c.tag == tag : (v.c.key == key && v.c.held)))
            release (v, juce::jmax (v.c.localT, (double) (when - v.c.start)));
}

void SynthInstrument::releaseAll (int64 when)
{
    for (auto& v : voices)
        if (v.c.active) release (v, juce::jmax (v.c.localT, (double) (when - v.c.start)));
}

void SynthInstrument::choke (int64 when) { chokePool (voices, when, sr); }
int SynthInstrument::activeVoices() const { return countActive (voices); }

bool SynthInstrument::render (float* L, float* R, int64 blockStart, int n)
{
    // Pan constants for the browser's ±0.7 unison panners (mono input law).
    constexpr float panNear = 0.97236992f, panFar = 0.23344536f;
    bool anyStereo = false;

    for (auto& v : voices)
    {
        if (! v.c.active || v.c.start >= blockStart + n) continue;
        const int i0 = (int) juce::jmax ((int64) 0, v.c.start - blockStart);
        auto& c = v.c;
        anyStereo = anyStereo || v.stereo;
        const double res = v.p.res;

        for (int i = i0; i < n; ++i)
        {
            if (c.localT >= c.stopAt) { c.active = false; break; }
            float bc = 0, bl = 0, br = 0;
            for (int k = 0; k < v.nSlots; ++k)
            {
                auto& s = v.slots[k];
                if (c.localT < s.delay) continue;
                const float val = s.osc.next (s.hz, sr) * (float) s.gain;
                if (s.side == 0) bc += val; else if (s.side == 1) bl += val; else br += val;
            }

            const double cut = v.cutoff.next();
            if (--v.coefCountdown <= 0)
            {
                v.coefCountdown = 16;
                if (v.lastCut < 0 || std::abs (cut - v.lastCut) > v.lastCut * 0.002)
                {
                    v.filter.set (cut, res);
                    v.lastCut = cut;
                }
            }

            const float g = (float) (v.vca.next() * c.out.next());
            if (v.stereo)
            {
                const float xl = bc + bl * panNear + br * panFar;
                const float xr = bc + bl * panFar + br * panNear;
                L[i] += v.filter.process (xl, 0) * g;
                R[i] += v.filter.process (xr, 1) * g;
            }
            else
            {
                const float y = v.filter.process (bc, 0) * g;
                L[i] += y; R[i] += y;
            }
            c.localT += 1;
        }
        v.filter.sanitise();
    }
    return anyStereo;
}

//==============================================================================
// Sampler
//==============================================================================
void SamplerInstrument::noteOn (int64 when, int key, float vel, double durSamples, juce::uint32 tag)
{
    if (sample == nullptr || sample->buffer.getNumSamples() < 2) return;
    auto& v = allocate (voices);
    initCommon (v.c, when, key, tag, 1.0);
    v.c.held = durSamples < 0;
    v.data = sample;
    v.reverse = params.rev && sample->hasReversed.load();
    v.oneshot = params.oneshot;
    v.att = juce::jmax (0.0005, params.att);
    v.rel = juce::jmax (0.005, params.rel);
    v.rate = std::pow (2.0, (key - 60 + params.pitch) / 12.0) * (sample->sampleRate / sr);
    const int len = sample->buffer.getNumSamples();
    v.pos = dsp::clampv (params.start, 0.0, 0.95) * len;
    const double peak = vel * params.gain;
    v.g.reset (0);
    v.g.set (0, 0);
    v.g.linearTo (peak, v.att * sr);
    v.c.stopAt = (len - 1 - v.pos) / juce::jmax (1.0e-6, v.rate);
    if (durSamples >= 0) release (v, durSamples);
}

void SamplerInstrument::release (Voice& v, double te)
{
    if (v.oneshot) return;
    te = juce::jmax (te, (v.att + 0.001) * sr);
    if (v.c.relAt >= 0 && v.c.relAt <= te) return;
    v.c.relAt = te;
    v.g.targetAt (0, te, juce::jmax (0.004, v.rel / 4.0) * sr);
    v.c.stopAt = juce::jmin (v.c.stopAt, te + (v.rel * 2 + 0.05) * sr);
}

void SamplerInstrument::noteOff (int64 when, int key, juce::uint32 tag)
{
    for (auto& v : voices)
        if (v.c.active && (tag != 0 ? v.c.tag == tag : (v.c.key == key && v.c.held)))
            release (v, juce::jmax (v.c.localT, (double) (when - v.c.start)));
}

void SamplerInstrument::releaseAll (int64 when)
{
    for (auto& v : voices)
        if (v.c.active) release (v, juce::jmax (v.c.localT, (double) (when - v.c.start)));
}

void SamplerInstrument::choke (int64 when) { chokePool (voices, when, sr); }
int SamplerInstrument::activeVoices() const { return countActive (voices); }

bool SamplerInstrument::render (float* L, float* R, int64 blockStart, int n)
{
    bool anyStereo = false;
    for (auto& v : voices)
    {
        if (! v.c.active || v.c.start >= blockStart + n || v.data == nullptr) continue;
        const int i0 = (int) juce::jmax ((int64) 0, v.c.start - blockStart);
        auto& c = v.c;
        const auto& buf = v.reverse ? v.data->reversed : v.data->buffer;
        const int len = buf.getNumSamples();
        const bool stereo = buf.getNumChannels() > 1;
        anyStereo = anyStereo || stereo;
        const float* d0 = buf.getReadPointer (0);
        const float* d1 = stereo ? buf.getReadPointer (1) : d0;

        for (int i = i0; i < n; ++i)
        {
            if (c.localT >= c.stopAt || v.pos >= len - 1) { c.active = false; break; }
            const float g = (float) (v.g.next() * c.out.next());
            const float l = hermite (d0, len, v.pos) * g;
            const float r = stereo ? hermite (d1, len, v.pos) * g : l;
            L[i] += l; R[i] += r;
            v.pos += v.rate;
            c.localT += 1;
        }
        if (! c.active) v.data.reset();
    }
    return anyStereo;
}

//==============================================================================
void Metronome::click (int64 when, bool accent)
{
    Click* slot = nullptr;
    for (auto& c : clicks) if (! c.active) { slot = &c; break; }
    if (slot == nullptr) slot = &clicks[0];
    slot->active = true;
    slot->start = when;
    slot->t = 0;
    slot->freq = accent ? 1760 : 1245;
    slot->osc.start (dsp::Osc::Sine);
    slot->g.reset (0.0001);
    slot->g.set (0.0001, 0);
    slot->g.expTo (accent ? 0.45 : 0.28, 0.001 * sr);
    slot->g.expTo (0.0001, 0.05 * sr);
}

void Metronome::render (float* L, float* R, int64 blockStart, int n)
{
    for (auto& c : clicks)
    {
        if (! c.active || c.start >= blockStart + n) continue;
        const int i0 = (int) juce::jmax ((int64) 0, c.start - blockStart);
        for (int i = i0; i < n; ++i)
        {
            if (c.t >= 0.06 * sr) { c.active = false; break; }
            const float y = c.osc.next (c.freq, sr) * (float) c.g.next();
            L[i] += y; R[i] += y;
            c.t += 1;
        }
    }
}

} // namespace nxw
