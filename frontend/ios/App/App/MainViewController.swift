import UIKit
import Capacitor

/**
 * The app's bridge view controller (Main.storyboard). Capacitor registers the plugins that come
 * from npm by itself, from the packageClassList `cap sync` writes into capacitor.config.json;
 * a plugin that lives in this app target is not in that list and has to be registered here.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrintPlugin())
        bridge?.registerPluginInstance(AppleHealthPlugin())
    }
}
