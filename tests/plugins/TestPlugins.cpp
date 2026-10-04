// Minimal plugins for testing the host. Built twice: NXW_TEST_SYNTH=1 (instrument) or 0 (effect).
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>

class TestPlugin : public juce::AudioProcessor
{
public:
    TestPlugin()
        : AudioProcessor (BusesProperties()
                             #if ! NXW_TEST_SYNTH
                              .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                             #endif
                              .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
          state (*this, nullptr, "STATE",
                 { std::make_unique<juce::AudioParameterFloat> (juce::ParameterID { NXW_TEST_SYNTH ? "level" : "gain", 1 },
                                                                NXW_TEST_SYNTH ? "Level" : "Gain",
                                                                juce::NormalisableRange<float> (0.0f, NXW_TEST_SYNTH ? 1.0f : 2.0f),
                                                                1.0f) })
    {
        param = state.getRawParameterValue (NXW_TEST_SYNTH ? "level" : "gain");
    }

    const juce::String getName() const override { return NXW_TEST_SYNTH ? "NXW Test Synth" : "NXW Test Gain"; }
    bool acceptsMidi() const override { return NXW_TEST_SYNTH; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor (*this); }

    bool isBusesLayoutSupported (const BusesLayout& l) const override
    {
        return l.getMainOutputChannelSet() == juce::AudioChannelSet::stereo()
            && (NXW_TEST_SYNTH || l.getMainInputChannelSet() == juce::AudioChannelSet::stereo());
    }

    void prepareToPlay (double sampleRate, int) override { sr = sampleRate; for (auto& v : voices) v = {}; }
    void releaseResources() override {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        const float p = param->load();
       #if NXW_TEST_SYNTH
        buffer.clear();
        int pos = 0;
        auto render = [&] (int end)
        {
            for (auto& v : voices)
                if (v.on || v.env > 0.0001f)
                    for (int i = pos; i < end; ++i)
                    {
                        v.env += ((v.on ? 1.0f : 0.0f) - v.env) * 0.01f;
                        const float s = (float) std::sin (v.phase) * v.vel * v.env * p * 0.5f;
                        v.phase += v.inc;
                        buffer.addSample (0, i, s);
                        buffer.addSample (1, i, s);
                    }
            pos = end;
        };
        for (const auto m : midi)
        {
            render (juce::jlimit (pos, buffer.getNumSamples(), m.samplePosition));
            const auto msg = m.getMessage();
            if (msg.isNoteOn())
            {
                auto& v = voices[(size_t) msg.getNoteNumber()];
                v.on = true; v.vel = msg.getFloatVelocity(); v.phase = 0;
                v.inc = juce::MathConstants<double>::twoPi * juce::MidiMessage::getMidiNoteInHertz (msg.getNoteNumber()) / sr;
            }
            else if (msg.isNoteOff()) voices[(size_t) msg.getNoteNumber()].on = false;
            else if (msg.isAllNotesOff() || msg.isAllSoundOff()) for (auto& v : voices) v.on = false;
        }
        render (buffer.getNumSamples());
       #else
        juce::ignoreUnused (midi);
        buffer.applyGain (p);
       #endif
    }

    void getStateInformation (juce::MemoryBlock& dest) override
    {
        if (auto xml = state.copyState().createXml()) copyXmlToBinary (*xml, dest);
    }
    void setStateInformation (const void* data, int size) override
    {
        if (auto xml = getXmlFromBinary (data, size)) state.replaceState (juce::ValueTree::fromXml (*xml));
    }

private:
    struct Voice { bool on = false; float vel = 0, env = 0; double phase = 0, inc = 0; };
    std::array<Voice, 128> voices;
    double sr = 44100;
    juce::AudioProcessorValueTreeState state;
    std::atomic<float>* param = nullptr;
};

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestPlugin(); }
