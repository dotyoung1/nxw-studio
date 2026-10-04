/*
    NXW Studio · plugin windows stay above the studio window.

    Windows: the plugin window becomes an "owned" window of the studio window, so it floats
    above it, hides when the studio is minimised and has no taskbar button of its own, yet can
    be moved anywhere (including another monitor) and resized like any other window.
*/
#include "PluginHost.h"

#if JUCE_WINDOWS
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <windows.h>
#endif

namespace nxw
{
#if ! JUCE_MAC
void setOwnerWindow (juce::Component& window, juce::Component* owner)
{
   #if JUCE_WINDOWS
    auto* child = static_cast<HWND> (window.getWindowHandle());
    auto* parent = owner != nullptr ? static_cast<HWND> (owner->getWindowHandle()) : nullptr;
    if (child != nullptr && parent != nullptr)
        SetWindowLongPtrW (child, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR> (parent));
   #else
    juce::ignoreUnused (window, owner);
   #endif
}
#endif
} // namespace nxw
