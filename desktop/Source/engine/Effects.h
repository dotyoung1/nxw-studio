/*
    NXW Studio · mixer effects

    Native ports of the eight built-in insert effects, plus the interface that
    plugin effects implement.
*/
#pragma once

#include <juce_dsp/juce_dsp.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include "Dsp.h"
#include "Model.h"

namespace nxw
{
using int64 = juce::int64;

class Effect
{
public:
    virtual ~Effect() = default;
    virtual void prepare (double sampleRate, int maxBlock) = 0;
    virtual void reset() {}
    /** Called under the engine lock (or before the effect is swapped in). */
    virtual void setParams (const FxModel& fx) = 0;
    virtual void process (float* L, float* R, int n, int64 blockStart) = 0;
    /** Sequencer step at absolute sample `when` (Pump uses this). */
    virtual void onStep (int, int64, double) {}
    /** Transport stopped. */
    virtual void halt (int64) {}
    /** Tempo changed: samples per sixteenth step. */
    virtual void setStepLength (double) {}
    virtual double reductionDb() const { return 0; }
    virtual int latency() const { return 0; }
    virtual juce::AudioPluginInstance* getPlugin() { return nullptr; }
    virtual bool consumeStateChanged() { return false; }
    /** Offline rendering on/off (plugins). */
    virtual void setNonRealtime (bool) {}

    juce::String id, type, pluginUid;
};

std::unique_ptr<Effect> makeBuiltinEffect (const juce::String& type);

} // namespace nxw
