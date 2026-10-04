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
class PluginHost::PluginWindow : public juce::DocumentWindow
{
public:
    PluginWindow (const juce::String& ownerIdIn, const juce::String& title, juce::AudioProcessor& p,
                  juce::Component* owner, std::function<void (PluginWindow*)> closed)
        : DocumentWindow (title, juce::Colour (0xff14181c), DocumentWindow::closeButton | DocumentWindow::minimiseButton, false),
          ownerId (ownerIdIn), processor (p), onClose (std::move (closed))
    {
        setUsingNativeTitleBar (true);
        juce::AudioProcessorEditor* editor = p.hasEditor() ? p.createEditorIfNeeded() : nullptr;
        if (editor == nullptr) editor = new juce::GenericAudioProcessorEditor (p);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);

        if (owner != nullptr && owner->getPeer() != nullptr)
            addToDesktop (getDesktopWindowStyleFlags(), owner->getPeer()->getNativeHandle());
        else
            addToDesktop (getDesktopWindowStyleFlags());

        auto area = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()->userArea;
        setTopLeftPosition (area.getCentreX() - getWidth() / 2 + juce::Random::getSystemRandom().nextInt (60) - 30,
                            area.getCentreY() - getHeight() / 2 + juce::Random::getSystemRandom().nextInt (60) - 30);
        setVisible (true);
        toFront (true);
    }

    ~PluginWindow() override { clearContentComponent(); }

    void closeButtonPressed() override { onClose (this); }

    const juce::String ownerId;
    juce::AudioProcessor& processor;

private:
    std::function<void (PluginWindow*)> onClose;
};

void PluginHost::showEditor (const juce::String& ownerId, juce::AudioProcessor& p, const juce::String& title, juce::Component* owner)
{
    for (auto* w : windows)
        if (&w->processor == &p)
        {
            w->setVisible (true);
            w->toFront (true);
            return;
        }
    windows.add (new PluginWindow (ownerId, title, p, owner, [this] (PluginWindow* w)
    {
        juce::MessageManager::callAsync ([this, w] { windows.removeObject (w); });
    }));
}

void PluginHost::closeEditorFor (juce::AudioProcessor* p)
{
    for (int i = windows.size(); --i >= 0;)
        if (&windows[i]->processor == p) windows.remove (i);
}

void PluginHost::closeAllEditors() { windows.clear(); }

bool PluginHost::hasEditorFor (const juce::String& ownerId) const
{
    for (auto* w : windows) if (w->ownerId == ownerId) return true;
    return false;
}

//==============================================================================
// Scanning
//==============================================================================
class PluginHost::ScanThread : public juce::Thread
{
public:
    ScanThread (PluginHost& h, bool full, std::function<void (const ScanProgress&)> cb)
        : Thread ("NXW plugin scan"), host (h), fullRescan (full), onProgress (std::move (cb)) {}

    ~ScanThread() override { stopThread (70000); }

    void run() override
    {
        // Gather the files on the message thread's copy of the format list (formats are thread-safe for searching).
        juce::StringArray files;
        juce::Array<juce::AudioPluginFormat*> formatsForFile;
        for (auto* fmt : host.formatManager.getFormats())
        {
            if (fmt->getName() != "VST3") continue;
            auto paths = fmt->getDefaultLocationsToSearch();
            for (auto& f : host.extraFolders) paths.add (juce::File (f));
            paths.removeRedundantPaths();
            for (auto& f : fmt->searchPathsForPlugins (paths, true, false))
            {
                if (! fullRescan && host.knownList.isListingUpToDate (f, *fmt)) continue;
                if (! fullRescan && host.knownList.getBlacklistedFiles().contains (f)) continue;
                files.add (f);
                formatsForFile.add (fmt);
            }
        }

        progress.running = true;
        progress.total = files.size();
        report();

        const auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
        const auto tmp = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("nxw-scan");
        tmp.createDirectory();

        for (int i = 0; i < files.size() && ! threadShouldExit(); ++i)
        {
            const auto file = files[i];
            progress.current = juce::File (file).getFileNameWithoutExtension();
            report();

            const auto out = tmp.getChildFile ("result-" + juce::String (i) + ".xml");
            out.deleteFile();
            juce::ChildProcess child;
            bool ok = false;
            if (child.start (juce::StringArray { exe.getFullPathName(), "--nxw-scan", file, out.getFullPathName() }, 0))
            {
                const bool finished = child.waitForProcessToFinish (60000);
                if (! finished) child.kill();
                if (finished && out.existsAsFile())
                {
                    if (auto xml = juce::XmlDocument::parse (out))
                    {
                        juce::Array<juce::PluginDescription> found;
                        for (auto* e : xml->getChildIterator())
                        {
                            juce::PluginDescription d;
                            if (d.loadFromXml (*e)) found.add (d);
                        }
                        ok = ! found.isEmpty();
                        juce::MessageManager::callAsync ([h = &host, found, file]
                        {
                            for (auto& d : found) h->knownList.addType (d);
                            h->knownList.removeFromBlacklist (file);
                        });
                        progress.found += found.size();
                    }
                }
            }
            if (! ok)
            {
                progress.failed.add (juce::File (file).getFileName());
                juce::MessageManager::callAsync ([h = &host, file] { h->knownList.addToBlacklist (file); });
            }
            out.deleteFile();
            progress.done = i + 1;
            report();
        }
        progress.running = false;
        progress.current.clear();
        juce::MessageManager::callAsync ([h = &host, cb = onProgress, copy = progress]
        {
            h->saveList();
            if (cb) cb (copy);
        });
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
