/*
    NXW Studio · long-lived services shared by the window and the bridge.
*/
#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include "../engine/Engine.h"
#include "../engine/SampleBank.h"
#include "../plugins/PluginHost.h"
#include "AppPaths.h"

namespace nxw
{
struct Services
{
    Services()
        : bank (paths::samples()),
          host (paths::data()),
          engine (bank)
    {
        juce::PropertiesFile::Options o;
        o.applicationName = "NXW Studio";
        o.filenameSuffix = ".settings";
        o.folderName = "NXW Studio";
        o.osxLibrarySubFolder = "Application Support";
        settings.setStorageParameters (o);

        engine.setFactory ({
            [this] (const ChannelModel& ch, double sr, int bs, juce::String& err) { return host.makeInstrument (ch, sr, bs, &engine, err); },
            [this] (const FxModel& fx, double sr, int bs, juce::String& err) { return host.makeEffect (fx, sr, bs, &engine, err); },
            [this] (const juce::String& id) { if (onSampleNeeded) onSampleNeeded (id); },
            [this] (const juce::String& owner, const juce::String& st) { if (onPluginStatus) onPluginStatus (owner, st); },
            [this] (juce::AudioProcessor* p) { host.closeEditorFor (p); }
        });
        engine.setCpuSource ([this] { return devices.getCpuUsage(); });
    }

    ~Services()
    {
        closeAudio();
        host.closeAllEditors();
    }

    /** Opens the audio device the user picked last time (or the system default). */
    juce::String openAudio()
    {
        auto* props = settings.getUserSettings();
        std::unique_ptr<juce::XmlElement> saved (props->getXmlValue ("audioDevice"));
        const auto err = devices.initialise (0, 2, saved.get(), true, {}, nullptr);
        if (err.isNotEmpty()) juce::Logger::writeToLog ("Audio device: " + err);
        devices.addAudioCallback (&engine);
        for (auto& m : juce::MidiInput::getAvailableDevices())
            if (props->getBoolValue ("midiIn:" + m.identifier, false))
                devices.setMidiInputDeviceEnabled (m.identifier, true);
        devices.addMidiInputDeviceCallback ({}, &engine);
        return err;
    }

    void saveAudioSettings()
    {
        auto* props = settings.getUserSettings();
        if (auto xml = devices.createStateXml()) props->setValue ("audioDevice", xml.get());
        for (auto& m : juce::MidiInput::getAvailableDevices())
            props->setValue ("midiIn:" + m.identifier, devices.isMidiInputDeviceEnabled (m.identifier));
        props->saveIfNeeded();
    }

    void closeAudio()
    {
        devices.removeMidiInputDeviceCallback ({}, &engine);
        devices.removeAudioCallback (&engine);
        devices.closeAudioDevice();
    }

    juce::ApplicationProperties settings;
    juce::AudioDeviceManager devices;
    SampleBank bank;
    PluginHost host;
    Engine engine;

    std::function<void (const juce::String&)> onSampleNeeded;
    std::function<void (const juce::String&, const juce::String&)> onPluginStatus;
};
} // namespace nxw
