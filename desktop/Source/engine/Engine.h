/*
    NXW Studio · audio engine

    Runs the sequencer, instruments, mixer and effects. The interface sends the
    project (as JSON) whenever it changes; the engine reconciles that with the
    instruments and effects it already has, so playing notes, reverb tails and
    plugins survive every edit.

    Threading:
      - message thread: setProject(), transport/notes commands, plugin creation;
      - audio thread: processBlock() under `lock`; the message thread only holds
        the lock for short pointer swaps;
      - export thread: renderOffline(), also under `lock`, while the live output
        is muted.
*/
#pragma once

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include "Model.h"
#include "Instruments.h"
#include "Effects.h"
#include "SampleBank.h"
#include <map>
#include <atomic>

namespace nxw
{
class PluginInstrument;
class PluginEffect;

class Engine : public juce::AudioIODeviceCallback,
               public juce::AudioPlayHead,
               public juce::MidiInputCallback
{
public:
    struct Factory
    {
        /** Creates a plugin instrument for a channel; return nullptr (with an error) if it cannot be loaded. */
        std::function<std::unique_ptr<Instrument> (const ChannelModel&, double sr, int block, juce::String& error)> pluginInstrument;
        std::function<std::unique_ptr<Effect> (const FxModel&, double sr, int block, juce::String& error)> pluginEffect;
        /** The engine needs a library sound it has not seen yet. */
        std::function<void (const juce::String& sampleId)> sampleNeeded;
        /** A plugin could not be loaded / was loaded (owner id, message). */
        std::function<void (const juce::String& owner, const juce::String& status)> pluginStatus;
        /** A plugin object is about to be destroyed (close its editor first). */
        std::function<void (juce::AudioProcessor*)> pluginDestroyed;
    };

    struct StepMark { double time = 0; int step = 0; double sps = 1; bool pat = false; };

    struct Status
    {
        bool playing = false, patMode = false;
        double position = 0;          // in steps, at what you hear now
        double sampleRate = 48000;
        float meters[kNumInserts + 1][2] {};
        float reduction[kNumInserts + 1] {};
        int voices = 0;
        double cpu = 0;
        juce::Array<juce::var> hits;  // channel ids that just played
    };

    explicit Engine (SampleBank&);
    ~Engine() override;

    void setFactory (Factory f) { factory = std::move (f); }

    //=== message thread ======================================================
    void setProject (const juce::var& project);
    void play (bool patternMode, double songPosition);
    void stop();
    void setSongPosition (double steps);
    void setPatternMode (bool patternMode, double songPosition);
    void liveNoteOn (juce::uint64 channelHash, int key, float velocity);
    void liveNoteOff (juce::uint64 channelHash, int key);
    void allLiveNotesOff();
    void preview (const juce::var& channelJson, int key, double seconds);
    void stopPreview();
    void sampleArrived (const juce::String& sampleId);
    Status readStatus();
    void scopeSnapshot (float* dest, int num);

    /** (Re)prepares every instrument and effect. Message thread, device stopped or under lock. */
    void prepareAll (double sampleRate, int maxBlock);

    /** Finds a plugin by owner: channel id, or effect id. */
    juce::AudioPluginInstance* findPlugin (const juce::String& ownerId);
    /** Every plugin currently loaded, with its owner id. */
    std::vector<std::pair<juce::String, juce::AudioPluginInstance*>> allPlugins();
    /** Plugin states to restore when the owners are created (project load, undo, duplicate). */
    void stashPluginState (const juce::String& ownerId, const juce::String& base64State);
    juce::String currentPluginState (const juce::String& ownerId);
    /** True if any plugin's settings changed since the last call (message thread). */
    bool pluginStateChanged();
    /** Offline rendering mode for every plugin. */
    void setPluginsNonRealtime (bool);

    //=== export ==============================================================
    struct RenderRequest
    {
        bool patternMode = false;
        int fromStep = 0, steps = 64;
        double sampleRate = 44100;
        bool tail = true, stems = false;
    };
    /** Renders offline into `master` (and `stems`, one per mixer insert 1..10). Returns false if cancelled. */
    bool renderOffline (const RenderRequest&, juce::AudioBuffer<float>& master,
                        std::vector<juce::AudioBuffer<float>>& stems,
                        const std::function<bool (double)>& progress);
    std::atomic<bool> exporting { false };

    //=== audio device ========================================================
    void audioDeviceIOCallbackWithContext (const float* const* inputs, int numIn, float* const* outputs, int numOut,
                                           int numSamples, const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart (juce::AudioIODevice*) override;
    void audioDeviceStopped() override;
    void handleIncomingMidiMessage (juce::MidiInput*, const juce::MidiMessage&) override;

    //=== AudioPlayHead (for plugins) ==========================================
    juce::Optional<PositionInfo> getPosition() const override;

    double getSampleRate() const { return sampleRate; }
    int getBlockSize() const { return maxBlock; }
    void setCpuSource (std::function<double()> f) { cpuSource = std::move (f); }

private:
    struct ChannelState
    {
        juce::String id, signature;
        juce::uint64 hash = 0;
        std::unique_ptr<Instrument> inst;
        std::shared_ptr<SampleData> sample;
        dsp::Smoother gain, pan;
        int route = 0;
        bool cut = false;
        int cutGroup = 0;
        std::atomic<juce::int64> lastHit { -1 };
        juce::String status;
    };
    struct InsertState
    {
        std::vector<std::unique_ptr<Effect>> fx;
        std::vector<bool> on;
        dsp::Smoother vol, pan, mute;
        std::atomic<float> peakL { 0 }, peakR { 0 };
    };
    struct Event
    {
        juce::int64 time;
        juce::uint64 ch;
        float vel;
        double dur;
        int key;
        juce::uint32 tag;
        bool operator> (const Event& o) const { return time > o.time; }
    };
    enum class Cmd : juce::uint8 { Play, Stop, SetPos, SetMode, NoteOn, NoteOff, AllOff, PreviewOn };
    struct Command { Cmd type; juce::uint64 ch; int key; float vel; double value; bool flag; };

    // audio thread
    void processBlock (float* L, float* R, int n, float* const* stems);
    void drainCommands();
    void scheduleSteps (juce::int64 blockEnd);
    void scheduleStep (int step, double when, double sps);
    void schedulePattern (const PatternModel& pat, int localStep, double when, double sps);
    int advanceStep (int s) const;
    void dispatchEvents (juce::int64 blockEnd);
    void pushEvent (const Event& e);
    void noteOnNow (ChannelState* cs, juce::int64 when, int key, float vel, double dur, juce::uint32 tag);
    ChannelState* channelByHash (juce::uint64 h) const;
    void stopTransportNow();
    void resetDsp();
    void startTransport (bool pat, double pos);

    void post (const Command& c);
    std::unique_ptr<Instrument> makeInstrument (const ChannelModel& ch, juce::String& status);
    std::unique_ptr<Effect> makeEffect (const FxModel& fx, juce::String& status);
    void applyChannel (ChannelState& cs, const ChannelModel& ch);
    void destroyLater (std::unique_ptr<ChannelState> cs);
    void destroyLater (std::unique_ptr<Effect> e);
    void flushGraveyard();

    SampleBank& bank;
    Factory factory;
    std::function<double()> cpuSource;

    juce::CriticalSection lock;
    std::shared_ptr<const Model> model;
    std::map<juce::uint64, std::unique_ptr<ChannelState>> pool;       // message thread owns
    std::vector<ChannelState*> order;                                  // audio thread reads under lock
    std::unique_ptr<ChannelState> previewCh;
    juce::String previewJson;                                         // message thread only
    std::array<InsertState, kNumInserts + 1> inserts;
    std::vector<std::unique_ptr<ChannelState>> deadChannels;
    std::vector<std::unique_ptr<Effect>> deadEffects;
    std::map<juce::String, juce::String> stash;                       // plugin states waiting for owners
    juce::var lastProject;

    double sampleRate = 48000;
    int maxBlock = 512;
    juce::AudioBuffer<float> chBuf, busBuf, masterBuf;
    dsp::Compressor limiter;
    dsp::Smoother masterGain;
    Metronome metronome;

    // transport (audio thread)
    juce::int64 clock = 0;
    bool playing = false, patMode = false, noWrap = false;
    int nextStep = 0;
    double nextStepTime = 0;
    juce::int64 stepsLeft = -1;
    std::vector<Event> pending;
    juce::uint32 nextTag = 1;
    StepMark marks[8];
    int markHead = 0;
    double songPos = 0;

    // commands
    juce::SpinLock cmdLock;
    std::vector<Command> cmdIn, cmdWork;

    // status (audio -> message)
    juce::SpinLock statusLock;
    struct Shared { bool playing = false, patMode = false; juce::int64 clock = 0; StepMark marks[8]; int markHead = 0; int voices = 0; double bpm = 128; } shared;
    std::vector<float> scope;
    std::atomic<int> scopeWrite { 0 };
    std::atomic<juce::uint64> selectedChannel { 0 };
    std::atomic<int> outputLatency { 0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Engine)
};

} // namespace nxw
