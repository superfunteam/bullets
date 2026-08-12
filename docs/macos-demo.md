# Two-person macOS demo

Until Apple approves the Developer Program application, use the unsigned demo
ZIP only between Clark and Angie. It contains the real universal Mac app, with
the native window and menu-bar icon, but it is not a public distribution build.

```bash
npm run mac:demo
```

The ZIP is written to `demo-release/`. Send it privately; do not upload it as a
general download or attach it to a public GitHub Release.

## On each Mac

1. Unzip it and drag `Bullets.app` to Applications.
2. Try to open it once.
3. In **System Settings → Privacy & Security**, click **Open Anyway**, then
   confirm **Open**. This is a one-time exception for that app.

The app will thereafter open normally and retain its menu-bar item after the
window closes. Because Apple requires native notification delivery and trusted
auto-updates to be code-signed, the unsigned demo does **not** promise huddle
notifications or automatic updating. Replace it with the signed release as soon
as the Apple application is approved.
