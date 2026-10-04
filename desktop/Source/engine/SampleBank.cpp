#include "SampleBank.h"

namespace nxw
{
static juce::String safeId (const juce::String& id)
{
    return id.retainCharacters ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_").substring (0, 64);
}

SampleBank::SampleBank (juce::File cacheFolder) : cache (std::move (cacheFolder))
{
    formatManager.registerBasicFormats();
    cache.createDirectory();
}

juce::File SampleBank::cacheFileFor (const juce::String& id) const
{
    const auto base = safeId (id);
    if (base.isEmpty()) return {};
    for (auto& f : cache.findChildFiles (juce::File::findFiles, false, base + ".*"))
        return f;
    return {};
}

bool SampleBank::isKnown (const juce::String& id)
{
    {
        std::lock_guard<std::mutex> lk (mutex);
        if (loaded.count (id)) return true;
    }
    return cacheFileFor (id).existsAsFile();
}

std::shared_ptr<SampleData> SampleBank::decode (std::unique_ptr<juce::InputStream> in, const juce::String& name)
{
    if (in == nullptr) return nullptr;
    std::unique_ptr<juce::AudioFormatReader> reader (formatManager.createReaderFor (std::move (in)));
    if (reader == nullptr || reader->lengthInSamples <= 0) return nullptr;

    const auto maxLen = (juce::int64) (reader->sampleRate * 60.0 * 10.0);   // ten minutes is plenty for a sampler
    const auto len = (int) juce::jmin (reader->lengthInSamples, maxLen);
    auto s = std::make_shared<SampleData>();
    s->sampleRate = reader->sampleRate > 0 ? reader->sampleRate : 44100.0;
    const int chans = juce::jlimit (1, 2, (int) reader->numChannels);
    s->buffer.setSize (chans, len);
    reader->read (&s->buffer, 0, len, 0, true, chans > 1);
    s->name = name;
    return s;
}

std::shared_ptr<SampleData> SampleBank::get (const juce::String& id)
{
    {
        std::lock_guard<std::mutex> lk (mutex);
        auto it = loaded.find (id);
        if (it != loaded.end()) return it->second;
    }
    auto f = cacheFileFor (id);
    if (! f.existsAsFile()) return nullptr;
    auto s = decode (f.createInputStream(), f.getFileNameWithoutExtension());
    if (s == nullptr) return nullptr;
    std::lock_guard<std::mutex> lk (mutex);
    loaded[id] = s;
    return s;
}

juce::String SampleBank::put (const juce::String& id, const juce::MemoryBlock& bytes, const juce::String& fileName)
{
    if (safeId (id).isEmpty()) return "Missing sound id";
    auto s = decode (std::make_unique<juce::MemoryInputStream> (bytes, false), fileName);
    if (s == nullptr) return "This audio format could not be decoded";

    auto ext = juce::File::createFileWithoutCheckingPath ("/" + fileName).getFileExtension();
    if (ext.isEmpty()) ext = ".wav";
    for (auto& old : cache.findChildFiles (juce::File::findFiles, false, safeId (id) + ".*"))
        old.deleteFile();
    cache.getChildFile (safeId (id) + ext).replaceWithData (bytes.getData(), bytes.getSize());

    std::lock_guard<std::mutex> lk (mutex);
    loaded[id] = s;
    return {};
}

juce::String SampleBank::putFile (const juce::String& id, const juce::File& file)
{
    auto s = decode (file.createInputStream(), file.getFileNameWithoutExtension());
    if (s == nullptr) return "This audio format could not be decoded";
    std::lock_guard<std::mutex> lk (mutex);
    loaded[id] = s;
    return {};
}

void SampleBank::ensureReversed (SampleData& s)
{
    if (s.hasReversed) return;
    s.reversed.makeCopyOf (s.buffer);
    s.reversed.reverse (0, s.reversed.getNumSamples());
    s.hasReversed = true;
}

void SampleBank::forget (const juce::String& id)
{
    for (auto& old : cache.findChildFiles (juce::File::findFiles, false, safeId (id) + ".*"))
        old.deleteFile();
    std::lock_guard<std::mutex> lk (mutex);
    loaded.erase (id);
}

} // namespace nxw
