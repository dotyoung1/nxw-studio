/*
    NXW Studio · sample bank

    Decoded audio for sampler channels, keyed by the same ids the interface's sound
    library uses. Sounds are cached on disk the first time the interface hands them
    over, so later launches load them straight from the cache.
*/
#pragma once

#include <juce_audio_formats/juce_audio_formats.h>
#include <map>
#include <memory>
#include <mutex>
#include <atomic>

namespace nxw
{
struct SampleData
{
    juce::AudioBuffer<float> buffer;
    juce::AudioBuffer<float> reversed;   // filled on demand (message thread)
    double sampleRate = 48000;
    juce::String name;
    std::atomic<bool> hasReversed { false };
};

class SampleBank
{
public:
    explicit SampleBank (juce::File cacheFolder);

    /** Returns the decoded sample, loading it from the disk cache if needed (message thread). */
    std::shared_ptr<SampleData> get (const juce::String& id);

    /** Decodes bytes handed over by the interface, stores them in the cache. Returns an error or empty. */
    juce::String put (const juce::String& id, const juce::MemoryBlock& bytes, const juce::String& fileName);

    /** Loads a file from disk directly (sample folders, drag and drop from the desktop). */
    juce::String putFile (const juce::String& id, const juce::File& file);

    bool isKnown (const juce::String& id);
    void ensureReversed (SampleData& s);
    void forget (const juce::String& id);

    juce::AudioFormatManager& formats() { return formatManager; }

private:
    std::shared_ptr<SampleData> decode (std::unique_ptr<juce::InputStream> in, const juce::String& name);
    juce::File cacheFileFor (const juce::String& id) const;

    juce::File cache;
    juce::AudioFormatManager formatManager;
    std::map<juce::String, std::shared_ptr<SampleData>> loaded;
    std::mutex mutex;
};

} // namespace nxw
