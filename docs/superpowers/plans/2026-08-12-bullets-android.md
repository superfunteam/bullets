# Bullets Android — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the Bullets web app as an installable Android APK with a home screen widget, native huddle notifications, and a GitHub Actions release pipeline.

**Architecture:** Capacitor 8 wraps the existing Vite build — one codebase serves web and app. The widget is classic Kotlin `RemoteViews` reading the same `SharedPreferences` file `@capacitor/preferences` writes to, so it stays current without running its own network code. Notifications split into two mechanisms with very different reliability profiles (see the honest assessment below).

**Prerequisite:** The web plan's Task 16 must be deployed and green. `cap sync` copies `dist/`, so there must be a `dist/` worth copying.

**Tech Stack:** Capacitor 8, Kotlin 2.2.20, Gradle 8.14.3 / AGP 8.13.0, JDK 21, `@capacitor/preferences`, `@capacitor/local-notifications`, `@capacitor/app`, GitHub Actions.

---

## Verified environment constraints

These were checked against current docs and the Capacitor 8 template, and several contradict widely-circulated advice. Getting any of them wrong costs an afternoon.

| Thing | Value | Why it bites |
|---|---|---|
| Node | 22+ | Capacitor 8 requirement |
| JDK | **21** | `capacitor.build.gradle` hardcodes `VERSION_21` and is **regenerated on every `cap sync`** — editing it is futile. JDK 17 fails with "invalid source release: 21". |
| minSdk / compileSdk / targetSdk | 24 / 36 / 36 | |
| Gradle DSL | **Groovy, not `.kts`** | The Capacitor 8 template has zero `.kts` files. Kotlin-DSL snippets from blogs won't drop in. |
| Kotlin | Not present by default | The template has no Kotlin plugin at all. Must be added to write the widget. |
| Widget toolkit | **RemoteViews, not Glance** | Glance's newest *stable* is 1.1.1 from Oct 2024; 1.2.0 sat in RC ~8 months and never shipped. For a widget showing a count and two buttons, Glance buys nothing and drags the whole Compose toolchain into an app module whose only UI is a WebView. |
| `android/` directory | **Must be committed** | `cap sync` updates an existing platform, it doesn't create one. Regenerating it in CI would wipe the signing config every run. |
| `gradle-wrapper.jar` | **Must be committed** | A blanket `*.jar` gitignore silently breaks CI. |

---

## Task 1: Add Capacitor and the Android platform

**Files:**
- Create: `capacitor.config.ts`, `android/` (generated, then committed)
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Install and initialize**

```bash
npm i @capacitor/core @capacitor/android @capacitor/app @capacitor/preferences @capacitor/local-notifications
npm i -D @capacitor/cli
npx cap init Bullets team.superfun.bullets --web-dir dist
```

- [ ] **Step 2: Write capacitor.config.ts**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'team.superfun.bullets',
  appName: 'Bullets',
  webDir: 'dist',
  server: {
    // The WebView serves from https://localhost/ — a real origin, so the
    // History API works and BrowserRouter needs no special handling.
    androidScheme: 'https',
  },
};

export default config;
```

- [ ] **Step 3: Add the platform and sync**

```bash
npm run build          # must precede sync — cap copies dist/
npx cap add android
npx cap sync android
```

- [ ] **Step 4: Handle safe areas**

Capacitor 8 applies edge-to-edge automatically (targetSdk 36 forces it), and injects fallback CSS vars because of WebView `env()` bugs. Add to `src/design/tokens.css` so the header doesn't sit under the status bar:

```css
body {
  padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
  padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
}
```

- [ ] **Step 5: Commit the android directory**

```bash
git add -A && git commit -m "feat: add Capacitor Android platform"
```

---

## Task 2: Enable Kotlin in the app module

The template ships no Kotlin. Configure it **only** in the app module — not in the Capacitor or third-party modules, per Capacitor's own guidance.

**Files:**
- Modify: `android/build.gradle`, `android/app/build.gradle`

- [ ] **Step 1: Add the Kotlin plugin to the buildscript classpath**

In `android/build.gradle`, inside `buildscript { dependencies { ... } }`:

```groovy
classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.20'
```

- [ ] **Step 2: Apply it in the app module**

At the top of `android/app/build.gradle`, after the existing apply line:

```groovy
apply plugin: 'com.android.application'
apply plugin: 'org.jetbrains.kotlin.android'
```

- [ ] **Step 3: Verify it compiles**

```bash
cd android && ./gradlew assembleDebug && cd ..
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "build: enable Kotlin in the Android app module"
```

---

## Task 3: The widget data bridge

The widget must show today's shots without doing its own networking. It reads the exact `SharedPreferences` file `@capacitor/preferences` writes to.

**The contract, verified from the plugin source:** file name is the group name, defaulting to **`CapacitorStorage`**; there is **no key prefix** (the old Capacitor 2 `_cap_` prefix is gone); values are written with `putString`. Writing an int or boolean from Kotlin makes the plugin's `getString` throw `ClassCastException`, so **always `putString`**.

**Files:**
- Create: `src/native/widget.ts`
- Modify: `src/sync/client.ts` to publish after each sync

- [ ] **Step 1: Write the publisher**

```ts
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { db } from '../data/db';
import { clean } from '../data/ops';
import { today } from '../lib/dates';
import type { Bullet, Shot } from '../data/types';

/** Everything the widget needs, flattened so Kotlin parses one small JSON blob. */
export type WidgetPayload = {
  date: string;
  openCount: number;
  titles: string[];
  updatedAt: number;
};

export async function publishWidget(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const date = today();
  const shots = (await db.shots.where('[scope+date]').equals(['day', date]).toArray())
    .filter(s => !s.deletedAt)
    .map(s => clean<Shot>(s));
  const open = shots.filter(s => s.state === 'open');
  const bullets = await db.bullets.bulkGet(open.map(s => s.bulletId));

  const payload: WidgetPayload = {
    date,
    openCount: open.length,
    titles: bullets.filter(Boolean).slice(0, 4).map(b => clean<Bullet>(b!).title),
    updatedAt: Date.now(),
  };

  await Preferences.set({ key: 'widget', value: JSON.stringify(payload) });
  await refreshWidget();
}
```

- [ ] **Step 2: Call it after every sync**

In `src/sync/client.ts`, at the end of `syncOnce()`:

```ts
void publishWidget();
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: publish widget payload to shared preferences"
```

---

## Task 4: The home screen widget

**Files:**
- Create: `android/app/src/main/java/team/superfun/bullets/BulletsWidgetProvider.kt`
- Create: `android/app/src/main/res/xml/bullets_widget_info.xml`
- Create: `android/app/src/main/res/layout/bullets_widget.xml`
- Create: `android/app/src/main/res/drawable/widget_background.xml`
- Create: `android/app/src/main/res/values/attrs.xml`, `values/styles.xml`, `values-v31/styles.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Write the widget provider**

Two non-obvious traps are handled below, and both cause silent misbehavior rather than crashes:

1. **`PendingIntent` equality ignores extras.** Two PendingIntents are equal if action, data, type, package, component and categories match — extras are explicitly excluded. Buttons differing only by `putExtra("route", …)` collapse into one. Putting the route in the Intent's **`data` URI** makes them genuinely distinct.
2. **`FLAG_IMMUTABLE` is mandatory** on API 31+; omitting it throws.

```kotlin
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

class BulletsWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, mgr, it) }
    }

    private fun render(context: Context, mgr: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.bullets_widget)

        // Same SharedPreferences file @capacitor/preferences writes to.
        val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val raw = prefs.getString("widget", null)

        if (raw == null) {
            views.setTextViewText(R.id.widget_count, "—")
            views.setTextViewText(R.id.widget_lines, "Open Bullets to sync")
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
            }
        }

        views.setOnClickPendingIntent(R.id.widget_add, link(context, widgetId, "bullets://app/capture"))
        views.setOnClickPendingIntent(R.id.widget_root, link(context, widgetId, "bullets://app/today"))

        mgr.updateAppWidget(widgetId, views)
    }

    /**
     * Explicit Intent targeting MainActivity directly. Because it carries
     * ACTION_VIEW and a data URI, Capacitor's App plugin fires `appUrlOpen`
     * without any intent-filter needing to match — so this needs no manifest entry.
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
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        /** Force a redraw. Called from the WidgetBridge plugin after each sync. */
        fun refreshAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, BulletsWidgetProvider::class.java))
            if (ids.isEmpty()) return
            // Explicit broadcast — implicit ACTION_APPWIDGET_UPDATE is unreliable now.
            val intent = Intent(context, BulletsWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }
    }
}
```

- [ ] **Step 2: Write the widget metadata**

`res/xml/bullets_widget_info.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="180dp"
    android:minHeight="110dp"
    android:targetCellWidth="3"
    android:targetCellHeight="2"
    android:minResizeWidth="180dp"
    android:minResizeHeight="110dp"
    android:maxResizeWidth="400dp"
    android:maxResizeHeight="400dp"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/bullets_widget"
    android:previewLayout="@layout/bullets_widget"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen"
    android:description="@string/widget_description" />
```

`updatePeriodMillis` has a **30-minute floor**; anything faster needs WorkManager. Our refresh is push-driven from the app anyway.

- [ ] **Step 3: Write the layout with correct Android 12+ corners**

`res/values/attrs.xml`:
```xml
<resources><attr name="backgroundRadius" format="dimension" /></resources>
```
`res/values/styles.xml`:
```xml
<resources>
  <style name="BulletsWidgetTheme"><item name="backgroundRadius">20dp</item></style>
</resources>
```
`res/values-v31/styles.xml`:
```xml
<resources>
  <style name="BulletsWidgetTheme" parent="@android:style/Theme.DeviceDefault.DayNight">
    <item name="backgroundRadius">@android:dimen/system_app_widget_background_radius</item>
  </style>
</resources>
```
`res/drawable/widget_background.xml`:
```xml
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="?attr/colorPrimaryContainer" />
  <corners android:radius="?attr/backgroundRadius" />
</shape>
```

`res/layout/bullets_widget.xml` — note `@android:id/background` on the root, which is what enables smooth Android 12+ launcher transitions. Keep content padded away from the corners, since corner masking is applied automatically and will clip.

- [ ] **Step 4: Register the receiver**

In `AndroidManifest.xml`, inside `<application>`:
```xml
<receiver android:name=".BulletsWidgetProvider" android:exported="false">
    <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
    </intent-filter>
    <meta-data android:name="android.appwidget.provider"
               android:resource="@xml/bullets_widget_info" />
</receiver>
```

- [ ] **Step 5: Add the WidgetBridge plugin so JS can force a refresh**

Capacitor has no built-in for this. Note `registerPlugin` must run **before** `super.onCreate()`.

`MainActivity.java`:
```java
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

`WidgetBridgePlugin.kt`:
```kotlin
package team.superfun.bullets

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {
    @PluginMethod
    fun refresh(call: PluginCall) {
        BulletsWidgetProvider.refreshAll(context)
        call.resolve()
    }
}
```

`src/native/widget.ts` — add the JS side:
```ts
import { registerPlugin } from '@capacitor/core';

interface WidgetBridgePlugin { refresh(): Promise<void>; }
const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

export async function refreshWidget(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await WidgetBridge.refresh().catch(() => { /* widget not placed; fine */ });
}
```

- [ ] **Step 6: Verify on a device and commit**

Place the widget on a home screen, create a shot in the app, confirm the count updates and the Add button opens the capture sheet.

```bash
git add -A && git commit -m "feat: add home screen widget with quick add"
```

---

## Task 5: Deep links

**Files:**
- Modify: `android/app/src/main/res/values/strings.xml`, `AndroidManifest.xml`
- Create: `src/native/deepLinks.ts`

- [ ] **Step 1: Add the custom scheme filter**

Capacitor's template defines `custom_url_scheme` in `strings.xml` but **references it nowhere** — despite many tutorials implying the filter is default. It is not. Set the value to `bullets` and add to MainActivity:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="@string/custom_url_scheme" />
</intent-filter>
```

Leave `launchMode="singleTask"` alone — it's what makes an existing instance receive `onNewIntent` instead of spawning a duplicate task.

- [ ] **Step 2: Handle the URL in React**

Cold-start links are safe: Capacitor notifies `appUrlOpen` with `retainUntilConsumed = true`, so an event fired before React mounts is queued and replayed when the first listener attaches. No `getLaunchUrl()` workaround needed.

```ts
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { useEffect } from 'react';

export function useDeepLinks(navigate: (path: string) => void) {
  useEffect(() => {
    const handle = App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      // Parse properly rather than string-splitting on '.app', which breaks
      // on any path containing that substring.
      const url = new URL(event.url);
      navigate(url.pathname || '/');
    });
    return () => { void handle.then(h => h.remove()); };
  }, [navigate]);
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add deep link handling"
```

---

## Task 6: Notifications

### Honest assessment, because the reliability differs sharply

**Exact local reminders — rock solid.** "Huddle starts in 30 minutes" is scheduled by the OS the moment the huddle syncs down. Zero network, zero latency, works in airplane mode. This is the path that actually serves the advance-warning requirement, and it has no moving parts.

**"Angie requested a huddle" without Firebase — unreliable, and I want to be straight about it.** Background polling bottoms out at a 15-minute WorkManager interval, and more importantly, Xiaomi, Huawei, Samsung and others aggressively kill background work beyond stock Android's rules. On those devices it may not fire at all until the app is opened.

**Recommendation:** build the local path as the backbone, and wire FCM so that it activates the moment a `google-services.json` file is dropped in — no code change required, because Capacitor's template already carries the `google-services` classpath and applies the plugin conditionally on that file existing. That makes instant push a ~10-minute file-drop whenever Clark and Angie want it, with no rework.

**Files:**
- Create: `src/native/notify.ts`
- Modify: `AndroidManifest.xml`

- [ ] **Step 1: Add exact-alarm permissions**

```xml
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Without `SCHEDULE_EXACT_ALARM`, Android 12+ will not fire scheduled notifications exactly — they drift, which defeats the purpose.

- [ ] **Step 2: Schedule huddle reminders**

Android 13+ requires a runtime permission request even though the plugin declares it.

```ts
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { Huddle } from '../data/types';

const REMINDER_LEAD_MIN = 30;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'prompt') perm = await LocalNotifications.requestPermissions();
  return perm.display === 'granted';
}

/** Stable numeric id derived from the huddle uuid, so rescheduling replaces. */
const idFor = (huddleId: string, offset: number) => {
  let h = 0;
  for (let i = 0; i < huddleId.length; i++) h = (h * 31 + huddleId.charCodeAt(i)) | 0;
  return Math.abs(h % 100_000) * 10 + offset;
};

export async function scheduleHuddleReminders(huddles: Huddle[]): Promise<void> {
  if (!(await ensureNotificationPermission())) return;

  const upcoming = huddles.filter(h => h.status === 'scheduled' && h.startsAt > Date.now());
  const notifications = upcoming.flatMap(h => {
    const lead = new Date(h.startsAt - REMINDER_LEAD_MIN * 60_000);
    const title = h.title ?? 'Huddle';
    const out = [];
    if (lead.getTime() > Date.now()) {
      out.push({
        id: idFor(h.id, 1),
        title: `${title} in ${REMINDER_LEAD_MIN} min`,
        body: `Called by ${h.calledBy === 'clark' ? 'Clark' : 'Angie'}`,
        schedule: { at: lead, allowWhileIdle: true },
        extra: { route: `/huddle/${h.id}` },
      });
    }
    out.push({
      id: idFor(h.id, 2),
      title: `${title} starting now`,
      body: 'Tap to open the board',
      schedule: { at: new Date(h.startsAt), allowWhileIdle: true },
      extra: { route: `/huddle/${h.id}` },
    });
    return out;
  });

  if (notifications.length) await LocalNotifications.schedule({ notifications });
}
```

`allowWhileIdle` fires during Doze but is rate-limited to once per 9 minutes per app — fine at our volume.

- [ ] **Step 3: Notify on a newly synced huddle request**

When `syncOnce()` applies remote ops that create a huddle called by the *other* person, fire an immediate local notification with In / Nudge / Can't actions, then schedule its reminders.

- [ ] **Step 4: Handle notification taps**

```ts
LocalNotifications.addListener('localNotificationActionPerformed', event => {
  const route = event.notification.extra?.route;
  if (route) navigate(route);
});
```

- [ ] **Step 5: Document the optional FCM upgrade**

Write `docs/firebase-setup.md`: create a Firebase project, add an Android app with package name exactly `team.superfun.bullets`, download `google-services.json` to `android/app/`, run `npx cap sync android`. Note that legacy FCM server keys were shut down in July 2024 — the server side must use HTTP v1 with OAuth2 service-account tokens, most easily via `firebase-admin`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add local huddle notifications"
```

---

## Task 7: Signed release build

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `.gitignore`

- [ ] **Step 1: Add a guarded signing config**

The critical trap: **`assembleRelease` with no signing config does not fail.** It emits `app-release-unsigned.apk`, which won't install (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`). A workflow with a typo'd secret name goes green while shipping garbage. Hence the explicit guard and the verification step in Task 8.

```groovy
apply plugin: 'com.android.application'
apply plugin: 'org.jetbrains.kotlin.android'

def ksStoreFile = System.getenv("ANDROID_KEYSTORE_FILE")
def ksStorePass = System.getenv("ANDROID_KEYSTORE_PASSWORD")
def ksKeyAlias  = System.getenv("ANDROID_KEY_ALIAS")
def ksKeyPass   = System.getenv("ANDROID_KEY_PASSWORD")

def canSignRelease = ksStoreFile != null && !ksStoreFile.toString().isEmpty() && file(ksStoreFile).exists()

android {
    // ... Capacitor's generated block ...

    signingConfigs {
        release {
            if (canSignRelease) {
                storeFile     file(ksStoreFile)
                storePassword ksStorePass
                keyAlias      ksKeyAlias
                keyPassword   ksKeyPass
            }
        }
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            if (canSignRelease) {
                signingConfig signingConfigs.release
            } else {
                logger.warn("No release keystore — assembleRelease will emit an UNSIGNED APK.")
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "build: add guarded release signing config"
```

---

## Task 8: GitHub Actions release pipeline

**Files:**
- Create: `.github/workflows/android-release.yml`, `.github/workflows/android-debug.yml`

- [ ] **Step 1: Write the release workflow**

Action versions below were verified against the GitHub API and are current; most tutorials still show `@v4` for checkout and upload-artifact, which is three majors stale.

```yaml
name: Android Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

# action-gh-release writes via the Releases API and the default token is
# read-only on modern repos. Naming any scope sets unnamed scopes to none.
permissions:
  contents: write

concurrency:
  group: android-release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    # ubuntu-latest already ships Android SDK 36 — no setup-android step needed.
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: '21'
          # Deliberately no `cache: gradle` — it interferes with setup-gradle.

      - uses: gradle/actions/setup-gradle@v6

      - run: npm ci
      - run: npm run build
      - run: npx cap sync android

      - name: Decode release keystore
        id: keystore
        env:
          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          if [ -z "$ANDROID_KEYSTORE_BASE64" ]; then
            echo "present=false" >> "$GITHUB_OUTPUT"
            echo "::warning::No keystore secret set — building a debug-signed APK instead."
            exit 0
          fi
          echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$RUNNER_TEMP/release.keystore"
          test -s "$RUNNER_TEMP/release.keystore" || { echo "::error::keystore decoded empty"; exit 1; }
          echo "present=true" >> "$GITHUB_OUTPUT"

      - run: chmod +x ./android/gradlew

      - name: Build signed release
        if: steps.keystore.outputs.present == 'true'
        working-directory: android
        env:
          ANDROID_KEYSTORE_FILE: ${{ runner.temp }}/release.keystore
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: ./gradlew assembleRelease --stacktrace

      - name: Build debug APK (no keystore configured)
        if: steps.keystore.outputs.present == 'false'
        working-directory: android
        run: ./gradlew assembleDebug --stacktrace

      - name: Verify the APK is actually signed
        if: steps.keystore.outputs.present == 'true'
        run: |
          APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)"
          "$APKSIGNER" verify --verbose --print-certs \
            android/app/build/outputs/apk/release/app-release.apk

      - name: Stage the APK
        id: stage
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          mkdir -p out
          if [ "${{ steps.keystore.outputs.present }}" = "true" ]; then
            cp android/app/build/outputs/apk/release/app-release.apk "out/bullets-${VERSION}.apk"
          else
            cp android/app/build/outputs/apk/debug/app-debug.apk "out/bullets-${VERSION}-debug.apk"
          fi
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"

      - uses: actions/upload-artifact@v7
        with:
          name: bullets-${{ steps.stage.outputs.version }}
          path: out/*
          if-no-files-found: error
          retention-days: 90

      - uses: softprops/action-gh-release@v3
        with:
          tag_name: ${{ github.ref_name }}
          name: Bullets ${{ github.ref_name }}
          generate_release_notes: true
          fail_on_unmatched_files: true
          files: out/*.apk

      - name: Remove decoded keystore
        if: always()
        run: rm -f "$RUNNER_TEMP/release.keystore"
```

The debug fallback means the pipeline is useful from day one. A debug APK installs fine via sideload, with two caveats worth knowing: it's `debuggable`, so anyone with USB access can inspect app data, and its signing key is per-machine, so a CI debug build won't install over a locally built one without uninstalling first.

- [ ] **Step 2: Document keystore creation**

Write `docs/android-signing.md`:

```bash
keytool -genkeypair -v -keystore release.keystore -alias bullets \
  -keyalg RSA -keysize 2048 -validity 10000
```

Base64-encode it — and note the encoding flag differs by platform, which trips people up constantly. macOS's BSD `base64` rejects `-w` entirely. The portable form:

```bash
base64 < release.keystore | tr -d '\n' > keystore.b64
```

Then add four repo secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Never `cat` the decoded keystore in a workflow — GitHub masks only literal secret values, not decoded binaries.

- [ ] **Step 3: Tag and verify the pipeline**

```bash
git tag v1.0.0 && git push --tags
gh run watch
```
Expected: a GitHub Release with an installable APK attached.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "ci: add Android release pipeline"
```

---

## Self-Review

**Spec coverage.** APK via Capacitor → Task 1. Widget with quick-add and today's shots → Tasks 3, 4. Widget→app deep links → Tasks 4, 5. Native huddle notifications → Task 6. Signed APK on a GitHub Release page → Tasks 7, 8.

**Deviation from the spec, flagged deliberately:** the spec proposed a WorkManager background-sync job as the delivery mechanism for "Angie requested a huddle." Research showed that path is unreliable on OEM-skinned Android regardless of implementation quality. Task 6 replaces it with a rock-solid local-reminder backbone plus a documented, zero-rework FCM upgrade. The spec's §6 should be updated to match once this ships.

**Type consistency check:** `publishWidget()` and `refreshWidget()` both live in `src/native/widget.ts` and are used by Task 3 and Task 4. The SharedPreferences key is `"widget"` in both the TypeScript publisher and the Kotlin reader. The package name `team.superfun.bullets` matches across `capacitor.config.ts`, the Kotlin package declaration, and the assetlinks/signing docs.
