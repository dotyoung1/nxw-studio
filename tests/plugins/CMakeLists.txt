# Two tiny VST3 plugins used to test NXW Studio's plugin hosting (CI and local):
#   NXW Test Synth  - instrument: a sine per MIDI note, "Level" parameter
#   NXW Test Gain   - effect: "Gain" parameter
cmake_minimum_required(VERSION 3.22)
project(NXWTestPlugins VERSION 1.0.0)
set(CMAKE_CXX_STANDARD 17)
include(FetchContent)
FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.9 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

foreach(kind Synth Gain)
    if(kind STREQUAL "Synth")
        set(extra IS_SYNTH TRUE NEEDS_MIDI_INPUT TRUE PLUGIN_CODE Nts1)
    else()
        set(extra IS_SYNTH FALSE NEEDS_MIDI_INPUT FALSE PLUGIN_CODE Ntg1)
    endif()
    juce_add_plugin(NXWTest${kind}
        PRODUCT_NAME "NXW Test ${kind}"
        COMPANY_NAME "NXW"
        PLUGIN_MANUFACTURER_CODE Nxwt
        FORMATS VST3
        ${extra})
    target_sources(NXWTest${kind} PRIVATE TestPlugins.cpp)
    target_compile_definitions(NXWTest${kind} PUBLIC
        NXW_TEST_SYNTH=$<IF:$<STREQUAL:${kind},Synth>,1,0>
        JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0 JUCE_DISPLAY_SPLASH_SCREEN=0)
    target_link_libraries(NXWTest${kind} PRIVATE juce::juce_audio_utils PUBLIC juce::juce_recommended_config_flags)
endforeach()
