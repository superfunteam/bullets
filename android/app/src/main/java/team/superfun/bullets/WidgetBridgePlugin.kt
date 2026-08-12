package team.superfun.bullets

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Capacitor has no built-in way to poke a widget, so this is the whole bridge. */
@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {

    @PluginMethod
    fun refresh(call: PluginCall) {
        BulletsWidgetProvider.refreshAll(context)
        call.resolve()
    }
}
