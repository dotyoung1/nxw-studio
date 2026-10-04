# NXW Studio · desktop application
#
#   cmake -B build -S desktop -DCMAKE_BUILD_TYPE=Release
#   cmake --build build --config Release
#
# Options
#   -DNXW_GITHUB_REPO=owner/repo        where "Check for updates" looks for releases
#   -DNXW_ASIO_SDK_DIR=path/to/asiosdk   adds ASIO drivers on Windows (Steinberg ASIO SDK, separate licence)
#   -DFETCHCONTENT_SOURCE_DIR_JUCE=path  use a local JUCE checkout instead of downloading it

cmake_minimum_required(VERSION 3.22)

file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/../VERSION" NXW_VERSION LIMIT_COUNT 1)
string(STRIP "${NXW_VERSION}" NXW_VERSION)

set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Oldest macOS the app runs on")
if(APPLE AND NOT CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "" FORCE)
endif()
if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")   # no VC++ redistributable needed
endif()

project(NXWStudio VERSION ${NXW_VERSION} LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set_property(GLOBAL PROPERTY USE_FOLDERS ON)

set(NXW_GITHUB_REPO "" CACHE STRING "GitHub owner/repo used by the update check")
set(NXW_ASIO_SDK_DIR "" CACHE PATH "Folder of the Steinberg ASIO SDK (contains common/iasiodrv.h)")

#---------------------------------------------------------------------------------------------------
# JUCE
#---------------------------------------------------------------------------------------------------
include(FetchContent)
FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.9
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(JUCE)
if(UNIX AND NOT APPLE)
    set(JUCE_SOURCE_DIR "${juce_SOURCE_DIR}")
    include("${CMAKE_CURRENT_LIST_DIR}/cmake/PatchJuceLinuxWebView.cmake")
endif()

#---------------------------------------------------------------------------------------------------
# Interface: the same HTML/JS as the web version, built for the desktop and embedded in the exe
#---------------------------------------------------------------------------------------------------
find_package(Python3 REQUIRED COMPONENTS Interpreter)
set(NXW_WEB "${CMAKE_CURRENT_LIST_DIR}/../web")
set(NXW_UI_HTML "${CMAKE_CURRENT_BINARY_DIR}/ui/index.html")
file(GLOB NXW_WEB_SOURCES CONFIGURE_DEPENDS "${NXW_WEB}/src/*")
add_custom_command(OUTPUT "${NXW_UI_HTML}"
    COMMAND "${Python3_EXECUTABLE}" "${NXW_WEB}/build.py" desktop "${NXW_UI_HTML}"
    DEPENDS ${NXW_WEB_SOURCES} "${NXW_WEB}/build.py"
    COMMENT "Building the NXW Studio interface"
    VERBATIM)

juce_add_binary_data(NXWStudioUI
    SOURCES
        "${NXW_UI_HTML}"
        "${NXW_WEB}/vendor/lame.min.js"
        "${NXW_WEB}/vendor/jszip.min.js"
        "${NXW_WEB}/fonts/archivo.woff2"
        "${NXW_WEB}/fonts/martian-mono.woff2"
        "${NXW_WEB}/fonts/unbounded-600.woff2"
        "${NXW_WEB}/fonts/unbounded-700.woff2")

#---------------------------------------------------------------------------------------------------
# The application
#---------------------------------------------------------------------------------------------------
juce_add_gui_app(NXWStudio
    PRODUCT_NAME "NXW Studio"
    COMPANY_NAME "NXW"
    BUNDLE_ID "com.nxw.studio"
    VERSION ${NXW_VERSION}
    ICON_BIG "${CMAKE_CURRENT_LIST_DIR}/Resources/icon.png"
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE
    NEEDS_CURL TRUE
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT "NXW Studio uses audio inputs for plugins that process live sound."
    DOCUMENT_EXTENSIONS json)

target_sources(NXWStudio PRIVATE
    Source/Main.cpp
    Source/app/Bridge.cpp
    Source/engine/Model.cpp
    Source/engine/SampleBank.cpp
    Source/engine/Instruments.cpp
    Source/engine/Effects.cpp
    Source/engine/Engine.cpp
    Source/plugins/PluginHost.cpp)

target_include_directories(NXWStudio PRIVATE Source)

target_compile_definitions(NXWStudio PRIVATE
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_AU=$<IF:$<BOOL:${APPLE}>,1,0>
    JUCE_PLUGINHOST_LADSPA=0
    JUCE_USE_MP3AUDIOFORMAT=1
    JUCE_USE_FLAC=1
    JUCE_USE_OGGVORBIS=1
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_REPORT_APP_USAGE=0
    JUCE_MODAL_LOOPS_PERMITTED=0
    JUCE_STRICT_REFCOUNTEDPOINTER=1
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:NXWStudio,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:NXWStudio,JUCE_VERSION>"
    NXW_VERSION="${NXW_VERSION}"
    NXW_GITHUB_REPO="${NXW_GITHUB_REPO}")

if(WIN32 AND NXW_ASIO_SDK_DIR)
    if(EXISTS "${NXW_ASIO_SDK_DIR}/common/iasiodrv.h")
        target_compile_definitions(NXWStudio PRIVATE JUCE_ASIO=1)
        target_include_directories(NXWStudio PRIVATE "${NXW_ASIO_SDK_DIR}/common")
        message(STATUS "NXW Studio: ASIO enabled (${NXW_ASIO_SDK_DIR})")
    else()
        message(WARNING "NXW_ASIO_SDK_DIR does not contain common/iasiodrv.h; building without ASIO")
    endif()
endif()

target_link_libraries(NXWStudio
    PRIVATE
        NXWStudioUI
        juce::juce_gui_extra
        juce::juce_audio_utils
        juce::juce_audio_processors
        juce::juce_audio_formats
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

if(MSVC)
    target_compile_options(NXWStudio PRIVATE /bigobj /MP /utf-8)
endif()
