/*
    NXW Studio · desktop application entry point

    Command-line modes (used by the plugin scanner and by automated tests):
      --nxw-scan <plugin file> <result.xml>       inspect one plugin (runs in a child process)
      --nxw-render <project.json> <out.wav> [--sample id=path ...] [--plugin file ...]
                                                  render a project without opening a window
*/
#include <juce_gui_extra/juce_gui_extra.h>
#include "app/MainWindow.h"
#include <iostream>

#ifndef NXW_VERSION
 #define NXW_VERSION "0.0.0"
#endif

namespace nxw
{
/** Dark native dialogs (audio settings, file pickers on Linux, plugin fallback editors). */
class StudioLookAndFeel : public juce::LookAndFeel_V4
{
public:
    StudioLookAndFeel()
        : LookAndFeel_V4 (ColourScheme { 0xff1a1f24, 0xff14181c, 0xff22292f, 0xff3b4550, 0xffdbe2e7,
                                         0xff2c343c, 0xff0d1013, 0xff3dd0ae, 0xffdbe2e7 })
    {
        setColour (juce::ResizableWindow::backgroundColourId, juce::Colour (0xff1a1f24));
        setColour (juce::TextButton::buttonColourId, juce::Colour (0xff22292f));
        setColour (juce::ComboBox::backgroundColourId, juce::Colour (0xff0d1013));
    }
};

static void crashHandler (void*)
{
    juce::Logger::writeToLog ("NXW Studio crashed. Stack:\n" + juce::SystemStats::getStackBacktrace());
}

/** Headless render used by tests and CI: proves the engine (and plugin hosting) works. */
static int runRenderCli (const juce::StringArray& args)
{
    const int i = args.indexOf ("--nxw-render");
    if (i < 0 || i + 2 >= args.size()) return 64;
    const juce::File projectFile (args[i + 1]), outFile (args[i + 2]);
    const auto tmp = juce::File::createTempFile ("nxw-render");
    tmp.createDirectory();

    SampleBank bank (tmp.getChildFile ("samples"));
    PluginHost host (tmp);
    Engine engine (bank);
    engine.setFactory ({
        [&] (const ChannelModel& ch, double sr, int bs, juce::String& err) { return host.makeInstrument (ch, sr, bs, &engine, err); },
        [&] (const FxModel& fx, double sr, int bs, juce::String& err) { return host.makeEffect (fx, sr, bs, &engine, err); },
        [] (const juce::String& id) { std::cout << "sample missing: " << id << std::endl; },
        [] (const juce::String& owner, const juce::String& st) { std::cout << "plugin " << owner << ": " << st << std::endl; },
        [] (juce::AudioProcessor*) {} });

    for (int a = 0; a < args.size(); ++a)
    {
        if (args[a] == "--sample" && a + 1 < args.size())
        {
            const auto id = args[a + 1].upToFirstOccurrenceOf ("=", false, false);
            const auto err = bank.putFile (id, juce::File (args[a + 1].fromFirstOccurrenceOf ("=", false, false)));
            if (err.isNotEmpty()) std::cout << "sample " << id << ": " << err << std::endl;
        }
        if (args[a] == "--plugin" && a + 1 < args.size())
        {
            juce::OwnedArray<juce::PluginDescription> found;
            for (auto* f : host.formats().getFormats())
                if (f->fileMightContainThisPluginType (args[a + 1])) f->findAllTypesForFile (found, args[a + 1]);
            for (auto* d : found)
            {
                host.known().addType (*d);
                std::cout << "plugin found: " << d->name << " id=" << d->createIdentifierString() << " instrument=" << (int) d->isInstrument << std::endl;
            }
        }
    }

    const auto project = juce::JSON::parse (projectFile);
    if (! project.isObject()) { std::cout << "could not read project" << std::endl; return 65; }
    const double sr = 44100;
    engine.prepareAll (sr, 512);
    engine.setProject (project);

    auto model = Model::fromJson (project);
    Engine::RenderRequest req;
    req.sampleRate = sr;
    req.patternMode = args.contains ("--pattern");
    req.fromStep = 0;
    req.steps = req.patternMode ? model->patterns[(size_t) model->currentPattern].len : model->songEnd;
    req.tail = true;
    req.stems = args.contains ("--stems");

    juce::AudioBuffer<float> master;
    std::vector<juce::AudioBuffer<float>> stems;
    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    engine.exporting = true;
    engine.setPluginsNonRealtime (true);
    engine.renderOffline (req, master, stems, nullptr);
    const auto ms = juce::Time::getMillisecondCounterHiRes() - t0;

    outFile.deleteFile();
    std::unique_ptr<juce::OutputStream> out (outFile.createOutputStream().release());
    juce::WavAudioFormat wav;
    if (auto w = wav.createWriterFor (out, juce::AudioFormatWriterOptions{}.withSampleRate (sr).withNumChannels (2).withBitsPerSample (32)))
        w->writeFromAudioSampleBuffer (master, 0, master.getNumSamples());

    const float peak = master.getMagnitude (0, master.getNumSamples());
    const float rms = 0.5f * (master.getRMSLevel (0, 0, master.getNumSamples()) + master.getRMSLevel (1, 0, master.getNumSamples()));
    std::cout << "rendered " << master.getNumSamples() / sr << " s in " << ms << " ms; peak " << peak
              << " rms " << juce::Decibels::gainToDecibels (rms) << " dB; nan " << (int) ! std::isfinite (peak) << std::endl;
    for (size_t s = 0; s < stems.size(); ++s)
    {
        const auto pk = stems[s].getMagnitude (0, stems[s].getNumSamples());
        if (pk <= 0) continue;
        std::cout << "stem " << (s + 1) << " peak " << pk << std::endl;
        const auto sf = outFile.getSiblingFile (outFile.getFileNameWithoutExtension() + "-stem" + juce::String ((int) s + 1).paddedLeft ('0', 2) + ".wav");
        sf.deleteFile();
        std::unique_ptr<juce::OutputStream> so (sf.createOutputStream().release());
        if (auto w = wav.createWriterFor (so, juce::AudioFormatWriterOptions{}.withSampleRate (sr).withNumChannels (2).withBitsPerSample (32)))
            w->writeFromAudioSampleBuffer (stems[s], 0, stems[s].getNumSamples());
    }
    tmp.deleteRecursively();
    return std::isfinite (peak) ? 0 : 1;
}

/** Plugin hosting self-test (CI): --nxw-plugin-selftest <instrument.vst3> <effect.vst3>
    Loads an instrument and an effect plugin into a project, checks that notes land on the
    right samples and that a changed plugin setting survives a save and restore. */
static int runPluginSelfTest (const juce::StringArray& args)
{
    const int i = args.indexOf ("--nxw-plugin-selftest");
    if (i < 0 || i + 2 >= args.size()) return 64;
    const auto tmp = juce::File::createTempFile ("nxw-selftest");
    tmp.createDirectory();
    SampleBank bank (tmp.getChildFile ("samples"));
    PluginHost host (tmp);
    Engine engine (bank);
    juce::StringArray statusLog;
    engine.setFactory ({
        [&] (const ChannelModel& ch, double sr, int bs, juce::String& err) { return host.makeInstrument (ch, sr, bs, &engine, err); },
        [&] (const FxModel& fx, double sr, int bs, juce::String& err) { return host.makeEffect (fx, sr, bs, &engine, err); },
        [] (const juce::String&) {},
        [&] (const juce::String& owner, const juce::String& st) { statusLog.add (owner + ": " + st); },
        [] (juce::AudioProcessor*) {} });

    juce::PluginDescription inst, fx;
    for (int k : { 1, 2 })
    {
        juce::OwnedArray<juce::PluginDescription> found;
        for (auto* f : host.formats().getFormats())
            if (f->fileMightContainThisPluginType (args[i + k])) f->findAllTypesForFile (found, args[i + k]);
        if (found.isEmpty()) { std::cout << "FAIL: no plugin in " << args[i + k] << std::endl; return 2; }
        host.known().addType (*found[0]);
        (k == 1 ? inst : fx) = *found[0];
    }

    const double sr = 48000, bpm = 120;
    const int sps = (int) (sr * 60.0 / bpm / 4.0);           // samples per step
    auto project = [&] (const juce::String& fxId)
    {
        const auto ref = [] (const juce::PluginDescription& d)
        {
            return "{\"id\":" + juce::JSON::toString (d.createIdentifierString()) + ",\"name\":" + juce::JSON::toString (d.name)
                 + ",\"vendor\":\"NXW\",\"format\":\"VST3\",\"instrument\":" + (d.isInstrument ? "true" : "false") + "}";
        };
        juce::String mixer;
        for (int m = 0; m <= 10; ++m)
            mixer << (m ? "," : "") << "{\"name\":\"I\",\"vol\":0.7906,\"pan\":0,\"mute\":false,\"solo\":false,\"fx\":["
                  << (m == 1 ? "{\"id\":\"" + fxId + "\",\"type\":\"plugin\",\"on\":true,\"p\":{},\"plugin\":" + ref (fx) + "}" : juce::String())
                  << "]}";
        return juce::JSON::parse ("{\"v\":1,\"name\":\"t\",\"bpm\":120,\"swing\":0,\"master\":0.8,"
            "\"channels\":[{\"id\":\"c1\",\"name\":\"P\",\"type\":\"plugin\",\"vol\":0.78,\"pan\":0,\"mute\":false,\"mixer\":1,\"root\":60,\"params\":{},\"plugin\":" + ref (inst) + "}],"
            "\"patterns\":[{\"id\":\"p1\",\"name\":\"P\",\"color\":\"#fff\",\"len\":16,\"notes\":{\"c1\":["
            "{\"t\":0,\"len\":2,\"key\":69,\"vel\":1,\"chance\":1},{\"t\":4,\"len\":2,\"key\":69,\"vel\":1,\"chance\":1},{\"t\":8.5,\"len\":2,\"key\":69,\"vel\":1,\"chance\":1}]}}],"
            "\"playlist\":{\"tracks\":16,\"names\":[],\"mute\":[],\"clips\":[{\"id\":\"k\",\"pat\":\"p1\",\"track\":0,\"start\":0,\"len\":16}],\"loop\":null},"
            "\"mixer\":[" + mixer + "],\"ui\":{\"pat\":\"p1\",\"mode\":\"song\",\"metro\":false,\"ch\":\"c1\"}}");
    };
    // Renders the pattern; `out` is insert 1 (the plugin channel, before the master limiter).
    auto render = [&] (juce::AudioBuffer<float>& out)
    {
        Engine::RenderRequest req;
        req.sampleRate = sr; req.steps = 16; req.tail = false; req.stems = true;
        std::vector<juce::AudioBuffer<float>> stems;
        juce::AudioBuffer<float> master;
        engine.exporting = true;
        engine.setPluginsNonRealtime (true);
        const bool ok = engine.renderOffline (req, master, stems, nullptr);
        if (ok && ! stems.empty()) out.makeCopyOf (stems[0]);
        return ok && ! stems.empty();
    };
    auto onsetAfter = [] (const juce::AudioBuffer<float>& b, int from)
    {
        for (int s = from; s < b.getNumSamples(); ++s) if (std::abs (b.getSample (0, s)) > 1.0e-4f) return s;
        return -1;
    };
    int failures = 0;
    auto check = [&] (bool ok, const juce::String& what) { std::cout << (ok ? "ok   " : "FAIL ") << what << std::endl; if (! ok) ++failures; };

    engine.prepareAll (sr, 256);
    engine.setProject (project ("fx1"));
    check (engine.findPlugin ("c1") != nullptr, "instrument plugin loaded (" + inst.name + ")");
    check (engine.findPlugin ("fx1") != nullptr, "effect plugin loaded (" + fx.name + ")");
    for (auto& s : statusLog) std::cout << "     status " << s << std::endl;

    juce::AudioBuffer<float> a;
    check (render (a), "render finished");
    const float rmsA = a.getRMSLevel (0, 0, a.getNumSamples());
    check (rmsA > 0.001f, "plugin instrument makes sound (rms " + juce::String (rmsA, 4) + ")");
    const int o1 = onsetAfter (a, 0), o2 = onsetAfter (a, 3 * sps), o3 = onsetAfter (a, 7 * sps);
    std::cout << "     onsets " << o1 << " " << o2 << " " << o3 << " (expected 0, " << 4 * sps << ", " << (int) (8.5 * sps) << ")" << std::endl;
    check (o1 >= 0 && o1 < 8, "first note starts on time");
    check (std::abs (o2 - 4 * sps) < 8, "note on step 5 starts on its sample");
    check (std::abs (o3 - (int) (8.5 * sps)) < 8, "off-grid note starts on its sample");

    // Change the effect's parameter (as its editor would), play, then save its state and
    // restore it into a new instance.
    if (auto* p = engine.findPlugin ("fx1"))
        if (auto* param = p->getParameters()[0]) param->setValueNotifyingHost (0.25f);    // gain 0..2 -> 0.5
    juce::AudioBuffer<float> changed;
    render (changed);
    const auto changedDb = juce::Decibels::gainToDecibels (changed.getRMSLevel (0, 0, changed.getNumSamples()) / juce::jmax (1.0e-9f, rmsA));
    check (std::abs (changedDb + 6.02f) < 0.5f, "effect parameter change is heard (" + juce::String (changedDb, 2) + " dB)");
    const auto state = engine.currentPluginState ("fx1");
    check (state.isNotEmpty(), "plugin state saved (" + juce::String (state.length()) + " chars)");
    engine.stashPluginState ("fx2", state);
    engine.setProject (project ("fx2"));
    float restored = -1;
    if (auto* p = engine.findPlugin ("fx2"))
        if (auto* param = p->getParameters()[0]) restored = param->getValue();
    check (std::abs (restored - 0.25f) < 0.001f, "plugin state restored into a new instance (" + juce::String (restored, 3) + ")");
    juce::AudioBuffer<float> b;
    render (b);
    const float rmsB = b.getRMSLevel (0, 0, b.getNumSamples());
    const auto ratioDb = juce::Decibels::gainToDecibels (rmsB / juce::jmax (1.0e-9f, rmsA));
    check (std::abs (ratioDb + 6.02f) < 0.5f, "restored effect setting changes the sound (" + juce::String (ratioDb, 2) + " dB, expected -6.02)");

    engine.setProject (juce::JSON::parse ("{\"v\":1,\"channels\":[],\"patterns\":[],\"mixer\":[]}"));
    tmp.deleteRecursively();
    std::cout << (failures ? "PLUGIN SELF-TEST FAILED" : "PLUGIN SELF-TEST PASSED") << std::endl;
    return failures ? 1 : 0;
}

//==============================================================================
class NXWApplication : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override    { return "NXW Studio"; }
    const juce::String getApplicationVersion() override { return NXW_VERSION; }
    bool moreThanOneInstanceAllowed() override          { return true; }

    void initialise (const juce::String&) override
    {
        const auto args = getCommandLineParameterArray();
        const int scan = args.indexOf ("--nxw-scan");
        if (scan >= 0 && scan + 2 < args.size())
        {
            setApplicationReturnValue (PluginHost::runScanChild (args[scan + 1], juce::File (args[scan + 2])));
            quit();
            return;
        }
        if (args.contains ("--nxw-render"))
        {
            setApplicationReturnValue (runRenderCli (args));
            quit();
            return;
        }
        if (args.contains ("--nxw-plugin-selftest"))
        {
            setApplicationReturnValue (runPluginSelfTest (args));
            quit();
            return;
        }

        logger = std::make_unique<juce::FileLogger> (paths::logs().getChildFile ("nxw.log"),
                                                     "NXW Studio " NXW_VERSION " on " + juce::SystemStats::getOperatingSystemName(),
                                                     1024 * 1024);
        juce::Logger::setCurrentLogger (logger.get());
        juce::SystemStats::setApplicationCrashHandler (crashHandler);
        juce::LookAndFeel::setDefaultLookAndFeel (&lookAndFeel);

        services = std::make_unique<Services>();
        const auto err = services->openAudio();
        window = std::make_unique<MainWindow> (*services);
        if (err.isNotEmpty())
            juce::Logger::writeToLog ("No audio output yet: " + err);
    }

    void shutdown() override
    {
        window.reset();
        services.reset();
        juce::LookAndFeel::setDefaultLookAndFeel (nullptr);
        juce::Logger::setCurrentLogger (nullptr);
        logger.reset();
    }

    void systemRequestedQuit() override { quit(); }
    void anotherInstanceStarted (const juce::String&) override {}

private:
    StudioLookAndFeel lookAndFeel;
    std::unique_ptr<juce::FileLogger> logger;
    std::unique_ptr<Services> services;
    std::unique_ptr<MainWindow> window;
};
} // namespace nxw

START_JUCE_APPLICATION (nxw::NXWApplication)
