#include "Engine.h"
#include <set>

namespace nxw
{
static constexpr juce::uint64 kPreviewHash = 0xFFFFFFFFFFFFFFF1ull;

Engine::Engine (SampleBank& b) : bank (b)
{
    cmdIn.reserve (2048);
    cmdWork.reserve (2048);
    pending.reserve (32768);
    order.reserve (512);
    scope.assign (4096, 0.0f);
    auto m = std::make_shared<Model>();
    m->mixer.resize (kNumInserts + 1);
    Model::buildMixGraph (*m);
    model = m;
    mixOrder.reserve (kNumInserts + 1);
    mixOrder = m->mixOrder;
    for (auto& ins : inserts) { ins.ll.init (1); ins.rr.init (1); ins.mute.init (1); }
    prepareAll (48000, 512);
}

Engine::~Engine()
{
    const juce::ScopedLock sl (lock);
    order.clear();
    for (auto& [h, cs] : pool) destroyLater (std::move (cs));
    pool.clear();
    for (auto& ins : inserts)
        for (auto& fx : ins.fx) destroyLater (std::move (fx));
    if (previewCh) destroyLater (std::move (previewCh));
    flushGraveyard();
}

//==============================================================================
// Setup
//==============================================================================
void Engine::prepareAll (double sr, int block)
{
    const juce::ScopedLock sl (lock);
    sampleRate = sr > 0 ? sr : 48000.0;
    maxBlock = juce::jlimit (32, 8192, block > 0 ? block : 512);
    chBuf.setSize (2, maxBlock);
    busBuf.setSize (2 * (kNumInserts + 1), maxBlock);
    masterBuf.setSize (2, maxBlock);
    limiter.prepare (sampleRate);
    limiter.setParams (-1.5, 0, 20, 0.002, 0.12);
    masterGain.setTau (0.02, sampleRate);
    masterGain.init (model->master * 1.1);
    metronome.prepare (sampleRate);

    auto prepCh = [this] (ChannelState& cs)
    {
        cs.inst->prepare (sampleRate, maxBlock);
        cs.gain.setTau (0.01, sampleRate);
        cs.pan.setTau (0.01, sampleRate);
    };
    for (auto& [h, cs] : pool) prepCh (*cs);
    if (previewCh) prepCh (*previewCh);

    const double sps = model->samplesPerStep (sampleRate);
    for (size_t i = 0; i < inserts.size(); ++i)
    {
        auto& ins = inserts[i];
        ins.vol.setTau (0.012, sampleRate);
        ins.pan.setTau (0.012, sampleRate);
        ins.mute.setTau (0.01, sampleRate);
        for (auto* sm : { &ins.ll, &ins.rl, &ins.lr, &ins.rr }) sm->setTau (0.012, sampleRate);
        for (auto& sm : ins.send) sm.setTau (0.012, sampleRate);
        const auto& im = model->mixer[i];
        for (size_t k = 0; k < ins.fx.size(); ++k)
        {
            ins.fx[k]->prepare (sampleRate, maxBlock);
            if (k < im.fx.size()) ins.fx[k]->setParams (im.fx[k]);
            ins.fx[k]->setStepLength (sps);
        }
    }
}

void Engine::audioDeviceAboutToStart (juce::AudioIODevice* d)
{
    prepareAll (d->getCurrentSampleRate(), d->getCurrentBufferSizeSamples());
    outputLatency = d->getOutputLatencyInSamples();
}

void Engine::audioDeviceStopped() {}

std::unique_ptr<Instrument> Engine::makeInstrument (const ChannelModel& ch, juce::String& status)
{
    switch (ch.type)
    {
        case ChType::Drum:    return std::make_unique<DrumInstrument>();
        case ChType::Synth:   return std::make_unique<SynthInstrument>();
        case ChType::Sampler: return std::make_unique<SamplerInstrument>();
        case ChType::Plugin:
        {
            if (factory.pluginInstrument)
            {
                auto c = ch;
                auto it = stash.find (ch.id);
                if (it != stash.end()) { c.plugin.state = it->second; stash.erase (it); }
                juce::String err;
                if (auto inst = factory.pluginInstrument (c, sampleRate, maxBlock, err))
                {
                    status = "loaded";
                    if (factory.pluginStatus) factory.pluginStatus (ch.id, status);
                    return inst;
                }
                status = err.isNotEmpty() ? err : "Plugin not found";
            }
            else status = "Plugins are not available in this build";
            if (factory.pluginStatus) factory.pluginStatus (ch.id, status);
            return std::make_unique<SilentInstrument>();
        }
        case ChType::Unknown: break;
    }
    return std::make_unique<SilentInstrument>();
}

std::unique_ptr<Effect> Engine::makeEffect (const FxModel& fx, juce::String& status)
{
    std::unique_ptr<Effect> e;
    if (fx.type == "plugin")
    {
        if (factory.pluginEffect)
        {
            auto f = fx;
            auto it = stash.find (fx.id);
            if (it != stash.end()) { f.plugin.state = it->second; stash.erase (it); }
            e = factory.pluginEffect (f, sampleRate, maxBlock, status);
        }
        if (factory.pluginStatus) factory.pluginStatus (fx.id, e ? juce::String ("loaded") : (status.isNotEmpty() ? status : juce::String ("Plugin not found")));
        if (e == nullptr) e = makeBuiltinEffect ("none");
        e->pluginUid = fx.plugin.uid;
        e->type = "plugin";
    }
    else e = makeBuiltinEffect (fx.type);
    e->id = fx.id;
    e->prepare (sampleRate, maxBlock);
    return e;
}

void Engine::applyChannel (ChannelState& cs, const ChannelModel& ch)
{
    cs.inst->setChannel (ch);
    cs.route = ch.mixer;
    cs.cut = ch.cut;
    cs.cutGroup = ch.cutGroup;
    cs.gain.setTarget (ch.mute ? 0.0 : dsp::volGain (ch.vol));
    cs.pan.setTarget (ch.pan);
    if (ch.type == ChType::Sampler)
        if (auto* s = dynamic_cast<SamplerInstrument*> (cs.inst.get()))
            s->setSample (cs.sample);
}

void Engine::destroyLater (std::unique_ptr<ChannelState> cs)
{
    if (cs) deadChannels.push_back (std::move (cs));
}

void Engine::destroyLater (std::unique_ptr<Effect> e)
{
    if (e) deadEffects.push_back (std::move (e));
}

void Engine::flushGraveyard()
{
    for (auto& cs : deadChannels)
        if (auto* p = cs->inst ? cs->inst->getPlugin() : nullptr)
            if (factory.pluginDestroyed) factory.pluginDestroyed (p);
    for (auto& e : deadEffects)
        if (auto* p = e->getPlugin())
            if (factory.pluginDestroyed) factory.pluginDestroyed (p);
    deadChannels.clear();
    deadEffects.clear();
}

//==============================================================================
// Project
//==============================================================================
void Engine::setProject (const juce::var& project)
{
    lastProject = project;
    auto m = Model::fromJson (project);

    // ---- channels: reuse instruments whose identity is unchanged
    std::vector<ChannelState*> newOrder;
    newOrder.reserve (juce::jmax ((size_t) 512, m->channels.size()));
    std::vector<std::unique_ptr<ChannelState>> created;
    std::set<juce::uint64> keep;

    for (auto& ch : m->channels)
    {
        auto it = pool.find (ch.hash);
        ChannelState* cs = it != pool.end() ? it->second.get() : nullptr;
        const auto sig = ch.signature();
        if (cs == nullptr || cs->signature != sig)
        {
            auto ncs = std::make_unique<ChannelState>();
            ncs->id = ch.id;
            ncs->hash = ch.hash;
            ncs->signature = sig;
            ncs->inst = makeInstrument (ch, ncs->status);
            ncs->inst->prepare (sampleRate, maxBlock);
            ncs->gain.setTau (0.01, sampleRate);
            ncs->gain.init (ch.mute ? 0.0 : dsp::volGain (ch.vol));
            ncs->pan.setTau (0.01, sampleRate);
            ncs->pan.init (ch.pan);
            cs = ncs.get();
            created.push_back (std::move (ncs));
        }
        if (ch.type == ChType::Sampler)
        {
            auto s = ch.sampleId.isNotEmpty() ? bank.get (ch.sampleId) : nullptr;
            if (s == nullptr && ch.sampleId.isNotEmpty() && factory.sampleNeeded) factory.sampleNeeded (ch.sampleId);
            if (s != nullptr && ch.sampler.rev) bank.ensureReversed (*s);
            cs->sample = s;
        }
        newOrder.push_back (cs);
        keep.insert (ch.hash);
    }

    // ---- inserts: reuse effects by id + type
    struct Plan { std::vector<int> reuse; std::vector<std::unique_ptr<Effect>> fresh; };
    std::array<Plan, kNumInserts + 1> plans;
    for (size_t i = 0; i <= (size_t) kNumInserts; ++i)
    {
        const auto& cur = inserts[i].fx;
        for (auto& f : m->mixer[i].fx)
        {
            int found = -1;
            for (size_t k = 0; k < cur.size(); ++k)
                if (cur[k]->id == f.id && (cur[k]->type == f.type || (f.type == "plugin" && cur[k]->type == "plugin"))
                    && (f.type != "plugin" || cur[k]->pluginUid == f.plugin.uid))
                { found = (int) k; break; }
            plans[i].reuse.push_back (found);
            if (found < 0)
            {
                juce::String st;
                plans[i].fresh.push_back (makeEffect (f, st));
                // First parameters outside the lock: a reverb builds its impulse here.
                plans[i].fresh.back()->setParams (f);
                plans[i].fresh.back()->setStepLength (m->samplesPerStep (sampleRate));
            }
            else plans[i].fresh.push_back (nullptr);
        }
    }

    // ---- states of plugins that are going away (so undo can bring them back)
    for (auto& [h, cs] : pool)
        if (! keep.count (h) && cs->inst)
            if (cs->inst->getPlugin() != nullptr)
                stash[cs->id] = currentPluginState (cs->id);

    {
        const juce::ScopedLock sl (lock);
        model = m;
        order.swap (newOrder);
        for (auto& cs : created)
        {
            auto& slot = pool[cs->hash];
            if (slot) destroyLater (std::move (slot));
            slot = std::move (cs);
        }
        for (auto it = pool.begin(); it != pool.end();)
        {
            if (! keep.count (it->first)) { destroyLater (std::move (it->second)); it = pool.erase (it); }
            else ++it;
        }
        for (size_t c = 0; c < order.size(); ++c)
            applyChannel (*order[c], m->channels[c]);

        const double sps = m->samplesPerStep (sampleRate);
        for (size_t i = 0; i <= (size_t) kNumInserts; ++i)
        {
            auto& ins = inserts[i];
            const auto& im = m->mixer[i];
            std::vector<std::unique_ptr<Effect>> next;
            next.reserve (im.fx.size());
            for (size_t k = 0; k < im.fx.size(); ++k)
            {
                const int r = plans[i].reuse[k];
                if (r >= 0 && ins.fx[(size_t) r]) next.push_back (std::move (ins.fx[(size_t) r]));
                else if (plans[i].fresh[k]) next.push_back (std::move (plans[i].fresh[k]));
                else { juce::String st; next.push_back (makeEffect (im.fx[k], st)); }   // duplicate ids
                next.back()->setParams (im.fx[k]);
                next.back()->setStepLength (sps);
            }
            for (auto& old : ins.fx) destroyLater (std::move (old));
            ins.fx.swap (next);
            ins.on.assign (im.fx.size(), true);
            for (size_t k = 0; k < im.fx.size(); ++k) ins.on[k] = im.fx[k].on;
            ins.vol.setTarget (dsp::faderGain (im.vol));
            ins.pan.setTarget (im.pan);
            ins.mute.setTarget (im.active ? 1.0 : 0.0);
            ins.fxOff = im.fxOff;
            double ll, rl, lr, rr;
            im.stereoMatrix (ll, rl, lr, rr);
            ins.ll.setTarget (ll); ins.rl.setTarget (rl); ins.lr.setTarget (lr); ins.rr.setTarget (rr);
            ins.route = im.route;
            std::array<bool, kNumInserts + 1> nowOn {};
            for (auto& sd : im.sends)
            {
                const auto t = (size_t) sd.to;
                nowOn[t] = true;
                if (! ins.sendOn[t]) ins.send[t].init (dsp::faderGain (sd.level));   // a new send starts at its level
                ins.send[t].setTarget (dsp::faderGain (sd.level));
            }
            ins.sendOn = nowOn;
        }
        mixOrder = m->mixOrder;
        masterGain.setTarget (m->master * 1.1);
        selectedChannel = m->selectedChannel;
    }
    flushGraveyard();
}

void Engine::sampleArrived (const juce::String&)
{
    if (! lastProject.isVoid()) setProject (lastProject);
}

//==============================================================================
// Commands
//==============================================================================
void Engine::post (const Command& c)
{
    const juce::SpinLock::ScopedLockType sl (cmdLock);
    if (cmdIn.size() < cmdIn.capacity()) cmdIn.push_back (c);
}

void Engine::play (bool pat, double pos)               { post ({ Cmd::Play, 0, 0, 0, pos, pat }); }
void Engine::stop()                                    { post ({ Cmd::Stop, 0, 0, 0, 0, false }); }
void Engine::setSongPosition (double s)                { post ({ Cmd::SetPos, 0, 0, 0, s, false }); }
void Engine::setPatternMode (bool pat, double pos)     { post ({ Cmd::SetMode, 0, 0, 0, pos, pat }); }
void Engine::liveNoteOn (juce::uint64 ch, int k, float v) { post ({ Cmd::NoteOn, ch, k, v, -1, false }); }
void Engine::liveNoteOff (juce::uint64 ch, int k)      { post ({ Cmd::NoteOff, ch, k, 0, 0, false }); }
void Engine::allLiveNotesOff()                         { post ({ Cmd::AllOff, 0, 0, 0, 0, false }); }

void Engine::preview (const juce::var& channelJson, int key, double seconds)
{
    auto ch = Model::channelFromJson (channelJson);
    ch.hash = kPreviewHash;
    std::shared_ptr<SampleData> sample;
    if (ch.type == ChType::Sampler)
    {
        sample = bank.get (ch.sampleId);
        if (sample == nullptr) return;
        if (ch.sampler.rev) bank.ensureReversed (*sample);
    }

    // The same sound previewed again (a chord, an arpeggio) keeps its instrument so earlier notes ring on.
    const auto json = juce::JSON::toString (channelJson, true);
    if (previewCh == nullptr || json != previewJson)
    {
        auto cs = std::make_unique<ChannelState>();
        cs->hash = kPreviewHash;
        cs->signature = ch.signature();
        juce::String st;
        cs->inst = makeInstrument (ch, st);
        cs->inst->prepare (sampleRate, maxBlock);
        cs->sample = sample;
        applyChannel (*cs, ch);
        cs->gain.init (1); cs->pan.init (0);
        {
            const juce::ScopedLock sl (lock);
            std::swap (previewCh, cs);
        }
        previewJson = json;
        destroyLater (std::move (cs));
        flushGraveyard();
    }
    post ({ Cmd::PreviewOn, kPreviewHash, key, 0.8f, seconds, false });
}

void Engine::stopPreview()
{
    std::unique_ptr<ChannelState> old;
    {
        const juce::ScopedLock sl (lock);
        std::swap (previewCh, old);
    }
    previewJson = {};
    destroyLater (std::move (old));
    flushGraveyard();
}

void Engine::handleIncomingMidiMessage (juce::MidiInput*, const juce::MidiMessage& m)
{
    const auto ch = selectedChannel.load();
    if (ch == 0) return;
    if (m.isNoteOn() || m.isNoteOff())
    {
        const juce::SpinLock::ScopedLockType sl (midiLock);
        if (midiLog.size() < 512)
            midiLog.push_back ({ m.getNoteNumber(), m.isNoteOn() ? m.getFloatVelocity() : 0.0f, juce::Time::getMillisecondCounterHiRes() });
    }
    if (m.isNoteOn()) post ({ Cmd::NoteOn, ch, m.getNoteNumber(), m.getFloatVelocity(), -1, false });
    else if (m.isNoteOff()) post ({ Cmd::NoteOff, ch, m.getNoteNumber(), 0, 0, false });
    else if (m.isAllNotesOff() || m.isAllSoundOff()) post ({ Cmd::AllOff, 0, 0, 0, 0, false });
}

void Engine::drainCommands()
{
    {
        const juce::SpinLock::ScopedTryLockType sl (cmdLock);
        if (! sl.isLocked() || cmdIn.empty()) return;
        cmdWork.swap (cmdIn);
    }
    for (auto& c : cmdWork)
    {
        switch (c.type)
        {
            case Cmd::Play:   startTransport (c.flag, c.value); break;
            case Cmd::Stop:   stopTransportNow(); break;
            case Cmd::SetPos:
                songPos = c.value;
                if (playing && ! patMode)
                {
                    pending.clear();
                    nextStep = (int) c.value;
                    nextStepTime = (double) clock;
                }
                break;
            case Cmd::SetMode:
                if (playing)
                {
                    pending.clear();
                    for (auto& ins : inserts) for (auto& fx : ins.fx) fx->halt (clock);
                    patMode = c.flag;
                    nextStep = c.flag ? 0 : (int) c.value;
                    nextStepTime = (double) clock;
                }
                else patMode = c.flag;
                break;
            case Cmd::NoteOn:
                if (auto* cs = channelByHash (c.ch))
                    noteOnNow (cs, clock, c.key, c.vel, -1, 0);
                break;
            case Cmd::NoteOff:
                if (auto* cs = channelByHash (c.ch))
                    cs->inst->noteOff (clock, c.key, 0);
                break;
            case Cmd::AllOff:
                for (auto* cs : order) cs->inst->releaseAll (clock);
                break;
            case Cmd::PreviewOn:
                if (previewCh)
                    noteOnNow (previewCh.get(), clock, c.key, c.vel, c.value * sampleRate, nextTag++);
                break;
        }
    }
    cmdWork.clear();
}

Engine::ChannelState* Engine::channelByHash (juce::uint64 h) const
{
    if (h == kPreviewHash) return previewCh.get();
    for (auto* cs : order) if (cs->hash == h) return cs;
    return nullptr;
}

//==============================================================================
// Transport and sequencing (audio thread)
//==============================================================================
void Engine::startTransport (bool pat, double pos)
{
    if (playing) return;
    playing = true;
    patMode = pat;
    songPos = pos;
    nextStep = pat ? 0 : (int) pos;
    if (! pat && model->hasLoop && nextStep >= model->loopB) nextStep = model->loopA;
    nextStepTime = (double) clock;
    for (auto& mk : marks) mk.time = -1;
    pending.clear();
}

void Engine::stopTransportNow()
{
    if (! playing) return;
    playing = false;
    pending.clear();
    for (auto* cs : order) cs->inst->releaseAll (clock);
    for (auto& ins : inserts) for (auto& fx : ins.fx) fx->halt (clock);
}

int Engine::advanceStep (int s) const
{
    ++s;
    if (noWrap) return s;
    const auto& m = *model;
    if (patMode)
    {
        const int len = m.patterns.empty() ? 16 : m.patterns[(size_t) juce::jlimit (0, (int) m.patterns.size() - 1, m.currentPattern)].len;
        if (s >= len) s = 0;
    }
    else
    {
        if (m.hasLoop && s >= m.loopB) s = m.loopA;
        else if (! m.hasLoop && s >= m.songEnd) s = 0;
    }
    return s;
}

void Engine::scheduleSteps (juce::int64 blockEnd)
{
    while (playing && nextStepTime < (double) blockEnd)
    {
        if (stepsLeft == 0) break;
        const double sps = model->samplesPerStep (sampleRate);
        scheduleStep (nextStep, nextStepTime, sps);
        marks[markHead] = { nextStepTime, nextStep, sps, patMode };
        markHead = (markHead + 1) % 8;
        nextStepTime += sps;
        nextStep = advanceStep (nextStep);
        if (stepsLeft > 0) --stepsLeft;
    }
}

void Engine::scheduleStep (int s, double when, double sps)
{
    const auto& m = *model;
    const auto at = (juce::int64) std::llround (when);
    if (m.metronome && ! noWrap && s % 4 == 0) metronome.click (at, s % 16 == 0);

    for (auto& ins : inserts)
        for (size_t k = 0; k < ins.fx.size(); ++k)
            if (ins.on[k]) ins.fx[k]->onStep (s, at, sps);

    if (m.patterns.empty()) return;
    if (patMode)
    {
        const auto& pat = m.patterns[(size_t) juce::jlimit (0, (int) m.patterns.size() - 1, m.currentPattern)];
        schedulePattern (pat, s % pat.len, when, sps);
    }
    else
    {
        for (auto& c : m.clips)
        {
            if (s < c.start || s >= c.start + c.len) continue;
            if (c.track < (int) m.trackMute.size() && m.trackMute[(size_t) c.track]) continue;
            const auto& pat = m.patterns[(size_t) c.pattern];
            if (pat.len <= 0) continue;
            schedulePattern (pat, (((s - c.start + c.off) % pat.len) + pat.len) % pat.len, when, sps);
        }
    }
}

void Engine::schedulePattern (const PatternModel& pat, int ls, double when, double sps)
{
    const auto& m = *model;
    const size_t nch = juce::jmin (order.size(), pat.notes.size(), m.channels.size());
    for (size_t c = 0; c < nch; ++c)
    {
        if (m.channels[c].mute) continue;
        const auto& ns = pat.notes[c];
        if (ns.empty()) continue;
        auto it = std::lower_bound (ns.begin(), ns.end(), (double) ls, [] (const Note& n, double v) { return n.t < v; });
        for (; it != ns.end() && it->t < ls + 1; ++it)
        {
            const auto& n = *it;
            if (n.chance < 1.0f && dsp::sharedRandom().uniform01() >= n.chance) continue;
            double off = (n.t - ls) * sps;
            if (((int) std::floor (n.t + 1e-6)) % 2 == 1) off += m.swing * m.channels[c].swing * sps * 0.66;
            const auto h = m.channels[c].hash;
            if (n.rep <= 1)
                pushEvent ({ (juce::int64) std::llround (when + off), h, n.vel, n.len * sps, n.key, nextTag++ });
            else
            {
                const double sub = n.len / n.rep * sps;
                for (int r = 0; r < n.rep; ++r)
                    pushEvent ({ (juce::int64) std::llround (when + off + r * sub), h, n.vel * (r ? 0.9f : 1.0f), sub * 0.92, n.key, nextTag++ });
            }
        }
    }
}

void Engine::pushEvent (const Event& e)
{
    if (pending.size() >= pending.capacity()) return;
    pending.push_back (e);
    std::push_heap (pending.begin(), pending.end(), std::greater<Event>());
}

void Engine::dispatchEvents (juce::int64 blockEnd)
{
    while (! pending.empty() && pending.front().time < blockEnd)
    {
        std::pop_heap (pending.begin(), pending.end(), std::greater<Event>());
        const auto e = pending.back();
        pending.pop_back();
        if (auto* cs = channelByHash (e.ch))
            noteOnNow (cs, juce::jmax (e.time, clock), e.key, e.vel, e.dur, e.tag);
    }
}

void Engine::noteOnNow (ChannelState* cs, juce::int64 when, int key, float vel, double dur, juce::uint32 tag)
{
    if (cs->cut) cs->inst->choke (when);
    if (cs->cutGroup != 0)
        for (auto* o : order)
            if (o != cs && o->cutGroup == cs->cutGroup) o->inst->choke (when);
    cs->inst->noteOn (when, key, vel, dur, tag);
    cs->lastHit = when;
}

void Engine::resetDsp()
{
    for (auto* cs : order) { cs->inst->kill(); cs->gain.snap(); cs->pan.snap(); }
    if (previewCh) previewCh->inst->kill();
    for (auto& ins : inserts)
    {
        for (auto& fx : ins.fx) fx->reset();
        ins.vol.snap(); ins.pan.snap(); ins.mute.snap();     // a render starts at the mix's levels
        ins.ll.snap(); ins.rl.snap(); ins.lr.snap(); ins.rr.snap();
        for (auto& sg : ins.send) sg.snap();
    }
    masterGain.snap();
    limiter.reset();
    metronome.kill();
    pending.clear();
}

//==============================================================================
// Rendering (audio thread, under lock)
//==============================================================================
void Engine::processBlock (float* outL, float* outR, int n, float* const* stems)
{
    const juce::int64 blockStart = clock, blockEnd = clock + n;
    drainCommands();

    for (int c = 0; c < busBuf.getNumChannels(); ++c) juce::FloatVectorOperations::clear (busBuf.getWritePointer (c), n);
    if (playing) scheduleSteps (blockEnd);
    dispatchEvents (blockEnd);

    float* chL = chBuf.getWritePointer (0);
    float* chR = chBuf.getWritePointer (1);
    int voices = 0;

    auto renderChannel = [&] (ChannelState& cs, bool direct)
    {
        juce::FloatVectorOperations::clear (chL, n);
        juce::FloatVectorOperations::clear (chR, n);
        const bool stereo = cs.inst->render (chL, chR, blockStart, n);
        voices += cs.inst->activeVoices();
        const int route = direct ? 0 : juce::jlimit (0, kNumInserts, cs.route);
        float* bL = busBuf.getWritePointer (route * 2);
        float* bR = busBuf.getWritePointer (route * 2 + 1);
        if (direct)
        {
            juce::FloatVectorOperations::add (bL, chL, n);
            juce::FloatVectorOperations::add (bR, chR, n);
            return;
        }
        double lastPan = -9;
        float ll = 0, rl = 0, lr = 0, rr = 0, ml = 0, mr = 0;
        for (int i = 0; i < n; ++i)
        {
            const float g = (float) cs.gain.next();
            const double p = cs.pan.next();
            if (std::abs (p - lastPan) > 1.0e-5)
            {
                lastPan = p;
                dsp::PanLaw::stereoGains (p, ll, rl, lr, rr);
                dsp::PanLaw::mono (1.0f, p, ml, mr);
            }
            if (stereo)
            {
                bL[i] += (chL[i] * ll + chR[i] * rl) * g;
                bR[i] += (chL[i] * lr + chR[i] * rr) * g;
            }
            else
            {
                bL[i] += chL[i] * ml * g;
                bR[i] += chL[i] * mr * g;
            }
        }
    };

    for (auto* cs : order) renderChannel (*cs, false);
    if (previewCh) renderChannel (*previewCh, true);

    float* mL = busBuf.getWritePointer (0);
    float* mR = busBuf.getWritePointer (1);

    auto runInsert = [&] (int i, float* L, float* R)
    {
        auto& ins = inserts[(size_t) i];
        if (! ins.fxOff)
            for (size_t k = 0; k < ins.fx.size(); ++k)
                if (ins.on[k]) ins.fx[k]->process (L, R, n, blockStart);

        double lastPan = -9;
        float ll = 1, rl = 0, lr = 0, rr = 1;
        float pkL = 0, pkR = 0;
        for (int s = 0; s < n; ++s)
        {
            // stereo tool (polarity, separation, swap), then pan and fader
            const float sl = L[s], sr = R[s];
            const float xl = (float) (sl * ins.ll.next() + sr * ins.rl.next());
            const float xr = (float) (sl * ins.lr.next() + sr * ins.rr.next());
            const double p = ins.pan.next();
            if (std::abs (p - lastPan) > 1.0e-5) { lastPan = p; dsp::PanLaw::stereoGains (p, ll, rl, lr, rr); }
            const float g = (float) (ins.vol.next() * ins.mute.next());
            const float l = (xl * ll + xr * rl) * g;
            const float r = (xl * lr + xr * rr) * g;
            L[s] = l; R[s] = r;
            pkL = juce::jmax (pkL, std::abs (l));
            pkR = juce::jmax (pkR, std::abs (r));
        }
        float cur = ins.peakL.load();
        while (pkL > cur && ! ins.peakL.compare_exchange_weak (cur, pkL)) {}
        cur = ins.peakR.load();
        while (pkR > cur && ! ins.peakR.compare_exchange_weak (cur, pkR)) {}
    };

    // Inserts in routing order: each one is finished before the inserts it feeds.
    for (int i : mixOrder)
    {
        float* L = busBuf.getWritePointer (i * 2);
        float* R = busBuf.getWritePointer (i * 2 + 1);
        runInsert (i, L, R);
        if (stems != nullptr)
        {
            juce::FloatVectorOperations::copy (stems[(i - 1) * 2], L, n);
            juce::FloatVectorOperations::copy (stems[(i - 1) * 2 + 1], R, n);
        }
        auto& ins = inserts[(size_t) i];
        const int r = juce::jlimit (0, kNumInserts, ins.route);
        juce::FloatVectorOperations::add (busBuf.getWritePointer (r * 2), L, n);
        juce::FloatVectorOperations::add (busBuf.getWritePointer (r * 2 + 1), R, n);
        for (int t = 0; t <= kNumInserts; ++t)
        {
            if (! ins.sendOn[(size_t) t]) continue;
            float* tL = busBuf.getWritePointer (t * 2);
            float* tR = busBuf.getWritePointer (t * 2 + 1);
            auto& sg = ins.send[(size_t) t];
            for (int s = 0; s < n; ++s)
            {
                const float g = (float) sg.next();
                tL[s] += L[s] * g;
                tR[s] += R[s] * g;
            }
        }
    }

    runInsert (0, mL, mR);
    limiter.process (mL, mR, n);
    metronome.render (mL, mR, blockStart, n);

    int sw = scopeWrite.load();
    const int scopeSize = (int) scope.size();
    for (int i = 0; i < n; ++i)
    {
        const float g = (float) masterGain.next();
        const float l = dsp::softClip (mL[i] * g), r = dsp::softClip (mR[i] * g);
        outL[i] = l; outR[i] = r;
        scope[(size_t) sw] = 0.5f * (l + r);
        if (++sw >= scopeSize) sw = 0;
    }
    scopeWrite = sw;

    clock = blockEnd;

    const juce::SpinLock::ScopedTryLockType sl (statusLock);
    if (sl.isLocked())
    {
        shared.playing = playing;
        shared.patMode = patMode;
        shared.clock = clock;
        shared.voices = voices;
        shared.bpm = model->bpm;
        std::copy (std::begin (marks), std::end (marks), std::begin (shared.marks));
        shared.markHead = markHead;
    }
}

void Engine::audioDeviceIOCallbackWithContext (const float* const*, int, float* const* outputs, int numOut,
                                               int numSamples, const juce::AudioIODeviceCallbackContext&)
{
    juce::ScopedNoDenormals noDenormals;
    if (numOut <= 0) return;

    if (exporting.load())
    {
        for (int c = 0; c < numOut; ++c) if (outputs[c]) juce::FloatVectorOperations::clear (outputs[c], numSamples);
        return;
    }

    const juce::ScopedLock sl (lock);
    float* L = outputs[0];
    float* R = numOut > 1 ? outputs[1] : nullptr;
    for (int off = 0; off < numSamples; off += maxBlock)
    {
        const int len = juce::jmin (maxBlock, numSamples - off);
        if (R != nullptr) processBlock (L + off, R + off, len, nullptr);
        else
        {
            float* tmp = masterBuf.getWritePointer (1);
            processBlock (L + off, tmp, len, nullptr);
            for (int i = 0; i < len; ++i) L[off + i] = 0.5f * (L[off + i] + tmp[i]);
        }
    }
    for (int c = 2; c < numOut; ++c) if (outputs[c]) juce::FloatVectorOperations::clear (outputs[c], numSamples);
}

//==============================================================================
// Status
//==============================================================================
Engine::Status Engine::readStatus()
{
    Status st;
    Shared sh;
    {
        const juce::SpinLock::ScopedLockType sl (statusLock);
        sh = shared;
    }
    st.playing = sh.playing;
    st.patMode = sh.patMode;
    st.sampleRate = sampleRate;
    st.voices = sh.voices;
    st.cpu = cpuSource ? cpuSource() : 0.0;

    const double hear = (double) sh.clock - outputLatency.load() - 0.5 * maxBlock;
    const StepMark* best = nullptr;
    for (auto& mk : sh.marks)
        if (mk.time >= 0 && mk.time <= hear && (best == nullptr || mk.time > best->time)) best = &mk;
    if (sh.playing && best != nullptr)
    {
        st.position = best->step + juce::jlimit (0.0, 0.999, (hear - best->time) / best->sps);
        st.patMode = best->pat;
    }
    else st.position = sh.playing ? (sh.patMode ? 0 : songPos) : songPos;

    for (int i = 0; i <= kNumInserts; ++i)
    {
        auto& ins = inserts[(size_t) i];
        st.meters[i][0] = ins.peakL.exchange (0.0f);
        st.meters[i][1] = ins.peakR.exchange (0.0f);
        double red = 0;
        for (auto& fx : ins.fx) red = juce::jmin (red, fx->reductionDb());
        st.reduction[i] = (float) red;
    }

    {
        std::vector<MidiNote> notes;
        {
            const juce::SpinLock::ScopedLockType sl (midiLock);
            notes.swap (midiLog);
        }
        const double now = juce::Time::getMillisecondCounterHiRes();
        for (auto& mn : notes)
            st.midi.add (juce::Array<juce::var> { mn.key, std::round (mn.vel * 1000.0) / 1000.0, juce::jmax (0.0, std::round (now - mn.ms)) });
    }

    const double window = 0.12 * sampleRate;
    for (auto& [h, cs] : pool)
    {
        const auto t = (double) cs->lastHit.load();
        if (t >= 0 && t <= hear + 64 && hear - t < window) st.hits.add (cs->id);
    }
    return st;
}

void Engine::scopeSnapshot (float* dest, int num)
{
    const int size = (int) scope.size();
    num = juce::jmin (num, size);
    int r = scopeWrite.load() - num;
    while (r < 0) r += size;
    for (int i = 0; i < num; ++i)
    {
        dest[i] = scope[(size_t) r];
        if (++r >= size) r = 0;
    }
}

juce::Optional<juce::AudioPlayHead::PositionInfo> Engine::getPosition() const
{
    PositionInfo info;
    const double bpm = model->bpm;
    info.setBpm (bpm);
    info.setTimeSignature (TimeSignature { 4, 4 });
    info.setIsPlaying (playing);
    info.setIsRecording (false);
    info.setTimeInSamples (clock);
    info.setTimeInSeconds ((double) clock / sampleRate);

    double steps = 0;
    const StepMark* best = nullptr;
    for (auto& mk : marks)
        if (mk.time >= 0 && mk.time <= (double) clock && (best == nullptr || mk.time > best->time)) best = &mk;
    if (playing && best != nullptr) steps = best->step + ((double) clock - best->time) / best->sps;
    else if (! playing) steps = songPos;
    const double ppq = steps / 4.0;
    info.setPpqPosition (ppq);
    info.setPpqPositionOfLastBarStart (std::floor (ppq / 4.0) * 4.0);
    if (! patMode && model->hasLoop)
    {
        info.setIsLooping (true);
        info.setLoopPoints (LoopPoints { model->loopA / 4.0, model->loopB / 4.0 });
    }
    return info;
}

//==============================================================================
// Plugins (message thread)
//==============================================================================
juce::AudioPluginInstance* Engine::findPlugin (const juce::String& ownerId)
{
    for (auto& [h, cs] : pool)
        if (cs->id == ownerId && cs->inst) return cs->inst->getPlugin();
    for (auto& ins : inserts)
        for (auto& fx : ins.fx)
            if (fx->id == ownerId) return fx->getPlugin();
    return nullptr;
}

std::vector<std::pair<juce::String, juce::AudioPluginInstance*>> Engine::allPlugins()
{
    std::vector<std::pair<juce::String, juce::AudioPluginInstance*>> out;
    for (auto& [h, cs] : pool)
        if (auto* p = cs->inst ? cs->inst->getPlugin() : nullptr) out.push_back ({ cs->id, p });
    for (auto& ins : inserts)
        for (auto& fx : ins.fx)
            if (auto* p = fx->getPlugin()) out.push_back ({ fx->id, p });
    return out;
}

void Engine::stashPluginState (const juce::String& ownerId, const juce::String& state)
{
    if (ownerId.isNotEmpty() && state.isNotEmpty()) stash[ownerId] = state;
}

juce::String Engine::currentPluginState (const juce::String& ownerId)
{
    if (auto* p = findPlugin (ownerId))
    {
        juce::MemoryBlock mb;
        p->getStateInformation (mb);
        return toBase64 (mb);
    }
    auto it = stash.find (ownerId);
    return it != stash.end() ? it->second : juce::String();
}

bool Engine::pluginStateChanged()
{
    bool any = false;
    for (auto& [h, cs] : pool)
        if (cs->inst && cs->inst->consumeStateChanged()) any = true;
    for (auto& ins : inserts)
        for (auto& fx : ins.fx)
            if (fx->consumeStateChanged()) any = true;
    return any;
}

void Engine::setPluginsNonRealtime (bool b)
{
    for (auto& [id, p] : allPlugins()) p->setNonRealtime (b);
}

//==============================================================================
// Offline export
//==============================================================================
bool Engine::renderOffline (const RenderRequest& req, juce::AudioBuffer<float>& master,
                            std::vector<juce::AudioBuffer<float>>& stems, const std::function<bool (double)>& progress)
{
    double sps = 0;
    {
        const juce::ScopedLock sl (lock);
        resetDsp();
        clock = 0;
        playing = false;
        noWrap = true;
        startTransport (req.patternMode, req.fromStep);
        nextStep = req.fromStep;
        stepsLeft = req.steps;
        sps = model->samplesPerStep (sampleRate);
    }

    // The master limiter looks 6 ms ahead; render that much longer and drop it from the
    // front of the master so the file starts on the beat and lines up with its stems.
    const auto length = (juce::int64) std::ceil (req.steps * sps + (req.tail ? 2.5 : 0.08) * sampleRate);
    const int lead = limiter.latency();
    const auto total = length + lead;
    master.setSize (2, (int) total);
    master.clear();
    stems.clear();
    std::vector<float*> stemPtrs;
    if (req.stems)
    {
        stems.resize (kNumInserts);
        for (auto& s : stems) { s.setSize (2, (int) total); s.clear(); }
        stemPtrs.resize (2 * kNumInserts);
    }

    bool ok = true;
    for (juce::int64 pos = 0; pos < total; pos += maxBlock)
    {
        const int len = (int) juce::jmin ((juce::int64) maxBlock, total - pos);
        if (req.stems)
            for (int i = 0; i < kNumInserts; ++i)
            {
                stemPtrs[(size_t) i * 2] = stems[(size_t) i].getWritePointer (0, (int) pos);
                stemPtrs[(size_t) i * 2 + 1] = stems[(size_t) i].getWritePointer (1, (int) pos);
            }
        {
            const juce::ScopedLock sl (lock);
            juce::ScopedNoDenormals nd;
            processBlock (master.getWritePointer (0, (int) pos), master.getWritePointer (1, (int) pos), len,
                          req.stems ? stemPtrs.data() : nullptr);
        }
        if (progress && ! progress ((double) (pos + len) / (double) total)) { ok = false; break; }
    }

    {
        const juce::ScopedLock sl (lock);
        playing = false;
        noWrap = false;
        stepsLeft = -1;
        resetDsp();
    }

    if (lead > 0)
    {
        juce::AudioBuffer<float> trimmed (2, (int) length);
        for (int ch = 0; ch < 2; ++ch) trimmed.copyFrom (ch, 0, master, ch, lead, (int) length);
        master = std::move (trimmed);
        for (auto& s : stems) s.setSize (2, (int) length, true);
    }
    return ok;
}

} // namespace nxw
