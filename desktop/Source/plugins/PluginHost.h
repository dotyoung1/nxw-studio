/*
    NXW Studio · VST3 plugin hosting

    - Scanning runs each plugin file in a separate copy of the program
      ("NXW Studio --nxw-scan <file> <result.xml>"), so a plugin that crashes while
      being inspected is skipped instead of taking the studio down.
    - Instrument plugins become channels (they receive the step and piano-roll notes
      as MIDI, timed to the sample); effect plugins go in mixer insert slots.
    - Each plugin opens in its own window, owned by the main window.
*/
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <map>
#include "../engine/Instruments.h"
#include "../engine/Effects.h"
#include <atomic>
#include <functional>

namespace nxw
{
//==============================================================================
class PluginInstrument : public Instrument, private juce::AudioProcessorListener
{
public:
    PluginInstrument (std::unique_ptr<juce::AudioPluginInstance>, juce::AudioPlayHead*);
    ~PluginInstrument() override;

    void prepare (double sampleRate, int maxBlock) override;
    void setChannel (const ChannelModel&) override {}
    void noteOn (int64 when, int key, float vel, double durSamples, juce::uint32 tag) override;
    void noteOff (int64 when, int key, juce::uint32 tag) override;
    void choke (int64 when) override;
    bool render (float* L, float* R, int64 blockStart, int n) override;
    void releaseAll (int64 when) override;
    void kill() override;
    int activeVoices() const override { return voices; }
    int latency() const override { return plugin->getLatencySamples(); }
    juce::AudioPluginInstance* getPlugin() override { return plugin.get(); }
    bool consumeStateChanged() override { return changed.exchange (false); }

private:
    struct Ev { int64 time; int key; float vel; bool on; };
    void push (const Ev& e);
    void audioProcessorParameterChanged (juce::AudioProcessor*, int, float) override { changed = true; }
    void audioProcessorChanged (juce::AudioProcessor*, const ChangeDetails& d) override
    {
        if (d.parameterInfoChanged || d.programChanged || d.nonParameterStateChanged) changed = true;
    }

    std::unique_ptr<juce::AudioPluginInstance> plugin;
    juce::AudioBuffer<float> buffer;
    juce::MidiBuffer midi;
    std::vector<Ev> queue;
    std::array<int, 128> held {};
    int voices = 0;
    bool killPending = false;
    std::atomic<bool> changed { false };
};

//==============================================================================
class PluginEffect : public Effect, private juce::AudioProcessorListener
{
public:
    PluginEffect (std::unique_ptr<juce::AudioPluginInstance>, juce::AudioPlayHead*);
    ~PluginEffect() override;

    void prepare (double sampleRate, int maxBlock) override;
    void reset() override { plugin->reset(); }
    void setParams (const FxModel&) override {}
    void process (float* L, float* R, int n, int64) override;
    int latency() const override { return plugin->getLatencySamples(); }
    juce::AudioPluginInstance* getPlugin() override { return plugin.get(); }
    bool consumeStateChanged() override { return changed.exchange (false); }
    void setNonRealtime (bool b) override { plugin->setNonRealtime (b); }

private:
    void audioProcessorParameterChanged (juce::AudioProcessor*, int, float) override { changed = true; }
    void audioProcessorChanged (juce::AudioProcessor*, const ChangeDetails& d) override
    {
        if (d.parameterInfoChanged || d.programChanged || d.nonParameterStateChanged) changed = true;
    }

    std::unique_ptr<juce::AudioPluginInstance> plugin;
    juce::AudioBuffer<float> buffer;
    juce::MidiBuffer midi;
    std::atomic<bool> changed { false };
};

//==============================================================================
class PluginHost
{
public:
    explicit PluginHost (juce::File dataFolder);
    ~PluginHost();

    juce::AudioPluginFormatManager& formats() { return formatManager; }
    juce::KnownPluginList& known() { return knownList; }

    std::unique_ptr<juce::AudioPluginInstance> instantiate (const PluginRef&, double sr, int block, juce::String& error);
    std::unique_ptr<Instrument> makeInstrument (const ChannelModel&, double sr, int block, juce::AudioPlayHead*, juce::String& error);
    std::unique_ptr<Effect> makeEffect (const FxModel&, double sr, int block, juce::AudioPlayHead*, juce::String& error);

    /** The scanned plugins as JSON for the interface. */
    juce::var listJson() const;

    struct ScanProgress { bool running = false; int done = 0, total = 0; juce::String current; juce::StringArray failed; int found = 0; };
    void startScan (bool fullRescan, std::function<void (const ScanProgress&)> onProgress);
    void cancelScan();
    bool isScanning() const;
    /** True once a scan has finished on this computer (the plugin list has been saved). */
    bool hasScannedBefore() const { return listFile.existsAsFile(); }

    juce::StringArray getExtraFolders() const { return extraFolders; }
    void setExtraFolders (const juce::StringArray& f);

    /** Plugin windows: separate, movable windows that stay above the studio window.
        With `toggle`, a visible window is hidden instead. Returns true if the window is now showing. */
    bool showEditor (const juce::String& ownerId, juce::AudioProcessor&, const juce::String& title,
                     juce::Component* owner, bool toggle = false);
    void hideEditorFor (const juce::String& ownerId);
    void closeEditorFor (juce::AudioProcessor*);
    void closeAllEditors();
    bool hasEditorFor (const juce::String& ownerId) const;

    /** Keys pressed in a plugin window that belong to the studio (Space, the typing keyboard):
        action is "toggle", "down" or "up"; code is a web key code such as "KeyZ". */
    std::function<void (const juce::String& action, const juce::String& code)> onKey;

    /** Entry point of the scanning child process. Returns the process exit code. */
    static int runScanChild (const juce::String& pluginFile, const juce::File& resultFile);

private:
    class ScanThread;
    class PluginWindow;
    void saveList();

    juce::File folder, listFile;
    juce::AudioPluginFormatManager formatManager;
    juce::KnownPluginList knownList;
    juce::StringArray extraFolders;
    std::unique_ptr<ScanThread> scanner;
    juce::OwnedArray<PluginWindow> windows;
    std::map<juce::String, juce::Point<int>> windowPositions;     // where each plugin's window was last
};

/** Makes a top-level window stay above (and minimise with) the studio window; no-op where unsupported. */
void setOwnerWindow (juce::Component& window, juce::Component* owner);

} // namespace nxw
