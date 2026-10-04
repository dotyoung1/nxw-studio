# Linux only: JUCE 8.0.9's VST3 host shares one event loop object between all plugins and
# deletes it when the last plugin closes. If an event from the plugin was already queued in
# that moment, it is delivered to the deleted object and the app crashes (seen when the last
# plugin is removed, e.g. by undo, while its window is open). This keeps that object alive for
# the life of the app. Windows and macOS do not use this code.
set(file "${JUCE_SOURCE_DIR}/modules/juce_audio_processors/format_types/juce_VST3PluginFormat.cpp")
file(READ "${file}" src)
if(src MATCHES "NXW_RUNLOOP_PATCH")
    return()
endif()
set(old [=[    SharedResourcePointer<Impl> impl;]=])
set(new [=[    // NXW_RUNLOOP_PATCH: one event loop for the whole app, never deleted.
    static Impl& sharedImpl() { static auto* i = new Impl(); return *i; }
    Impl* impl = &sharedImpl();]=])
string(FIND "${src}" "${old}" at)
if(at EQUAL -1)
    message(WARNING "NXW: JUCE's VST3 run loop code has changed; the run loop patch was not applied")
    return()
endif()
string(REPLACE "${old}" "${new}" src "${src}")
file(WRITE "${file}" "${src}")
message(STATUS "NXW: patched JUCE's Linux VST3 run loop lifetime")
