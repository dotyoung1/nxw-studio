#include "Model.h"

namespace nxw
{
namespace
{
    double num (const juce::var& o, const char* key, double def)
    {
        const auto& v = o[key];
        if (v.isDouble() || v.isInt() || v.isInt64() || v.isBool()) return (double) v;
        return def;
    }
    int inum (const juce::var& o, const char* key, int def) { return (int) std::lround (num (o, key, def)); }
    bool flag (const juce::var& o, const char* key, bool def = false)
    {
        const auto& v = o[key];
        if (v.isVoid() || v.isUndefined()) return def;
        return (bool) v;
    }
    juce::String str (const juce::var& o, const char* key) { return o[key].toString(); }

    DrumKind drumKind (const juce::String& k)
    {
        if (k == "808")    return DrumKind::K808;
        if (k == "snare")  return DrumKind::Snare;
        if (k == "clap")   return DrumKind::Clap;
        if (k == "hat")    return DrumKind::Hat;
        if (k == "ohat")   return DrumKind::OHat;
        if (k == "rim")    return DrumKind::Rim;
        if (k == "tom")    return DrumKind::Tom;
        if (k == "bell")   return DrumKind::Bell;
        if (k == "shaker") return DrumKind::Shaker;
        if (k == "crash")  return DrumKind::Crash;
        return DrumKind::Kick;
    }
}

PluginRef Model::pluginFromJson (const juce::var& v)
{
    PluginRef r;
    if (! v.isObject()) return r;
    r.uid = str (v, "id");
    r.name = str (v, "name");
    r.vendor = str (v, "vendor");
    r.format = str (v, "format");
    r.state = str (v, "state");
    r.isInstrument = flag (v, "instrument");
    return r;
}

ChannelModel Model::channelFromJson (const juce::var& c)
{
    ChannelModel ch;
    ch.id = str (c, "id");
    ch.hash = hashId (ch.id);
    ch.name = str (c, "name");
    const auto type = str (c, "type");
    ch.type = type == "drum" ? ChType::Drum : type == "synth" ? ChType::Synth : type == "sampler" ? ChType::Sampler
            : type == "plugin" ? ChType::Plugin : ChType::Unknown;
    ch.vol = num (c, "vol", 0.78);
    ch.pan = num (c, "pan", 0);
    ch.mute = flag (c, "mute");
    ch.mixer = juce::jlimit (0, kNumInserts, inum (c, "mixer", 0));
    ch.root = juce::jlimit (0, 127, inum (c, "root", 60));
    ch.cut = flag (c, "cut");
    ch.cutGroup = inum (c, "cutGroup", 0);

    const auto& p = c["params"];
    switch (ch.type)
    {
        case ChType::Drum:
            ch.drum.kind = drumKind (str (p, "kind"));
            ch.drum.tune = num (p, "tune", 0);
            ch.drum.decay = num (p, "decay", 1);
            ch.drum.tone = num (p, "tone", 0.5);
            ch.drum.level = num (p, "level", 1);
            break;
        case ChType::Synth:
        {
            auto& s = ch.synth;
            s.w1 = dsp::waveFromName (p["w1"].isString() ? p["w1"].toString() : "sawtooth");
            s.w2 = dsp::waveFromName (p["w2"].isString() ? p["w2"].toString() : "square");
            s.semi2 = num (p, "semi2", 0); s.det = num (p, "det", 7); s.mix = num (p, "mix", 0.5); s.sub = num (p, "sub", 0);
            s.uni = juce::jlimit (1, 7, inum (p, "uni", 1)); s.spread = num (p, "spread", 18);
            s.cut = num (p, "cut", 3000); s.res = num (p, "res", 1); s.env = num (p, "env", 0.3);
            s.fatt = num (p, "fatt", 0.005); s.fdec = num (p, "fdec", 0.4);
            s.att = num (p, "att", 0.004); s.dec = num (p, "dec", 0.3); s.sus = num (p, "sus", 0.7);
            s.rel = num (p, "rel", 0.25); s.gain = num (p, "gain", 0.6);
            break;
        }
        case ChType::Sampler:
            ch.sampleId = str (c, "sample");
            ch.sampler.pitch = num (p, "pitch", 0);
            ch.sampler.start = num (p, "start", 0);
            ch.sampler.att = num (p, "att", 0.002);
            ch.sampler.rel = num (p, "rel", 0.12);
            ch.sampler.gain = num (p, "gain", 0.8);
            ch.sampler.rev = flag (p, "rev");
            ch.sampler.oneshot = flag (p, "oneshot", true);
            break;
        case ChType::Plugin:
            ch.plugin = pluginFromJson (c["plugin"]);
            break;
        case ChType::Unknown:
            break;
    }
    return ch;
}

std::shared_ptr<const Model> Model::fromJson (const juce::var& j)
{
    auto m = std::make_shared<Model>();
    m->bpm = juce::jlimit (20.0, 999.0, num (j, "bpm", 128));
    m->swing = juce::jlimit (0.0, 1.0, num (j, "swing", 0));
    m->master = juce::jlimit (0.0, 2.0, num (j, "master", 0.8));

    if (auto* chans = j["channels"].getArray())
        for (auto& c : *chans)
            m->channels.push_back (channelFromJson (c));

    juce::HashMap<juce::String, int> chanIndex;
    for (size_t i = 0; i < m->channels.size(); ++i) chanIndex.set (m->channels[i].id, (int) i);

    juce::HashMap<juce::String, int> patIndex;
    if (auto* pats = j["patterns"].getArray())
    {
        for (auto& pv : *pats)
        {
            PatternModel pm;
            pm.id = str (pv, "id");
            pm.len = juce::jmax (1, inum (pv, "len", 16));
            pm.notes.resize (m->channels.size());
            if (auto* obj = pv["notes"].getDynamicObject())
            {
                for (auto& prop : obj->getProperties())
                {
                    const auto ci = chanIndex.contains (prop.name.toString()) ? chanIndex[prop.name.toString()] : -1;
                    if (ci < 0) continue;
                    auto& list = pm.notes[(size_t) ci];
                    if (auto* arr = prop.value.getArray())
                    {
                        list.reserve ((size_t) arr->size());
                        for (auto& nv : *arr)
                        {
                            Note n;
                            n.t = num (nv, "t", 0);
                            n.len = juce::jmax (0.01, num (nv, "len", 1));
                            n.key = juce::jlimit (0, 127, inum (nv, "key", 60));
                            n.vel = (float) juce::jlimit (0.0, 1.0, num (nv, "vel", 0.78));
                            n.chance = (float) juce::jlimit (0.0, 1.0, num (nv, "chance", 1));
                            n.rep = juce::jlimit (1, 16, inum (nv, "rep", 1));
                            list.push_back (n);
                        }
                    }
                    std::sort (list.begin(), list.end(), [] (const Note& a, const Note& b) { return a.t < b.t; });
                }
            }
            patIndex.set (pm.id, (int) m->patterns.size());
            m->patterns.push_back (std::move (pm));
        }
    }

    const auto& pl = j["playlist"];
    int maxEnd = 0;
    if (auto* clips = pl["clips"].getArray())
    {
        for (auto& cv : *clips)
        {
            const auto pid = str (cv, "pat");
            if (! patIndex.contains (pid)) continue;
            ClipModel c;
            c.pattern = patIndex[pid];
            c.track = juce::jmax (0, inum (cv, "track", 0));
            c.start = juce::jmax (0, inum (cv, "start", 0));
            c.len = juce::jmax (1, inum (cv, "len", 16));
            maxEnd = juce::jmax (maxEnd, c.start + c.len);
            m->clips.push_back (c);
        }
    }
    m->songEnd = juce::jmax (kStepsPerBar * 4, (int) std::ceil (maxEnd / (double) kStepsPerBar) * kStepsPerBar);

    const int tracks = juce::jmax (1, inum (pl, "tracks", 16));
    m->trackMute.assign ((size_t) juce::jmax (tracks, 64), false);
    if (auto* mutes = pl["mute"].getArray())
        for (int i = 0; i < mutes->size() && i < (int) m->trackMute.size(); ++i)
            m->trackMute[(size_t) i] = (bool) (*mutes)[i];

    const auto& loop = pl["loop"];
    if (loop.isObject())
    {
        m->hasLoop = true;
        m->loopA = juce::jmax (0, inum (loop, "a", 0));
        m->loopB = juce::jmax (m->loopA + 1, inum (loop, "b", m->loopA + 16));
    }

    m->mixer.resize (kNumInserts + 1);
    if (auto* mix = j["mixer"].getArray())
    {
        for (int i = 0; i <= kNumInserts && i < mix->size(); ++i)
        {
            const auto& mv = (*mix)[i];
            auto& ins = m->mixer[(size_t) i];
            ins.vol = num (mv, "vol", 0.7906);
            ins.pan = num (mv, "pan", 0);
            ins.mute = flag (mv, "mute");
            ins.solo = flag (mv, "solo");
            if (auto* fx = mv["fx"].getArray())
            {
                for (auto& fv : *fx)
                {
                    FxModel f;
                    f.id = str (fv, "id");
                    f.type = str (fv, "type");
                    f.on = flag (fv, "on", true);
                    if (auto* po = fv["p"].getDynamicObject())
                        f.params = po->getProperties();
                    f.plugin = pluginFromJson (fv["plugin"]);
                    ins.fx.push_back (std::move (f));
                }
            }
        }
    }

    const auto& ui = j["ui"];
    if (ui.isObject())
    {
        const auto pid = str (ui, "pat");
        m->currentPattern = patIndex.contains (pid) ? patIndex[pid] : 0;
        m->patternMode = str (ui, "mode") == "pat";
        m->metronome = flag (ui, "metro");
        const auto sel = str (ui, "ch");
        m->selectedChannel = sel.isNotEmpty() ? hashId (sel) : 0;
    }
    return m;
}

} // namespace nxw
