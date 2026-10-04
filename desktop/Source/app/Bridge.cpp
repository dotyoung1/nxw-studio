#include "Bridge.h"
#include "BinaryData.h"

#ifndef NXW_VERSION
 #define NXW_VERSION "0.0.0"
#endif
#ifndef NXW_GITHUB_REPO
 #define NXW_GITHUB_REPO ""
#endif

namespace nxw
{
namespace
{
    juce::String mimeFor (const juce::String& path)
    {
        const auto ext = path.fromLastOccurrenceOf (".", false, false).toLowerCase();
        if (ext == "html") return "text/html; charset=utf-8";
        if (ext == "js")   return "text/javascript; charset=utf-8";
        if (ext == "css")  return "text/css; charset=utf-8";
        if (ext == "json") return "application/json";
        if (ext == "woff2") return "font/woff2";
        if (ext == "png")  return "image/png";
        if (ext == "svg")  return "image/svg+xml";
        return "application/octet-stream";
    }

    std::vector<std::byte> toBytes (const void* data, size_t size)
    {
        std::vector<std::byte> v (size);
        std::memcpy (v.data(), data, size);
        return v;
    }

    juce::var obj (std::initializer_list<std::pair<const char*, juce::var>> props)
    {
        auto* o = new juce::DynamicObject();
        for (auto& [k, v] : props) o->setProperty (k, v);
        return juce::var (o);
    }

    juce::String platformName()
    {
       #if JUCE_WINDOWS
        return "windows";
       #elif JUCE_MAC
        return "mac";
       #else
        return "linux";
       #endif
    }

    juce::Array<int> versionParts (juce::String v)
    {
        v = v.trimCharactersAtStart ("vV");
        juce::Array<int> parts;
        for (auto& p : juce::StringArray::fromTokens (v, ".-", {})) parts.add (p.getIntValue());
        while (parts.size() < 3) parts.add (0);
        return parts;
    }

    bool isNewer (const juce::String& candidate, const juce::String& current)
    {
        auto a = versionParts (candidate), b = versionParts (current);
        for (int i = 0; i < 3; ++i)
            if (a[i] != b[i]) return a[i] > b[i];
        return false;
    }

    /** Wraps the device selector so the settings are saved when the dialog closes. */
    struct AudioSettingsPanel : juce::Component
    {
        AudioSettingsPanel (Services& s) : sv (s),
            selector (s.devices, 0, 0, 1, 2, true, false, true, false)
        {
            addAndMakeVisible (selector);
            setSize (560, 460);
        }
        ~AudioSettingsPanel() override { sv.saveAudioSettings(); }
        void resized() override { selector.setBounds (getLocalBounds().reduced (8)); }
        Services& sv;
        juce::AudioDeviceSelectorComponent selector;
    };

    void addTpdfDither (juce::AudioBuffer<float>& b)
    {
        juce::Random r;
        const float lsb = 1.0f / 32768.0f;
        for (int c = 0; c < b.getNumChannels(); ++c)
        {
            auto* d = b.getWritePointer (c);
            for (int i = 0; i < b.getNumSamples(); ++i) d[i] += (r.nextFloat() - r.nextFloat()) * lsb;
        }
    }

    bool writeWav (const juce::File& f, const juce::AudioBuffer<float>& b, double sr, int bits)
    {
        f.getParentDirectory().createDirectory();
        f.deleteFile();
        std::unique_ptr<juce::OutputStream> out (f.createOutputStream().release());
        if (out == nullptr) return false;
        juce::WavAudioFormat wav;
        auto w = wav.createWriterFor (out, juce::AudioFormatWriterOptions{}
                                               .withSampleRate (sr)
                                               .withNumChannels (b.getNumChannels())
                                               .withBitsPerSample (bits));
        if (w == nullptr) return false;
        return w->writeFromAudioSampleBuffer (b, 0, b.getNumSamples());
    }

    juce::MemoryBlock interleave (const juce::AudioBuffer<float>& b)
    {
        juce::MemoryBlock mb ((size_t) b.getNumSamples() * 2 * sizeof (float));
        auto* d = static_cast<float*> (mb.getData());
        const float* l = b.getReadPointer (0);
        const float* r = b.getReadPointer (b.getNumChannels() > 1 ? 1 : 0);
        for (int i = 0; i < b.getNumSamples(); ++i) { d[2 * i] = l[i]; d[2 * i + 1] = r[i]; }
        return mb;
    }

    juce::String safeFileName (juce::String s)
    {
        s = juce::File::createLegalFileName (s.trim());
        return s.isEmpty() ? juce::String ("Track") : s;
    }
}

//==============================================================================
Bridge::Bridge (Services& s, juce::Component& c) : sv (s), content (c)
{
    juce::WeakReference<Bridge> weak (this);
    sv.onSampleNeeded = [weak] (const juce::String& id)
    {
        if (auto* b = weak.get())
            if (b->requested.insert (id).second)
                b->emit (obj ({ { "type", "needSample" }, { "id", id } }));
    };
    sv.onPluginStatus = [weak] (const juce::String& owner, const juce::String& st)
    {
        juce::MessageManager::callAsync ([weak, owner, st]
        {
            if (auto* b = weak.get()) b->emit (obj ({ { "type", "pluginStatus" }, { "id", owner }, { "status", st } }));
        });
    };
    startTimerHz (30);
}

Bridge::~Bridge()
{
    stopTimer();
    if (cancelFlag) *cancelFlag = true;
    for (int i = 0; i < 300 && sv.engine.exporting.load(); ++i) juce::Thread::sleep (10);
    decodePool.removeAllJobs (true, 2000);
    sv.onSampleNeeded = nullptr;
    sv.onPluginStatus = nullptr;
}

juce::WebBrowserComponent::Options Bridge::browserOptions()
{
    using Options = juce::WebBrowserComponent::Options;
    return Options{}
        .withBackend (Options::Backend::webview2)
        .withWinWebView2Options (Options::WinWebView2{}
                                    .withUserDataFolder (paths::webview())
                                    .withStatusBarDisabled()
                                    .withBuiltInErrorPageDisabled()
                                    .withBackgroundColour (juce::Colour (0xff14181c)))
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withNativeIntegrationEnabled()
        .withInitialisationData ("nxwDesktop", obj ({ { "version", NXW_VERSION }, { "platform", platformName() } }))
        .withNativeFunction ("nxw", [this] (const juce::Array<juce::var>& args, Completion done) { handle (args, std::move (done)); })
        .withResourceProvider ([this] (const juce::String& url) { return resource (url); });
}

void Bridge::emit (const juce::var& payload)
{
    if (browser != nullptr) browser->emitEventIfBrowserIsVisible ("nxw", payload);
}

//==============================================================================
// Resources: the interface files, plus rendered audio for the MP3 encoder
//==============================================================================
std::optional<juce::WebBrowserComponent::Resource> Bridge::resource (const juce::String& url)
{
    auto path = url.upToFirstOccurrenceOf ("?", false, false);
    if (path.startsWith ("/")) path = path.substring (1);
    if (path.isEmpty()) path = "index.html";

    if (path.startsWith ("__render/"))
    {
        const auto token = path.fromFirstOccurrenceOf ("__render/", false, false).upToFirstOccurrenceOf ("/", false, false);
        const int index = path.fromLastOccurrenceOf ("/", false, false).getIntValue();
        auto it = renders.find (token);
        if (it == renders.end() || index < 0 || index >= (int) it->second.data.size()) return std::nullopt;
        const auto& mb = it->second.data[(size_t) index];
        return juce::WebBrowserComponent::Resource { toBytes (mb.getData(), mb.getSize()), "application/octet-stream" };
    }

    const auto fileName = path.fromLastOccurrenceOf ("/", false, false);
    for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
    {
        if (fileName == BinaryData::originalFilenames[i])
        {
            int size = 0;
            if (auto* data = BinaryData::getNamedResource (BinaryData::namedResourceList[i], size))
                return juce::WebBrowserComponent::Resource { toBytes (data, (size_t) size), mimeFor (fileName) };
        }
    }
    juce::Logger::writeToLog ("Missing resource: " + url);
    return std::nullopt;
}

//==============================================================================
// Native function dispatch
//==============================================================================
void Bridge::handle (const juce::Array<juce::var>& args, Completion done)
{
    const auto method = args.isEmpty() ? juce::String() : args[0].toString();
    auto arg = [&] (int i) -> juce::var { return i + 1 < args.size() ? args[i + 1] : juce::var(); };
    auto& eng = sv.engine;

    if (method == "hello")
    {
        done (obj ({ { "version", NXW_VERSION }, { "platform", platformName() }, { "engine", true },
                     { "repo", NXW_GITHUB_REPO }, { "data", paths::data().getFullPathName() },
                     { "logs", paths::logs().getFullPathName() }, { "sampleRate", eng.getSampleRate() },
                     { "pluginsScanned", sv.host.hasScannedBefore() } }));
        return;
    }
    if (method == "log")
    {
        juce::Logger::writeToLog ("[ui " + arg (0).toString() + "] " + arg (1).toString());
        done ({});
        return;
    }
    if (method == "openUrl") { juce::URL (arg (0).toString()).launchInDefaultBrowser(); done ({}); return; }
    if (method == "reveal") { juce::File (arg (0).toString()).revealToUser(); done ({}); return; }
    if (method == "revealLogs") { paths::logs().revealToUser(); done ({}); return; }
    if (method == "checkUpdate") { checkForUpdate ((bool) arg (0), std::move (done)); return; }
    if (method == "quit") { juce::JUCEApplication::getInstance()->systemRequestedQuit(); done ({}); return; }

    //---- project ----------------------------------------------------------
    if (method == "setProject")
    {
        lastProject = arg (0);
        eng.setProject (lastProject);
        autosaveDirty = true;
        lastChange = juce::Time::getMillisecondCounter();
        done ({});
        return;
    }
    if (method == "loadAutosave")
    {
        const auto f = paths::autosave().getChildFile ("project.json");
        done (f.existsAsFile() ? juce::var (f.loadFileAsString()) : juce::var());
        return;
    }
    if (method == "saveProject")
    {
        auto project = arg (0);
        auto name = safeFileName (arg (1).toString().isNotEmpty() ? arg (1).toString() : juce::String ("Project"));
        chooseFile (true, "Save project", paths::projects().getChildFile (name + ".json"), "*.json",
                    [this, project, done] (juce::File f)
        {
            if (f == juce::File()) { done ({}); return; }
            if (! f.hasFileExtension ("json")) f = f.withFileExtension ("json");
            const bool ok = f.replaceWithText (juce::JSON::toString (withPluginStates (project), true));
            done (ok ? juce::var (f.getFullPathName()) : juce::var());
        });
        return;
    }
    if (method == "saveProjectTo")
    {
        juce::File f (arg (0).toString());
        done (f.getParentDirectory().isDirectory() && f.replaceWithText (juce::JSON::toString (withPluginStates (arg (1)), true)));
        return;
    }
    if (method == "openProject")
    {
        chooseFile (false, "Open project", paths::projects(), "*.json", [done] (juce::File f)
        {
            if (! f.existsAsFile()) { done ({}); return; }
            done (obj ({ { "name", f.getFileName() }, { "path", f.getFullPathName() }, { "text", f.loadFileAsString() } }));
        });
        return;
    }
    if (method == "pluginStates")
    {
        auto* o = new juce::DynamicObject();
        for (auto& [id, p] : eng.allPlugins()) o->setProperty (id, eng.currentPluginState (id));
        done (juce::var (o));
        return;
    }
    if (method == "stashStates")
    {
        if (auto* o = arg (0).getDynamicObject())
            for (auto& prop : o->getProperties())
                eng.stashPluginState (prop.name.toString(), prop.value.toString());
        done ({});
        return;
    }
    if (method == "copyPluginState")
    {
        eng.stashPluginState (arg (1).toString(), eng.currentPluginState (arg (0).toString()));
        done ({});
        return;
    }

    //---- files ------------------------------------------------------------
    if (method == "saveFile" || method == "chooseSavePath")
    {
        const auto name = safeFileName (arg (0).toString());
        const auto ext = name.fromLastOccurrenceOf (".", false, false);
        const auto b64 = method == "saveFile" ? arg (1).toString() : juce::String();
        const bool isSave = method == "saveFile";
        chooseFile (true, isSave ? "Save" : "Export to", paths::projects().getChildFile (name), ext.isNotEmpty() ? "*." + ext : "*",
                    [b64, isSave, ext, done] (juce::File f)
        {
            if (f == juce::File()) { done ({}); return; }
            if (ext.isNotEmpty() && ! f.hasFileExtension (ext)) f = f.withFileExtension (ext);
            if (isSave)
            {
                juce::MemoryBlock mb;
                if (! fromBase64 (b64, mb) || ! f.replaceWithData (mb.getData(), mb.getSize())) { done ({}); return; }
            }
            done (f.getFullPathName());
        });
        return;
    }
    if (method == "writeFile")
    {
        juce::File f (arg (0).toString());
        juce::MemoryBlock mb;
        f.getParentDirectory().createDirectory();
        done (fromBase64 (arg (1).toString(), mb) && f.replaceWithData (mb.getData(), mb.getSize()));
        return;
    }

    //---- transport and notes ---------------------------------------------
    if (method == "play")      { eng.play ((bool) arg (0), (double) arg (1)); done ({}); return; }
    if (method == "stop")      { eng.stop(); done ({}); return; }
    if (method == "setPos")    { eng.setSongPosition ((double) arg (0)); done ({}); return; }
    if (method == "setMode")   { eng.setPatternMode ((bool) arg (0), (double) arg (1)); done ({}); return; }
    if (method == "noteOn")    { eng.liveNoteOn (hashId (arg (0).toString()), (int) arg (1), (float) (double) arg (2)); done ({}); return; }
    if (method == "noteOff")   { eng.liveNoteOff (hashId (arg (0).toString()), (int) arg (1)); done ({}); return; }
    if (method == "allNotesOff") { eng.allLiveNotesOff(); done ({}); return; }
    if (method == "preview")
    {
        const auto spec = arg (0);
        if (spec["type"].toString() == "sampler" && ! sv.bank.isKnown (spec["sample"].toString()))
        {
            done (obj ({ { "missing", true } }));
            return;
        }
        eng.preview (spec, (int) arg (1), (double) arg (2));
        done ({});
        return;
    }
    if (method == "stopPreview") { eng.stopPreview(); done ({}); return; }

    //---- samples ----------------------------------------------------------
    if (method == "hasSamples")
    {
        auto* o = new juce::DynamicObject();
        if (auto* ids = arg (0).getArray())
            for (auto& id : *ids) o->setProperty (id.toString(), sv.bank.isKnown (id.toString()));
        done (juce::var (o));
        return;
    }
    if (method == "putSample")
    {
        const auto id = arg (0).toString(), b64 = arg (1).toString(), name = arg (2).toString();
        juce::WeakReference<Bridge> weak (this);
        decodePool.addJob ([weak, id, b64, name, done, this]
        {
            juce::MemoryBlock mb;
            juce::String err = fromBase64 (b64, mb) ? sv.bank.put (id, mb, name) : juce::String ("Invalid data");
            juce::MessageManager::callAsync ([weak, id, err, done]
            {
                auto* b = weak.get();
                if (b == nullptr) return;
                b->requested.erase (id);
                if (err.isEmpty()) b->sv.engine.sampleArrived (id);
                done (obj ({ { "ok", err.isEmpty() }, { "error", err } }));
            });
        });
        return;
    }
    if (method == "forgetSample") { sv.bank.forget (arg (0).toString()); done ({}); return; }

    //---- audio settings and export ---------------------------------------
    if (method == "audioSettings") { openAudioSettings(); done ({}); return; }
    if (method == "audioInfo")
    {
        auto* d = sv.devices.getCurrentAudioDevice();
        done (obj ({ { "device", d ? d->getName() : juce::String ("None") },
                     { "type", d ? d->getTypeName() : juce::String() },
                     { "sampleRate", d ? d->getCurrentSampleRate() : 0.0 },
                     { "buffer", d ? d->getCurrentBufferSizeSamples() : 0 },
                     { "latencyMs", d ? 1000.0 * (d->getOutputLatencyInSamples() + d->getCurrentBufferSizeSamples()) / juce::jmax (1.0, d->getCurrentSampleRate()) : 0.0 } }));
        return;
    }
    if (method == "exportAudio") { exportAudio (arg (0), std::move (done)); return; }
    if (method == "cancelExport") { if (cancelFlag) *cancelFlag = true; done ({}); return; }
    if (method == "releaseRender") { renders.erase (arg (0).toString()); done ({}); return; }

    //---- plugins -----------------------------------------------------------
    if (method == "plugins") { done (sv.host.listJson()); return; }
    if (method == "scanPlugins")
    {
        juce::WeakReference<Bridge> weak (this);
        sv.host.startScan ((bool) arg (0), [weak] (const PluginHost::ScanProgress& p)
        {
            auto* b = weak.get();
            if (b == nullptr) return;
            juce::Array<juce::var> failed;
            for (auto& f : p.failed) failed.add (f);
            b->emit (obj ({ { "type", "scan" }, { "running", p.running }, { "done", p.done }, { "total", p.total },
                            { "current", p.current }, { "found", p.found }, { "failed", failed },
                            { "plugins", p.running ? juce::var() : b->sv.host.listJson() } }));
        });
        done (sv.host.isScanning());
        return;
    }
    if (method == "cancelScan") { sv.host.cancelScan(); done ({}); return; }
    if (method == "pluginFolders")
    {
        juce::Array<juce::var> a;
        for (auto& f : sv.host.getExtraFolders()) a.add (f);
        done (a);
        return;
    }
    if (method == "addPluginFolder")
    {
        chooser = std::make_unique<juce::FileChooser> ("Choose a folder that contains VST3 plugins",
                                                        juce::File::getSpecialLocation (juce::File::userHomeDirectory));
        chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
                              [this, done] (const juce::FileChooser& fc)
        {
            auto f = fc.getResult();
            auto folders = sv.host.getExtraFolders();
            if (f.isDirectory()) folders.addIfNotAlreadyThere (f.getFullPathName());
            sv.host.setExtraFolders (folders);
            juce::Array<juce::var> a;
            for (auto& s : folders) a.add (s);
            done (a);
        });
        return;
    }
    if (method == "removePluginFolder")
    {
        auto folders = sv.host.getExtraFolders();
        folders.removeString (arg (0).toString());
        sv.host.setExtraFolders (folders);
        done ({});
        return;
    }
    if (method == "openPlugin")
    {
        if (auto* p = eng.findPlugin (arg (0).toString()))
        {
            sv.host.showEditor (arg (0).toString(), *p, arg (1).toString().isNotEmpty() ? arg (1).toString() : p->getName(),
                                content.getTopLevelComponent());
            done (true);
        }
        else done (false);
        return;
    }

    juce::Logger::writeToLog ("Unknown bridge method: " + method);
    done ({});
}

//==============================================================================
void Bridge::chooseFile (bool save, const juce::String& title, const juce::File& start, const juce::String& patterns,
                         std::function<void (juce::File)> then)
{
    chooser = std::make_unique<juce::FileChooser> (title, start, patterns);
    const int flags = save ? (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                              | juce::FileBrowserComponent::warnAboutOverwriting)
                           : (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles);
    chooser->launchAsync (flags, [then] (const juce::FileChooser& fc) { then (fc.getResult()); });
}

juce::var Bridge::withPluginStates (const juce::var& project)
{
    auto clone = juce::JSON::parse (juce::JSON::toString (project, true));
    auto& eng = sv.engine;
    if (auto* chans = clone["channels"].getArray())
        for (auto& c : *chans)
            if (c["type"].toString() == "plugin")
                if (auto* p = c["plugin"].getDynamicObject())
                    p->setProperty ("state", eng.currentPluginState (c["id"].toString()));
    if (auto* mix = clone["mixer"].getArray())
        for (auto& m : *mix)
            if (auto* fx = m["fx"].getArray())
                for (auto& f : *fx)
                    if (f["type"].toString() == "plugin")
                        if (auto* p = f["plugin"].getDynamicObject())
                            p->setProperty ("state", eng.currentPluginState (f["id"].toString()));
    return clone;
}

void Bridge::autosaveNow()
{
    if (lastProject.isVoid()) return;
    autosaveDirty = false;
    const auto folder = paths::autosave();
    const auto file = folder.getChildFile ("project.json");
    const auto tmp = folder.getChildFile ("project.tmp");
    if (tmp.replaceWithText (juce::JSON::toString (withPluginStates (lastProject), true)))
    {
        if (file.existsAsFile()) file.copyFileTo (folder.getChildFile ("project.previous.json"));
        tmp.moveFileTo (file);
    }
}

//==============================================================================
void Bridge::timerCallback()
{
    ++tickCount;
    sendTick();

    if (tickCount % 30 == 0 && sv.engine.pluginStateChanged())
    {
        autosaveDirty = true;
        lastChange = juce::Time::getMillisecondCounter();
    }
    if (autosaveDirty && juce::Time::getMillisecondCounter() - lastChange > 1500)
        autosaveNow();
}

void Bridge::sendTick()
{
    auto st = sv.engine.readStatus();
    const bool busy = st.playing || st.voices > 0 || ! st.hits.isEmpty();
    float loud = 0;
    for (auto& m : st.meters) loud = juce::jmax (loud, m[0], m[1]);
    static int quietTicks = 0;
    quietTicks = (busy || loud > 0.0001f) ? 0 : quietTicks + 1;
    if (quietTicks > 15 && tickCount % 8 != 0) return;   // idle: 4 updates a second

    auto r3 = [] (double v) { return std::round (v * 10000.0) / 10000.0; };
    juce::Array<juce::var> meters, red;
    for (int i = 0; i <= kNumInserts; ++i)
    {
        meters.add (juce::Array<juce::var> { r3 (st.meters[i][0]), r3 (st.meters[i][1]) });
        red.add (r3 (st.reduction[i]));
    }
    juce::Array<juce::var> scope;
    if (wantScope)
    {
        float buf[960];
        sv.engine.scopeSnapshot (buf, 960);
        for (int i = 0; i < 960; i += 4) scope.add (r3 (buf[i]));
    }
    emit (obj ({ { "type", "tick" }, { "playing", st.playing }, { "pat", st.patMode }, { "pos", st.position },
                 { "meters", meters }, { "red", red }, { "voices", st.voices }, { "cpu", r3 (st.cpu) },
                 { "hits", st.hits }, { "scope", scope } }));
}

//==============================================================================
void Bridge::openAudioSettings()
{
    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned (new AudioSettingsPanel (sv));
    o.dialogTitle = "Audio and MIDI settings";
    o.dialogBackgroundColour = juce::Colour (0xff1a1f24);
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = false;
    o.componentToCentreAround = &content;
    o.launchAsync();
}

//==============================================================================
void Bridge::checkForUpdate (bool userAsked, Completion done)
{
    const juce::String repo = NXW_GITHUB_REPO;
    if (repo.isEmpty()) { done (obj ({ { "error", "This build has no update address" } })); return; }
    juce::WeakReference<Bridge> weak (this);
    juce::Thread::launch ([weak, repo, userAsked, done]
    {
        juce::var result;
        auto opts = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                        .withExtraHeaders ("User-Agent: NXW-Studio\r\nAccept: application/vnd.github+json")
                        .withConnectionTimeoutMs (8000);
        if (auto in = juce::URL ("https://api.github.com/repos/" + repo + "/releases/latest").createInputStream (opts))
        {
            const auto json = juce::JSON::parse (in->readEntireStreamAsString());
            const auto tag = json["tag_name"].toString();
            juce::String installer;
           #if JUCE_WINDOWS
            const juce::String suffix ("-Setup.exe");
           #elif JUCE_MAC
            const juce::String suffix ("-macOS.zip");
           #else
            const juce::String suffix ("-Linux.tar.gz");
           #endif
            if (auto* assets = json["assets"].getArray())
                for (auto& a : *assets)
                    if (a["name"].toString().endsWithIgnoreCase (suffix))
                        installer = a["browser_download_url"].toString();
            if (tag.isNotEmpty())
                result = obj ({ { "latest", tag.trimCharactersAtStart ("vV") }, { "current", NXW_VERSION },
                                { "newer", isNewer (tag, NXW_VERSION) }, { "url", json["html_url"] }, { "installer", installer } });
        }
        if (result.isVoid()) result = obj ({ { "error", "Could not reach GitHub" } });
        juce::MessageManager::callAsync ([weak, result, userAsked, done]
        {
            auto* b = weak.get();
            if (b == nullptr) return;
            done (result);
            if (! userAsked && (bool) result["newer"]) b->emit (obj ({ { "type", "update" }, { "info", result } }));
        });
    });
}

//==============================================================================
// Export: render offline, write WAV directly or hand PCM to the interface's MP3 encoder
//==============================================================================
void Bridge::exportAudio (const juce::var& o, Completion done)
{
    auto& eng = sv.engine;
    if (eng.exporting.load()) { done (obj ({ { "error", "An export is already running" } })); return; }

    Engine::RenderRequest req;
    req.patternMode = (bool) o["patternMode"];
    req.fromStep = (int) o["fromStep"];
    req.steps = juce::jmax (1, (int) o["steps"]);
    req.sampleRate = (double) o["sr"] > 0 ? (double) o["sr"] : 44100.0;
    req.tail = (bool) o["tail"];
    req.stems = (bool) o["stems"];
    const bool normalize = (bool) o["normalize"];
    const auto fmt = o["fmt"].toString();
    const juce::File path (o["path"].toString());
    juce::StringArray stemNames;
    if (auto* names = o["stemNames"].getArray()) for (auto& n : *names) stemNames.add (n.toString());

    auto* dev = sv.devices.getCurrentAudioDevice();
    const double liveRate = dev ? dev->getCurrentSampleRate() : eng.getSampleRate();
    const int liveBlock = dev ? dev->getCurrentBufferSizeSamples() : eng.getBlockSize();

    eng.stop();
    juce::Thread::sleep (30);           // let the stop command reach the audio thread
    eng.exporting = true;
    eng.setPluginsNonRealtime (true);
    eng.prepareAll (req.sampleRate, 512);
    cancelFlag = std::make_shared<std::atomic<bool>> (false);
    auto cancel = cancelFlag;

    juce::WeakReference<Bridge> weak (this);
    Engine* engPtr = &eng;
    juce::Thread::launch ([weak, engPtr, req, normalize, fmt, path, stemNames, liveRate, liveBlock, done, cancel]
    {
        juce::AudioBuffer<float> master;
        std::vector<juce::AudioBuffer<float>> stems;
        std::function<bool (double)> onProgress = [w = weak, c = cancel, lastSent = -1.0] (double p) mutable
        {
            if (p - lastSent > 0.02)
            {
                lastSent = p;
                juce::MessageManager::callAsync ([w, p]
                {
                    if (auto* b = w.get()) b->emit (obj ({ { "type", "export" }, { "stage", "render" }, { "progress", p } }));
                });
            }
            return ! c->load();
        };
        const bool ok = engPtr->renderOffline (req, master, stems, onProgress);

        juce::var result;
        if (! ok) result = obj ({ { "cancelled", true } });
        else
        {
            if (normalize)
            {
                const float pk = master.getMagnitude (0, master.getNumSamples());
                if (pk > 0.0001f) master.applyGain (0.966f / pk);
            }
            // Only keep stems that have sound in them.
            juce::Array<int> stemIdx;
            for (int i = 0; i < (int) stems.size(); ++i)
                if (stems[(size_t) i].getMagnitude (0, stems[(size_t) i].getNumSamples()) > 0.0002f) stemIdx.add (i);

            auto stemName = [&] (int i)
            {
                const auto nm = i < stemNames.size() ? stemNames[i] : juce::String ("Insert " + juce::String (i + 1));
                return juce::String (i + 1).paddedLeft ('0', 2) + " " + safeFileName (nm);
            };
            const auto stemFolder = path.getParentDirectory().getChildFile (path.getFileNameWithoutExtension() + " stems");

            if (fmt.startsWith ("wav"))
            {
                const int bits = fmt == "wav24" ? 24 : 16;
                if (bits == 16) addTpdfDither (master);
                bool wrote = writeWav (path, master, req.sampleRate, bits);
                juce::Array<juce::var> stemFiles;
                for (int i : stemIdx)
                {
                    auto& s = stems[(size_t) i];
                    if (bits == 16) addTpdfDither (s);
                    const auto f = stemFolder.getChildFile (stemName (i) + ".wav");
                    wrote = writeWav (f, s, req.sampleRate, bits) && wrote;
                    stemFiles.add (f.getFullPathName());
                }
                result = wrote ? obj ({ { "path", path.getFullPathName() }, { "stems", stemFiles } })
                               : obj ({ { "error", "Could not write " + path.getFullPathName() } });
            }
            else
            {
                Render r;
                r.sr = req.sampleRate;
                r.data.push_back (interleave (master));
                juce::Array<juce::var> stemPaths;
                for (int i : stemIdx)
                {
                    r.data.push_back (interleave (stems[(size_t) i]));
                    stemPaths.add (stemFolder.getChildFile (stemName (i) + ".mp3").getFullPathName());
                }
                const auto token = juce::Uuid().toDashedString();
                const int frames = master.getNumSamples();
                juce::MessageManager::callAsync ([weak, token, r]
                {
                    if (auto* b = weak.get()) b->renders[token] = r;
                });
                result = obj ({ { "token", token }, { "sr", req.sampleRate }, { "frames", frames },
                                { "path", path.getFullPathName() }, { "stems", stemPaths } });
            }
        }

        juce::MessageManager::callAsync ([weak, engPtr, liveRate, liveBlock, result, done]
        {
            if (weak.get() == nullptr) return;          // the window closed during the export
            engPtr->setPluginsNonRealtime (false);
            engPtr->prepareAll (liveRate, liveBlock);
            engPtr->exporting = false;
            done (result);
        });
    });
}

} // namespace nxw
