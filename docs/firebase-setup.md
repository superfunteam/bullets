# Optional: instant huddle alerts

**You don't need this to use Bullets.** Huddle reminders already work, reliably,
with no setup. Read this only if you want the *instant* ping.

## What already works without Firebase

Scheduled reminders — "Huddle in 30 minutes" and "Huddle starting now" — are
locally scheduled through Android's `AlarmManager` the moment a huddle syncs to
your phone. They:

- fire at the exact second
- survive the app being killed
- survive a reboot
- need no network at all

This is the path that actually delivers advance warning, and it's the one with
no moving parts.

## What needs Firebase

The instant *"Angie just called a huddle"* ping, delivered before you next open
the app.

**Why polling can't do this**, since it's the obvious idea: Android's Doze mode
suspends network access and blocks `WorkManager` entirely, `WorkManager`'s floor
is 15 minutes anyway, and OEM battery managers on Xiaomi, Huawei, Samsung and
others kill background work more aggressively still. FCM survives because Play
Services is exempt by construction. There is no way to build around this from
inside an app.

Without Firebase you find out about a new huddle either at the next scheduled
reminder, or when you next open the app. Given Angie will usually also just say
it out loud, that's often fine.

## Setup, about ten minutes

Capacitor's Android template already carries the `google-services` classpath and
applies the plugin conditionally on the config file existing. So this is
genuinely just a file drop — **no Gradle edits, no code changes.**

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
   Google Analytics is optional.
2. Add an Android app. The package name must be exactly `team.superfun.bullets`
   — it's case-sensitive and can't be changed after registering. No SHA-1 is
   needed; that's only for Firebase Auth.
3. Download `google-services.json` and put it at **`android/app/google-services.json`**
   (the app-level directory, not the project root).
4. ```bash
   npm i @capacitor/push-notifications
   npx cap sync android
   ```
5. Rebuild. Verify with Firebase Console → Messaging → "Send test message" using
   the FCM token the app logs on first launch — that validates the whole chain
   before any server code exists.

Add `android/app/google-services.json` to `.gitignore` if you'd rather not
commit it. It isn't a credential, but it does identify your project.

## Server side

Add a Netlify function that sends via **FCM HTTP v1**. Note that the legacy
`https://fcm.googleapis.com/fcm/send` endpoint with an `Authorization: key=...`
server key was **shut down in July 2024** — any tutorial showing that is dead.

Current form:

```
POST https://fcm.googleapis.com/v1/projects/<PROJECT_ID>/messages:send
Authorization: Bearer <oauth2 access token>
```

Easiest path is `firebase-admin`, which mints and refreshes the token for you:

```js
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

await getMessaging().send({
  token: deviceToken,
  notification: { title: 'Angie called a huddle', body: 'Tomorrow at 10am' },
  android: { priority: 'high', notification: { channelId: 'huddles' } },
});
```

Get the service account JSON from Firebase Console → Project settings → Service
accounts → Generate new private key. Store it as a Netlify environment variable.
**Treat it as a root credential** — it can push to every device you have. Never
ship it in the app.

Use `priority: 'high'` only when you actually post a visible notification; FCM
downgrades apps that consistently send high-priority messages without showing
anything.
