/*
    NXW Studio · built-in instruments

    Native ports of the browser instruments: the eleven drum models, the NX-3
    two-oscillator synth and the sampler. Each instrument owns a fixed pool of
    voices (no allocation on the audio thread) and renders into a stereo block.
*/
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include "Dsp.h"
#include "Model.h"
#include "SampleBank.h"
#include <array>

namespace nxw
{
using int64 = juce::int64;

/** Base class for everything that makes sound on a channel. */
class Instrument
{
public:
    virtual ~Instrument() = default;
    virtual void prepare (double sampleRate, int maxBlock) { sr = sampleRate; juce::ignoreUnused (maxBlock); }
    /** Called under the engine lock whenever the channel's settings change. */
    virtual void setChannel (const ChannelModel& ch) = 0;
    /** durSamples < 0 means "held until noteOff". */
    virtual void noteOn (int64 when, int key, float vel, double durSamples, juce::uint32 tag) = 0;
    virtual void noteOff (int64 when, int key, juce::uint32 tag) = 0;
    /** Fast fade of every voice that started before `when` (cut itself / choke groups). */
    virtual void choke (int64 when) = 0;
    /** Renders `n` samples starting at absolute sample `blockStart`. Returns true if the output is stereo. */
    virtual bool render (float* L, float* R, int64 blockStart, int n) = 0;
    /** Release every voice (transport stop). */
    virtual void releaseAll (int64 when) = 0;
    /** Silence everything immediately (export, reset). */
    virtual void kill() = 0;
    virtual int activeVoices() const = 0;
    /** Latency the instrument adds (plugins). */
    virtual int latency() const { return 0; }
    /** Plugin instruments return their plugin. */
    virtual juce::AudioPluginInstance* getPlugin() { return nullptr; }
    /** True once after the plugin's settings changed (message thread). */
    virtual bool consumeStateChanged() { return false; }

protected:
    double sr = 48000;
};

//==============================================================================
struct VoiceCommon
{
    bool active = false;
    int64 start = 0;           // absolute sample the voice starts at
    double stopAt = 1.0e18;    // voice-local sample at which it ends
    int key = 60;
    juce::uint32 tag = 0;
    bool held = false;
    double relAt = -1;         // voice-local release time (samples) once released
    dsp::Timeline out;         // output gain (velocity * level), used for choke fades
    double localT = 0;         // samples rendered so far

    void chokeAt (int64 when, double sampleRate)
    {
        const double t = juce::jmax (localT, (double) (when - start));
        out.cancelFrom (t);
        out.targetAt (0.0, t, 0.006 * sampleRate);
        stopAt = juce::jmin (stopAt, t + 0.08 * sampleRate);
    }
};

//==============================================================================
class DrumInstrument : public Instrument
{
public:
    void setChannel (const ChannelModel& ch) override { params = ch.drum; }
    void noteOn (int64 when, int key, float vel, double durSamples, juce::uint32 tag) override;
    void noteOff (int64, int, juce::uint32) override {}
    void choke (int64 when) override;
    bool render (float* L, float* R, int64 blockStart, int n) override;
    void releaseAll (int64) override {}
    void kill() override { for (auto& v : voices) v.c.active = false; }
    int activeVoices() const override;

    /** Plays a one-off hit with explicit parameters (used for previews). */
    void setParams (const DrumParams& p) { params = p; }

private:
    struct Voice
    {
        VoiceCommon c;
        DrumKind kind = DrumKind::Kick;
        dsp::Osc osc[6];
        double freq[6] {};
        int nOsc = 0;
        dsp::Timeline freqTl, envA, envB;
        bool freqAutomated = false;
        dsp::Biquad fa1, fa2, fb1;
        dsp::Noise noise;
        dsp::Shaper shaper;
        double preGain = 1, noiseGain = 1;
    };
    void setup (Voice& v, int key, float vel);

    DrumParams params;
    std::array<Voice, 32> voices;
};

//==============================================================================
class SynthInstrument : public Instrument
{
public:
    void setChannel (const ChannelModel& ch) override { params = ch.synth; }
    void setParams (const SynthParams& p) { params = p; }
    void noteOn (int64 when, int key, float vel, double durSamples, juce::uint32 tag) override;
    void noteOff (int64 when, int key, juce::uint32 tag) override;
    void choke (int64 when) override;
    bool render (float* L, float* R, int64 blockStart, int n) override;
    void releaseAll (int64 when) override;
    void kill() override { for (auto& v : voices) v.c.active = false; }
    int activeVoices() const override;

private:
    struct OscSlot { dsp::Osc osc; double hz = 0, gain = 0; int side = 0; double delay = 0; };
    struct Voice
    {
        VoiceCommon c;
        SynthParams p;
        OscSlot slots[15];
        int nSlots = 0;
        bool stereo = false;
        dsp::Timeline cutoff, vca;
        dsp::Biquad filter;
        double lastCut = -1;
        int coefCountdown = 0;
    };
    void release (Voice& v, double localTime);

    SynthParams params;
    std::array<Voice, 24> voices;
};

//==============================================================================
class SamplerInstrument : public Instrument
{
public:
    void setChannel (const ChannelModel& ch) override { params = ch.sampler; }
    void setParams (const SamplerParams& p) { params = p; }
    /** Swapped in under the engine lock. */
    void setSample (std::shared_ptr<SampleData> s) { sample = std::move (s); }
    bool hasSample() const { return sample != nullptr; }
    void noteOn (int64 when, int key, float vel, double durSamples, juce::uint32 tag) override;
    void noteOff (int64 when, int key, juce::uint32 tag) override;
    void choke (int64 when) override;
    bool render (float* L, float* R, int64 blockStart, int n) override;
    void releaseAll (int64 when) override;
    void kill() override { for (auto& v : voices) v.c.active = false; }
    int activeVoices() const override;

private:
    struct Voice
    {
        VoiceCommon c;
        std::shared_ptr<SampleData> data;
        bool reverse = false, oneshot = true, loop = false, filtered = false;
        double pos = 0, rate = 1, att = 0.002, rel = 0.12;
        double endPos = 0, loopFrom = 0;     // in source samples
        dsp::Timeline g;
        dsp::Biquad filter;
    };
    void release (Voice& v, double localTime);

    SamplerParams params;
    std::shared_ptr<SampleData> sample;
    std::array<Voice, 32> voices;
};

//==============================================================================
/** Silence (unknown instrument types, plugins that could not be loaded). */
class SilentInstrument : public Instrument
{
public:
    void setChannel (const ChannelModel&) override {}
    void noteOn (int64, int, float, double, juce::uint32) override {}
    void noteOff (int64, int, juce::uint32) override {}
    void choke (int64) override {}
    bool render (float*, float*, int64, int) override { return false; }
    void releaseAll (int64) override {}
    void kill() override {}
    int activeVoices() const override { return 0; }
};

/** Metronome clicks, mixed after the master limiter like the browser version. */
class Metronome
{
public:
    void prepare (double sampleRate) { sr = sampleRate; }
    void click (int64 when, bool accent);
    void render (float* L, float* R, int64 blockStart, int n);
    void kill() { for (auto& v : clicks) v.active = false; }
private:
    struct Click { bool active = false; int64 start = 0; double freq = 1000; dsp::Osc osc; dsp::Timeline g; double t = 0; };
    std::array<Click, 8> clicks;
    double sr = 48000;
};

} // namespace nxw
