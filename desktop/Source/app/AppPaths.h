/*
    NXW Studio · where things are kept on disk

    Windows:  %APPDATA%\NXW Studio        projects, autosave, settings, plugin list, sound cache
              %LOCALAPPDATA%\NXW Studio   logs and the WebView2 profile (interface storage)
    macOS:    ~/Library/Application Support/NXW Studio
    Linux:    ~/.config/NXW Studio
*/
#pragma once

#include <juce_core/juce_core.h>

namespace nxw::paths
{
inline juce::File data()
{
   #if JUCE_MAC
    auto f = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Application Support/NXW Studio");
   #else
    auto f = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("NXW Studio");
   #endif
    f.createDirectory();
    return f;
}

inline juce::File local()
{
   #if JUCE_WINDOWS
    auto f = juce::File::getSpecialLocation (juce::File::windowsLocalAppData).getChildFile ("NXW Studio");
    f.createDirectory();
    return f;
   #else
    return data();
   #endif
}

inline juce::File sub (const juce::File& base, const char* name)
{
    auto f = base.getChildFile (name);
    f.createDirectory();
    return f;
}

inline juce::File logs()      { return sub (local(), "Logs"); }
inline juce::File webview()   { return sub (local(), "WebView"); }
inline juce::File samples()   { return sub (data(), "Sound Cache"); }
inline juce::File autosave()  { return sub (data(), "Autosave"); }
inline juce::File projects()
{
    auto f = juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile ("NXW Studio");
    f.createDirectory();
    return f;
}
} // namespace nxw::paths
