/*
    NXW Studio · bridge between the interface (in the web view) and the native side.

    The interface calls a single native function, nxw(method, ...args), and listens
    for "nxw" events. Everything the desktop adds (audio engine, plugins, files,
    export, updates) goes through here.
*/
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "Services.h"
#include <map>
#include <set>

namespace nxw
{
class Bridge : private juce::Timer
{
public:
    using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

    Bridge (Services&, juce::Component& windowContent);
    ~Bridge() override;

    /** The browser options with the native function, events and resources wired in. */
    juce::WebBrowserComponent::Options browserOptions();
    void attach (juce::WebBrowserComponent* b) { browser = b; }

    /** Writes the autosave file now (used at shutdown). */
    void autosaveNow();

    std::optional<juce::WebBrowserComponent::Resource> resource (const juce::String& url);

private:
    void handle (const juce::Array<juce::var>& args, Completion done);
    void emit (const juce::var& payload);
    void timerCallback() override;
    void sendTick();

    // helpers
    void chooseFile (bool save, const juce::String& title, const juce::File& start, const juce::String& patterns,
                     std::function<void (juce::File)> then);
    void exportAudio (const juce::var& opts, Completion done);
    void checkForUpdate (bool userAsked, Completion done);
    void openAudioSettings();
    juce::var withPluginStates (const juce::var& project);

    Services& sv;
    juce::Component& content;
    juce::WebBrowserComponent* browser = nullptr;
    std::unique_ptr<juce::FileChooser> chooser;

    juce::var lastProject;
    bool autosaveDirty = false;
    juce::uint32 lastChange = 0;
    int tickCount = 0;
    bool wantScope = true;
    std::set<juce::String> requested;

    struct Render { int channels = 2; double sr = 44100; std::vector<juce::MemoryBlock> data; juce::StringArray names; };
    std::map<juce::String, Render> renders;
    std::shared_ptr<std::atomic<bool>> cancelFlag;
    juce::ThreadPool decodePool { 2 };

    JUCE_DECLARE_WEAK_REFERENCEABLE (Bridge)
};
} // namespace nxw
