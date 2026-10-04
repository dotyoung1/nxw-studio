#include "PluginHost.h"

namespace nxw
{
namespace
{
    void tryStereoLayout (juce::AudioPluginInstance& p, bool wantInput)
    {
        auto layout = p.getBusesLayout();
        if (layout.outputBuses.size() > 0) layout.outputBuses.getReference (0) = juce::AudioChannelSet::stereo();
        if (wantInput && layout.inputBuses.size() > 0) layout.inputBuses.getReference (0) = juce::AudioChannelSet::stereo();
        if (p.checkBusesLayoutSupported (layout)) p.setBusesLayout (layout);
    }

    void restoreState (juce::AudioPluginInstance& p, const juce::String& base64)
    {
        if (base64.isEmpty()) return;
        juce::MemoryBlock mb;
        if (fromBase64 (base64, mb) && mb.getSize() > 0)
            p.setStateInformation (mb.getData(), (int) mb.getSize());
    }
}

//==============================================================================
// Plugin instrument
//==============================================================================
PluginInstrument::PluginInstrument (std::unique_ptr<juce::AudioPluginInstance> p, juce::AudioPlayHead* ph)
    : plugin (std::move (p))
{
    queue.reserve (8192);
    plugin->setPlayHead (ph);
    plugin->addListener (this);
}

PluginInstrument::~PluginInstrument()
{
    plugin->removeListener (this);
    plugin->releaseResources();
}

void PluginInstrument::prepare (double sampleRate, int maxBlock)
{
    Instrument::prepare (sampleRate, maxBlock);
    plugin->releaseResources();
    plugin->setRateAndBufferSizeDetails (sampleRate, maxBlock);
    plugin->prepareToPlay (sampleRate, maxBlock);
    const int chans = juce::jmax (2, plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels());
    buffer.setSize (chans, maxBlock);
    midi.ensureSize (8192);
}

void PluginInstrument::push (const Ev& e)
{
    if (queue.size() >= queue.capacity()) return;
    auto it = std::upper_bound (queue.begin(), queue.end(), e.time, [] (int64 t, const Ev& x) { return t < x.time; });
    queue.insert (it, e);
}

void PluginInstrument::noteOn (int64 when, int key, float vel, double durSamples, juce::uint32)
{
    push ({ when, key, vel, true });
    if (durSamples >= 0) push ({ when + juce::jmax ((int64) 1, (int64) std::llround (durSamples)), key, 0, false });
}

void PluginInstrument::noteOff (int64 when, int key, juce::uint32) { push ({ when, key, 0, false }); }

void PluginInstrument::choke (int64 when)
{
    for (int k = 0; k < 128; ++k)
        if (held[(size_t) k] > 0) push ({ when, k, 0, false });
}

void PluginInstrument::releaseAll (int64 when)
{
    // Drop scheduled note-ons, release everything that is sounding.
    queue.erase (std::remove_if (queue.begin(), queue.end(), [] (const Ev& e) { return e.on; }), queue.end());
    choke (when);
}

void PluginInstrument::kill()
{
    queue.clear();
    killPending = true;
}

bool PluginInstrument::render (float* L, float* R, int64 blockStart, int n)
{
    midi.clear();
    if (killPending)
    {
        killPending = false;
        for (int c = 1; c <= 16; ++c) midi.addEvent (juce::MidiMessage::allNotesOff (c), 0);
        held.fill (0);
        plugin->reset();
    }

    size_t used = 0;
    const int64 end = blockStart + n;
    for (; used < queue.size() && queue[used].time < end; ++used)
    {
        const auto& e = queue[used];
        const int off = (int) juce::jlimit ((int64) 0, (int64) n - 1, e.time - blockStart);
        if (e.on)
        {
            midi.addEvent (juce::MidiMessage::noteOn (1, e.key, juce::jlimit (0.01f, 1.0f, e.vel)), off);
            ++held[(size_t) e.key];
        }
        else if (held[(size_t) e.key] > 0)
        {
            midi.addEvent (juce::MidiMessage::noteOff (1, e.key), off);
            --held[(size_t) e.key];
        }
    }
    if (used > 0) queue.erase (queue.begin(), queue.begin() + (long) used);

    voices = 0;
    for (auto h : held) voices += h;

    juce::AudioBuffer<float> view (buffer.getArrayOfWritePointers(), buffer.getNumChannels(), n);
    view.clear();
    plugin->processBlock (view, midi);

    const int outs = plugin->getTotalNumOutputChannels();
    if (outs <= 0) return false;
    juce::FloatVectorOperations::add (L, view.getReadPointer (0), n);
    juce::FloatVectorOperations::add (R, view.getReadPointer (outs > 1 ? 1 : 0), n);
    return true;
}

//==============================================================================
// Plugin effect
//==============================================================================
PluginEffect::PluginEffect (std::unique_ptr<juce::AudioPluginInstance> p, juce::AudioPlayHead* ph)
    : plugin (std::move (p))
{
    type = "plugin";
    plugin->setPlayHead (ph);
    plugin->addListener (this);
}

PluginEffect::~PluginEffect()
{
    plugin->removeListener (this);
    plugin->releaseResources();
}

void PluginEffect::prepare (double sampleRate, int maxBlock)
{
    plugin->releaseResources();
    plugin->setRateAndBufferSizeDetails (sampleRate, maxBlock);
    plugin->prepareToPlay (sampleRate, maxBlock);
    const int chans = juce::jmax (2, plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels());
    buffer.setSize (chans, maxBlock);
    midi.ensureSize (256);
}

void PluginEffect::process (float* L, float* R, int n, int64)
{
    juce::AudioBuffer<float> view (buffer.getArrayOfWritePointers(), buffer.getNumChannels(), n);
    view.clear();
    const int ins = plugin->getMainBusNumInputChannels();
    if (ins >= 2)
    {
        view.copyFrom (0, 0, L, n);
        view.copyFrom (1, 0, R, n);
    }
    else if (ins == 1)
    {
        view.copyFrom (0, 0, L, n, 0.5f);
        view.addFrom (0, 0, R, n, 0.5f);
    }
    midi.clear();
    plugin->processBlock (view, midi);
    const int outs = plugin->getMainBusNumOutputChannels();
    if (outs >= 2)
    {
        juce::FloatVectorOperations::copy (L, view.getReadPointer (0), n);
        juce::FloatVectorOperations::copy (R, view.getReadPointer (1), n);
    }
    else if (outs == 1)
    {
        juce::FloatVectorOperations::copy (L, view.getReadPointer (0), n);
        juce::FloatVectorOperations::copy (R, view.getReadPointer (0), n);
    }
}

//==============================================================================
// Plugin windows
//==============================================================================
namespace
{
    /** Web key codes for the studio's typing keyboard (Z..M, Q..P rows, digits, comma). */
    juce::String webCodeFor (int keyCode)
    {
        if (keyCode >= 'a' && keyCode <= 'z') keyCode -= 'a' - 'A';
        if (keyCode >= 'A' && keyCode <= 'Z') return "Key" + juce::String::charToString ((juce::juce_wchar) keyCode);
        if (keyCode >= '0' && keyCode <= '9') return "Digit" + juce::String::charToString ((juce::juce_wchar) keyCode);
        if (keyCode == ',') return "Comma";
        return {};
    }
    int keyCodeForWeb (const juce::String& code)
    {
        if (code.startsWith ("Key"))   return code.getLastCharacter();
        if (code.startsWith ("Digit")) return code.getLastCharacter();
        if (code == "Comma") return ',';
        return 0;
    }
}

/** A plugin's editor in its own movable window. Closing it only hides it, so it reopens
    instantly where it was; it is destroyed when the plugin is removed. */
class PluginHost::PluginWindow : public juce::DocumentWindow
{
public:
    PluginWindow (PluginHost& h, const juce::String& ownerIdIn, const juce::String& title, juce::AudioProcessor& p, juce::Component* owner)
        : DocumentWindow (title, juce::Colour (0xff14181c), DocumentWindow::closeButton, false),
          host (h), ownerId (ownerIdIn), processor (p)
    {
        setUsingNativeTitleBar (true);
        juce::AudioProcessorEditor* editor = p.hasEditor() ? p.createEditorIfNeeded() : nullptr;
        if (editor == nullptr) editor = new juce::GenericAudioProcessorEditor (p);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);

        // A real top-level window (not a child of the studio window), so it can be moved
        // anywhere, resized and hidden; it stays above the studio like FL Studio's plugin windows.
        addToDesktop (getDesktopWindowStyleFlags() & ~juce::ComponentPeer::windowAppearsOnTaskbar);
        setOwnerWindow (*this, owner != nullptr ? owner->getTopLevelComponent() : nullptr);

        const auto it = host.windowPositions.find (ownerId);
        if (it != host.windowPositions.end())
        {
            setTopLeftPosition (it->second);
        }
        else
        {
            const auto* display = juce::Desktop::getInstance().getDisplays().getDisplayForRect (
                owner != nullptr ? owner->getScreenBounds() : juce::Rectangle<int> (0, 0, 1, 1));
            const auto area = display != nullptr ? display->userArea : juce::Rectangle<int> (0, 0, 1280, 800);
            const int cascade = 28 * (host.windows.size() % 8);
            setTopLeftPosition (area.getCentreX() - getWidth() / 2 - 120 + cascade,
                                area.getCentreY() - getHeight() / 2 - 80 + cascade);
        }
        keepOnScreen();
        setVisible (true);
        toFront (true);
    }

    ~PluginWindow() override
    {
        rememberPosition();
        clearContentComponent();
    }

    void reveal()
    {
        keepOnScreen();
        setVisible (true);
        setMinimised (false);
        toFront (true);
    }

    void hide()
    {
        rememberPosition();
        releaseKeys();
        setVisible (false);
    }

    void closeButtonPressed() override { hide(); }
    void moved() override { DocumentWindow::moved(); rememberPosition(); }

    // Studio keys pressed while the plugin window has focus: Space plays/stops, the typing
    // keyboard plays the selected channel (as in FL Studio). Keys the plugin handles never get here.
    bool keyPressed (const juce::KeyPress& k) override
    {
        if (! host.onKey) return false;
        if (k == juce::KeyPress::spaceKey) { host.onKey ("toggle", {}); return true; }
        if (k.getModifiers().isCommandDown() || k.getModifiers().isAltDown()) return false;
        const auto code = webCodeFor (k.getKeyCode());
        if (code.isEmpty()) return false;
        if (! held.contains (code)) { held.add (code); host.onKey ("down", code); }
        return true;
    }

    bool keyStateChanged (bool) override
    {
        for (int i = held.size(); --i >= 0;)
            if (! juce::KeyPress::isKeyCurrentlyDown (keyCodeForWeb (held[i])))
            {
                if (host.onKey) host.onKey ("up", held[i]);
                held.remove (i);
            }
        return false;
    }

    void focusLost (FocusChangeType) override { releaseKeys(); }

    PluginHost& host;
    const juce::String ownerId;
    juce::AudioProcessor& processor;

private:
    void rememberPosition() { if (isOnDesktop()) host.windowPositions[ownerId] = getPosition(); }

    void releaseKeys()
    {
        for (auto& c : held) if (host.onKey) host.onKey ("up", c);
        held.clear();
    }

    /** Pulls the window back if a remembered position is off every screen (a monitor was unplugged). */
    void keepOnScreen()
    {
        const auto& displays = juce::Desktop::getInstance().getDisplays();
        const auto title = getBounds().withHeight (40);
        for (auto& d : displays.displays)
            if (d.userArea.intersects (title.reduced (20, 0))) return;
        if (auto* primary = displays.getPrimaryDisplay())
            setTopLeftPosition (primary->userArea.getPosition() + juce::Point<int> (80, 80));
    }

    juce::StringArray held;
};

bool PluginHost::showEditor (const juce::String& ownerId, juce::AudioProcessor& p, const juce::String& title,
                             juce::Component* owner, bool toggle)
{
    for (auto* w : windows)
        if (&w->processor == &p)
        {
            if (toggle && w->isVisible() && ! w->isMinimised()) { w->hide(); return false; }
            w->setName (title);
            w->reveal();
            return true;
        }
    windows.add (new PluginWindow (*this, ownerId, title, p, owner));
    return true;
}

void PluginHost::hideEditorFor (const juce::String& ownerId)
{
    for (auto* w : windows) if (w->ownerId == ownerId) w->hide();
}

void PluginHost::closeEditorFor (juce::AudioProcessor* p)
{
    for (int i = windows.size(); --i >= 0;)
        if (&windows[i]->processor == p) windows.remove (i);
}

void PluginHost::closeAllEditors() { windows.clear(); }

bool PluginHost::hasEditorFor (const juce::String& ownerId) const
{
    for (auto* w : windows) if (w->ownerId == ownerId && w->isVisible()) return true;
    return false;
}

//==============================================================================
// Scanning
//==============================================================================
namespace
{
    /** True if a VST3 bundle describes itself in moduleinfo.json (SDK 3.7.5 and later). Those
        are read without loading the plugin's code, so they can be listed instantly and safely. */
    bool hasUsableModuleInfo (const juce::File& bundle)
    {
        const auto contents = bundle.getChildFile ("Contents");
        for (const auto& f : { contents.getChildFile ("Resources").getChildFile ("moduleinfo.json"), contents.getChildFile ("moduleinfo.json") })
        {
            if (! f.existsAsFile() || f.getSize() > 4 * 1024 * 1024) continue;
            const auto json = juce::JSON::parse (f.loadFileAsString());
            if (auto* classes = json["Classes"].getArray())
                for (const auto& c : *classes)
                {
                    const auto cid = c["CID"].toString();
                    if (c["Category"].toString() == "Audio Module Class" && cid.length() == 32
                        && cid.containsOnly ("0123456789abcdefABCDEF"))
                        return true;
                }
        }
        return false;
    }
}

/** Finds new or changed plugins. Plugins that describe themselves are read directly; the rest
    are opened in separate helper processes, several at a time, so a plugin that crashes or
    hangs while being inspected is simply skipped. */
class PluginHost::ScanThread : public juce::Thread
{
public:
    ScanThread (PluginHost& h, bool full, std::function<void (const ScanProgress&)> cb)
        : Thread ("NXW plugin scan"), host (h), fullRescan (full), onProgress (std::move (cb)) {}

    ~ScanThread() override { stopThread (10000); }

    void run() override
    {
        juce::StringArray files;
        juce::AudioPluginFormat* vst3 = nullptr;
        for (auto* fmt : host.formatManager.getFormats())
        {
            if (fmt->getName() != "VST3") continue;
            vst3 = fmt;
            auto paths = fmt->getDefaultLocationsToSearch();
            for (auto& f : host.extraFolders) paths.add (juce::File (f));
            paths.removeRedundantPaths();
            for (auto& f : fmt->searchPathsForPlugins (paths, true, false))
            {
                if (! fullRescan && host.knownList.isListingUpToDate (f, *fmt)) continue;
                if (! fullRescan && host.knownList.getBlacklistedFiles().contains (f)) continue;
                files.add (f);
            }
        }

        progress.running = true;
        progress.total = files.size();
        report();

        // 1. Self-describing plugins: no code is loaded, takes milliseconds each.
        juce::StringArray slow;
        for (auto& file : files)
        {
            if (threadShouldExit()) break;
            if (vst3 != nullptr && hasUsableModuleInfo (juce::File (file)))
            {
                juce::OwnedArray<juce::PluginDescription> found;
                vst3->findAllTypesForFile (found, file);
                if (! found.isEmpty())
                {
                    juce::Array<juce::PluginDescription> list;
                    for (auto* d : found) list.add (*d);
                    added (file, list);
                    ++progress.done;
                    continue;
                }
            }
            slow.add (file);
        }
        if (progress.done > 0) report();

        // 2. Everything else in helper processes, several at once.
        const auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
        const auto tmp = juce::File::getSpecialLocation (juce::File::tempDirectory)
                             .getChildFile ("nxw-scan-" + juce::String (juce::Time::currentTimeMillis()));
        tmp.createDirectory();
        const int workers = juce::jlimit (2, 6, juce::SystemStats::getNumCpus() - 1);

        struct Job { std::unique_ptr<juce::ChildProcess> proc; juce::String file; juce::File out; juce::uint32 started = 0; };
        std::vector<Job> running;
        int next = 0;

        while ((next < slow.size() || ! running.empty()) && ! threadShouldExit())
        {
            while ((int) running.size() < workers && next < slow.size())
            {
                Job job;
                job.file = slow[next];
                job.out = tmp.getChildFile ("result-" + juce::String (next) + ".xml");
                job.proc = std::make_unique<juce::ChildProcess>();
                job.started = juce::Time::getMillisecondCounter();
                ++next;
                if (job.proc->start (juce::StringArray { exe.getFullPathName(), "--nxw-scan", job.file, job.out.getFullPathName() }, 0))
                    running.push_back (std::move (job));
                else
                    failed (job.file);
            }

            juce::StringArray names;
            for (auto& j : running) names.add (juce::File (j.file).getFileNameWithoutExtension());
            if (names.joinIntoString (", ") != progress.current)
            {
                progress.current = names.joinIntoString (", ");
                report();
            }

            for (auto it = running.begin(); it != running.end();)
            {
                const bool finished = ! it->proc->isRunning();
                const bool timedOut = ! finished && juce::Time::getMillisecondCounter() - it->started > 60000;
                if (! finished && ! timedOut) { ++it; continue; }
                if (timedOut) it->proc->kill();
                collect (*it, timedOut);
                it = running.erase (it);
                ++progress.done;
                report();
            }
            wait (15);
        }

        for (auto& j : running) j.proc->kill();
        running.clear();
        tmp.deleteRecursively();

        progress.running = false;
        progress.current.clear();
        juce::MessageManager::callAsync ([h = &host, cb = onProgress, copy = progress]
        {
            h->saveList();
            if (cb) cb (copy);
        });
    }

private:
    template <typename JobType>
    void collect (JobType& job, bool timedOut)
    {
        juce::Array<juce::PluginDescription> found;
        if (! timedOut && job.out.existsAsFile())
            if (auto xml = juce::XmlDocument::parse (job.out))
                for (auto* e : xml->getChildIterator())
                {
                    juce::PluginDescription d;
                    if (d.loadFromXml (*e)) found.add (d);
                }
        job.out.deleteFile();
        if (found.isEmpty()) failed (job.file);
        else added (job.file, found);
    }

    void added (const juce::String& file, const juce::Array<juce::PluginDescription>& found)
    {
        progress.found += found.size();
        juce::MessageManager::callAsync ([h = &host, found, file]
        {
            for (auto& d : found) h->knownList.addType (d);
            h->knownList.removeFromBlacklist (file);
        });
    }

    void failed (const juce::String& file)
    {
        progress.failed.add (juce::File (file).getFileName());
        juce::MessageManager::callAsync ([h = &host, file] { h->knownList.addToBlacklist (file); });
    }

    void report()
    {
        juce::MessageManager::callAsync ([cb = onProgress, copy = progress] { if (cb) cb (copy); });
    }

    PluginHost& host;
    bool fullRescan;
    std::function<void (const ScanProgress&)> onProgress;
    ScanProgress progress;
};

PluginHost::PluginHost (juce::File dataFolder)
    : folder (std::move (dataFolder)), listFile (folder.getChildFile ("plugins.xml"))
{
    formatManager.addDefaultFormats();
    folder.createDirectory();
    if (auto xml = juce::XmlDocument::parse (listFile))
    {
        knownList.recreateFromXml (*xml);
        if (auto* extra = xml->getChildByName ("NXW_FOLDERS"))
            extraFolders.addTokens (extra->getAllSubText(), "\n", {});
        extraFolders.removeEmptyStrings();
    }
}

PluginHost::~PluginHost()
{
    scanner.reset();
    windows.clear();
}

void PluginHost::saveList()
{
    if (auto xml = knownList.createXml())
    {
        auto* extra = xml->createNewChildElement ("NXW_FOLDERS");
        extra->addTextElement (extraFolders.joinIntoString ("\n"));
        xml->writeTo (listFile);
    }
}

void PluginHost::setExtraFolders (const juce::StringArray& f)
{
    extraFolders = f;
    extraFolders.removeEmptyStrings();
    extraFolders.removeDuplicates (true);
    saveList();
}

void PluginHost::startScan (bool full, std::function<void (const ScanProgress&)> onProgress)
{
    if (isScanning()) return;
    if (full) knownList.clearBlacklistedFiles();
    scanner = std::make_unique<ScanThread> (*this, full, std::move (onProgress));
    scanner->startThread();
}

void PluginHost::cancelScan()
{
    if (scanner) scanner->signalThreadShouldExit();
}

bool PluginHost::isScanning() const { return scanner != nullptr && scanner->isThreadRunning(); }

int PluginHost::runScanChild (const juce::String& pluginFile, const juce::File& resultFile)
{
    juce::AudioPluginFormatManager fm;
    fm.addDefaultFormats();
    juce::OwnedArray<juce::PluginDescription> found;
    for (auto* f : fm.getFormats())
        if (f->fileMightContainThisPluginType (pluginFile))
            f->findAllTypesForFile (found, pluginFile);

    juce::XmlElement root ("PLUGINS");
    for (auto* d : found) root.addChildElement (d->createXml().release());
    root.writeTo (resultFile);
    return found.isEmpty() ? 2 : 0;
}

juce::var PluginHost::listJson() const
{
    juce::Array<juce::var> arr;
    for (auto& d : knownList.getTypes())
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("id", d.createIdentifierString());
        o->setProperty ("name", d.name);
        o->setProperty ("vendor", d.manufacturerName);
        o->setProperty ("format", d.pluginFormatName);
        o->setProperty ("category", d.category);
        o->setProperty ("instrument", d.isInstrument);
        o->setProperty ("file", d.fileOrIdentifier);
        arr.add (juce::var (o));
    }
    return arr;
}

//==============================================================================
// Instances
//==============================================================================
std::unique_ptr<juce::AudioPluginInstance> PluginHost::instantiate (const PluginRef& ref, double sr, int block, juce::String& error)
{
    auto desc = knownList.getTypeForIdentifierString (ref.uid);
    if (desc == nullptr)
    {
        error = (ref.name.isNotEmpty() ? ref.name : juce::String ("This plugin")) + " is not installed (or not scanned yet)";
        return nullptr;
    }
    auto inst = formatManager.createPluginInstance (*desc, sr, block, error);
    if (inst == nullptr && error.isEmpty()) error = desc->name + " could not be loaded";
    return inst;
}

std::unique_ptr<Instrument> PluginHost::makeInstrument (const ChannelModel& ch, double sr, int block, juce::AudioPlayHead* ph, juce::String& error)
{
    auto inst = instantiate (ch.plugin, sr, block, error);
    if (inst == nullptr) return nullptr;
    tryStereoLayout (*inst, false);
    restoreState (*inst, ch.plugin.state);
    return std::make_unique<PluginInstrument> (std::move (inst), ph);
}

std::unique_ptr<Effect> PluginHost::makeEffect (const FxModel& fx, double sr, int block, juce::AudioPlayHead* ph, juce::String& error)
{
    auto inst = instantiate (fx.plugin, sr, block, error);
    if (inst == nullptr) return nullptr;
    tryStereoLayout (*inst, true);
    restoreState (*inst, fx.plugin.state);
    return std::make_unique<PluginEffect> (std::move (inst), ph);
}

} // namespace nxw
