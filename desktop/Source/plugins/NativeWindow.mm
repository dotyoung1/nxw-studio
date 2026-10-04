/*
    NXW Studio · plugin windows stay above the studio window (macOS).
    They float above the app's other windows while NXW Studio is active, like the plugin
    windows in other music apps, and step back when you switch to another app.
*/
#include "PluginHost.h"
#import <AppKit/AppKit.h>

namespace nxw
{
void setOwnerWindow (juce::Component& window, juce::Component*)
{
    if (auto* view = static_cast<NSView*> (window.getWindowHandle()))
        if (NSWindow* w = [view window])
        {
            [w setLevel: NSFloatingWindowLevel];
            [w setHidesOnDeactivate: YES];
        }
}
} // namespace nxw
