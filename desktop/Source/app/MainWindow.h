/*
    NXW Studio · the main window: a web view showing the interface, wired to the bridge.
*/
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "Bridge.h"

namespace nxw
{
/** Keeps the web view on the bundled interface; other links open in the user's browser. */
class InterfaceView : public juce::WebBrowserComponent
{
public:
    using WebBrowserComponent::WebBrowserComponent;

    bool pageAboutToLoad (const juce::String& url) override
    {
        const auto& root = getResourceProviderRoot();
        if (url.startsWith (root) || url.startsWith ("about:") || url.startsWith ("data:") || url.startsWith ("blob:")) return true;
        if (url.startsWith ("http://") || url.startsWith ("https://") || url.startsWith ("mailto:"))
        {
            juce::URL (url).launchInDefaultBrowser();
            return false;
        }
        return true;
    }

    void newWindowAttemptingToLoad (const juce::String& url) override
    {
        if (url.startsWith ("http")) juce::URL (url).launchInDefaultBrowser();
    }

    bool pageLoadHadNetworkError (const juce::String& error) override
    {
        juce::Logger::writeToLog ("Interface failed to load: " + error);
        return false;
    }
};

class MainComponent : public juce::Component,
                      private juce::Timer
{
public:
    explicit MainComponent (Services& sv)
        : bridge (sv, *this), view (bridge.browserOptions())
    {
        bridge.attach (&view);
        addAndMakeVisible (view);
        view.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
        setSize (1440, 900);

        // Automated interface tests: --nxw-ui-test script.js runs the script in the page
        // a few seconds after start-up; it reports back through the log.
        const auto args = juce::JUCEApplication::getCommandLineParameterArray();
        const int t = args.indexOf ("--nxw-ui-test");
        if (t >= 0 && t + 1 < args.size())
        {
            testScript = juce::File::getCurrentWorkingDirectory().getChildFile (args[t + 1].unquoted()).loadFileAsString();
            startTimer (4000);
        }
    }

    ~MainComponent() override
    {
        bridge.autosaveNow();
        bridge.attach (nullptr);
    }

    void paint (juce::Graphics& g) override { g.fillAll (juce::Colour (0xff14181c)); }
    void resized() override { view.setBounds (getLocalBounds()); }

private:
    void timerCallback() override
    {
        stopTimer();
        juce::Logger::writeToLog ("Running interface test script");
        view.evaluateJavascript (testScript, [] (juce::WebBrowserComponent::EvaluationResult r)
        {
            if (auto* err = r.getError()) juce::Logger::writeToLog ("Interface test script error: " + err->message);
        });
    }

    Bridge bridge;
    InterfaceView view;
    juce::String testScript;
};

class MainWindow : public juce::DocumentWindow
{
public:
    explicit MainWindow (Services& sv)
        : DocumentWindow ("NXW Studio", juce::Colour (0xff14181c), DocumentWindow::allButtons),
          services (sv)
    {
        setUsingNativeTitleBar (true);
        setContentOwned (new MainComponent (sv), true);
        setResizable (true, false);
        setResizeLimits (900, 560, 16384, 16384);

        const auto saved = sv.settings.getUserSettings()->getValue ("windowState");
        if (saved.isEmpty() || ! restoreWindowStateFromString (saved))
        {
            auto area = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()->userArea.reduced (40);
            centreWithSize (juce::jmin (1600, area.getWidth()), juce::jmin (960, area.getHeight()));
        }
        setVisible (true);
    }

    ~MainWindow() override
    {
        services.settings.getUserSettings()->setValue ("windowState", getWindowStateAsString());
        services.settings.saveIfNeeded();
    }

    void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }

private:
    Services& services;
};
} // namespace nxw
