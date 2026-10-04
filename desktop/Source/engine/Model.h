/*
    NXW Studio · project model

    The interface owns the project (it is the same JSON the browser version saves).
    Whenever it changes, the interface sends the JSON here and it is parsed into this
    immutable snapshot, which the audio engine swaps in between audio blocks.
*/
#pragma once

#include <juce_core/juce_core.h>
#include "Dsp.h"
#include <memory>
#include <vector>

namespace nxw
{
/** Standard base64 (RFC 4648), as the interface's btoa/atob use. (MemoryBlock's own
    base64 methods use a JUCE-specific format.) */
inline juce::String toBase64 (const void* data, size_t size) { return juce::Base64::toBase64 (data, size); }
inline juce::String toBase64 (const juce::MemoryBlock& mb)   { return toBase64 (mb.getData(), mb.getSize()); }
inline bool fromBase64 (const juce::String& text, juce::MemoryBlock& out)
{
    juce::MemoryOutputStream os (out, false);
    return juce::Base64::convertFromBase64 (os, text);
}

constexpr int kNumInserts = 10;            // mixer inserts 1..10, index 0 is the master
constexpr int kStepsPerBar = 16;

inline juce::uint64 hashId (const juce::String& s) noexcept
{
    juce::uint64 h = 1469598103934665603ull;
    for (auto p = s.getCharPointer(); ! p.isEmpty(); ++p)
    {
        h ^= (juce::uint64) (juce::uint32) *p;
        h *= 1099511628211ull;
    }
    return h == 0 ? 1 : h;
}

enum class ChType { Drum, Synth, Sampler, Plugin, Unknown };
enum class DrumKind { Kick, K808, Snare, Clap, Hat, OHat, Rim, Tom, Bell, Shaker, Crash };

struct DrumParams
{
    DrumKind kind = DrumKind::Kick;
    double tune = 0, decay = 1, tone = 0.5, level = 1;
};

struct SynthParams
{
    dsp::Osc::Wave w1 = dsp::Osc::Saw, w2 = dsp::Osc::Square;
    double semi2 = 0, det = 7, mix = 0.5, sub = 0;
    int uni = 1;
    double spread = 18, cut = 3000, res = 1, env = 0.3, fatt = 0.005, fdec = 0.4;
    double att = 0.004, dec = 0.3, sus = 0.7, rel = 0.25, gain = 0.6;
};

struct SamplerParams
{
    double pitch = 0, start = 0, att = 0.002, rel = 0.12, gain = 0.8;
    bool rev = false, oneshot = true;
};

/** A reference to a plugin, as stored in the project. */
struct PluginRef
{
    juce::String uid;          // PluginDescription::createIdentifierString()
    juce::String name, vendor, format;
    juce::String state;        // base64 of getStateInformation()
    bool isInstrument = false;
    bool valid() const { return uid.isNotEmpty(); }
};

struct ChannelModel
{
    juce::String id, name;
    juce::uint64 hash = 0;
    ChType type = ChType::Unknown;
    double vol = 0.78, pan = 0;
    bool mute = false;
    int mixer = 0, root = 60;
    bool cut = false;
    int cutGroup = 0;
    DrumParams drum;
    SynthParams synth;
    SamplerParams sampler;
    juce::String sampleId;
    PluginRef plugin;

    /** Two channels with the same signature can share an instrument object. */
    juce::String signature() const
    {
        switch (type)
        {
            case ChType::Drum:    return "drum";
            case ChType::Synth:   return "synth";
            case ChType::Sampler: return "sampler";
            case ChType::Plugin:  return "plugin:" + plugin.uid;
            case ChType::Unknown: break;
        }
        return "none";
    }
};

struct Note
{
    double t = 0, len = 1;
    int key = 60;
    float vel = 0.78f, chance = 1.0f;
    int rep = 1;
};

struct PatternModel
{
    juce::String id;
    int len = 16;
    std::vector<std::vector<Note>> notes;   // indexed like Model::channels, sorted by t
};

struct ClipModel
{
    int pattern = -1, track = 0, start = 0, len = 16;
};

struct FxModel
{
    juce::String id, type;
    bool on = true;
    juce::NamedValueSet params;
    PluginRef plugin;

    double p (const juce::Identifier& k, double def) const
    {
        if (auto* v = params.getVarPointer (k)) return (double) *v;
        return def;
    }
};

struct InsertModel
{
    double vol = 0.7906, pan = 0;
    bool mute = false, solo = false;
    std::vector<FxModel> fx;
};

struct Model
{
    double bpm = 128, swing = 0, master = 0.8;
    std::vector<ChannelModel> channels;
    std::vector<PatternModel> patterns;
    std::vector<ClipModel> clips;
    std::vector<bool> trackMute;
    bool hasLoop = false;
    int loopA = 0, loopB = 0, songEnd = 64;
    std::vector<InsertModel> mixer;     // kNumInserts + 1

    // interface state the engine needs
    int currentPattern = 0;
    bool patternMode = false, metronome = false;
    juce::uint64 selectedChannel = 0;

    int channelIndex (juce::uint64 h) const
    {
        for (size_t i = 0; i < channels.size(); ++i)
            if (channels[i].hash == h) return (int) i;
        return -1;
    }

    double samplesPerStep (double sampleRate) const { return sampleRate * 60.0 / juce::jmax (1.0, bpm) / 4.0; }

    static std::shared_ptr<const Model> fromJson (const juce::var& project);
    static ChannelModel channelFromJson (const juce::var& ch);
    static PluginRef pluginFromJson (const juce::var& v);
};

} // namespace nxw
