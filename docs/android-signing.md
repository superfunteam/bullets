# Android signing

The release workflow builds a **debug-signed APK** until you set this up. That
APK installs fine by sideloading, so you can use Bullets immediately and do this
later.

Do it when you want proper signing — which you'll need before an APK can update
in place rather than requiring an uninstall.

## 1. Generate a keystore

```bash
keytool -genkeypair -v -keystore release.keystore -alias bullets \
  -keyalg RSA -keysize 2048 -validity 10000
```

`-validity 10000` is about 27 years. Keep this file somewhere safe and backed up
— **losing it means you can never update an installed app in place again.**

## 2. Base64-encode it

The encoding flag differs by platform, which trips people up constantly. macOS's
BSD `base64` rejects `-w` entirely, and GNU `base64` wraps at 76 columns by
default, which corrupts the secret. This form works on both:

```bash
base64 < release.keystore | tr -d '\n' > keystore.b64
```

## 3. Add four repository secrets

GitHub → repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the contents of `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password you chose |
| `ANDROID_KEY_ALIAS` | `bullets` |
| `ANDROID_KEY_PASSWORD` | the key password you chose |

Then delete `keystore.b64` from your machine.

## 4. Cut a release

```bash
git tag v1.0.0 && git push --tags
```

The workflow builds, verifies the signature with `apksigner`, and attaches the
APK to a GitHub Release.

## Why the workflow verifies the signature

`assembleRelease` with a broken signing config **does not fail**. It emits
`app-release-unsigned.apk`, which won't install
(`INSTALL_PARSE_FAILED_NO_CERTIFICATES`). A workflow with one typo'd secret name
goes green while shipping something nobody can install.

So the build guards on the keystore actually existing, and runs
`apksigner verify` before publishing. If you ever see the workflow warn
"No ANDROID_KEYSTORE_BASE64 secret", that's this guard working.

## Notes

- Never `cat` the decoded keystore in a workflow. GitHub masks only literal
  secret values, not decoded binaries.
- The decoded file lands in `$RUNNER_TEMP`, outside the workspace, so it can't
  be swept into an artifact upload, and it's removed in an `if: always()` step.
- Secrets aren't available to workflows triggered from forks. Not a concern for
  a private two-person repo.
- A debug APK's signing key is per-machine, so a CI debug build won't install
  over one you built locally. Uninstall first.
