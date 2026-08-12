package team.superfun.bullets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Home screen widget: today's shots at a glance, plus a quick add.
 *
 * It reads the same SharedPreferences file @capacitor/preferences writes to
 * (group "CapacitorStorage", no key prefix), so it stays current without
 * running any network code of its own. The app republishes after every sync.
 */
class BulletsWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, mgr, it) }
    }

    private fun render(context: Context, mgr: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.bullets_widget)

        val raw = context
            .getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            .getString("widget", null)

        if (raw == null) {
            views.setTextViewText(R.id.widget_count, "–")
            views.setTextViewText(R.id.widget_label, "open Bullets to sync")
            views.setTextViewText(R.id.widget_lines, "")
        } else {
            runCatching {
                val json = JSONObject(raw)
                val count = json.optInt("openCount", 0)
                views.setTextViewText(R.id.widget_count, count.toString())
                views.setTextViewText(
                    R.id.widget_label,
                    if (count == 1) "shot today" else "shots today",
                )

                val titles = json.optJSONArray("titles")
                val lines = buildString {
                    for (i in 0 until (titles?.length() ?: 0)) {
                        if (i > 0) append('\n')
                        append("• ").append(titles!!.getString(i))
                    }
                }
                views.setTextViewText(R.id.widget_lines, lines)
            }.onFailure {
                views.setTextViewText(R.id.widget_count, "–")
                views.setTextViewText(R.id.widget_label, "shots today")
                views.setTextViewText(R.id.widget_lines, "")
            }
        }

        views.setOnClickPendingIntent(R.id.widget_add, link(context, widgetId, "bullets://app/capture"))
        views.setOnClickPendingIntent(R.id.widget_body, link(context, widgetId, "bullets://app/today"))

        mgr.updateAppWidget(widgetId, views)
    }

    /**
     * Explicit Intent straight to MainActivity. Because it carries ACTION_VIEW
     * and a data URI, Capacitor's App plugin fires `appUrlOpen` without any
     * intent-filter needing to match, so this needs no manifest entry at all.
     *
     * The route lives in the URI rather than an extra on purpose: PendingIntent
     * equality ignores extras, so two buttons differing only by an extra would
     * silently collapse into the same PendingIntent.
     */
    private fun link(context: Context, widgetId: Int, uri: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(uri)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        return PendingIntent.getActivity(
            context,
            (widgetId.toString() + uri).hashCode(),
            intent,
            // FLAG_IMMUTABLE is mandatory on API 31+; omitting it throws.
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        /** Force a redraw. Called from WidgetBridgePlugin after each sync. */
        fun refreshAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(
                ComponentName(context, BulletsWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            // Explicit broadcast — the implicit ACTION_APPWIDGET_UPDATE is
            // unreliable on modern Android.
            val intent = Intent(context, BulletsWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }
    }
}
