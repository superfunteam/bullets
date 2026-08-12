# Signing and updating the macOS app

The release workflow builds a universal macOS app, signs it with a **Developer
ID Application** certificate, notarizes it through App Store Connect, then
uploads the DMG, ZIP, blockmaps, and `latest-mac.yml` to the GitHub Release.
The ZIP and manifest let installed copies update themselves; the DMG is for the
first install.

Until all signing inputs are present, the workflow skips macOS rather than
shipping an unsigned fallback. Android releases continue normally. An unsigned
Mac build would make Gatekeeper hostile and break native notification delivery,
so it is not an acceptable public release.

## One-time Apple setup

1. Enrol the Superfun Apple account in the Apple Developer Program.
2. In Xcode's **Settings → Accounts → Manage Certificates**, create a
   **Developer ID Application** certificate for the Superfun team. Export its
   certificate and private key from Keychain Access as a password-protected
   `.p12`. Do not use *Apple Development* or *Apple Distribution* here; the
   former is for development, and the latter is for the Mac App Store.
3. In App Store Connect, go to **Users and Access → Integrations → App Store
   Connect API**, generate a key with access to notarization, and download the
   `.p8` exactly once. Record its key ID and issuer ID.

## GitHub repository secrets

Add these under **Settings → Secrets and variables → Actions**. The certificate
and API key never enter the repository or release artifacts.

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | Base64-encoded Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | Password used when exporting that `.p12` |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect `.p8` |
| `APPLE_API_KEY_ID` | The API key ID from App Store Connect |
| `APPLE_API_ISSUER` | The App Store Connect issuer ID |

On macOS, encode each file without putting it on disk in the repository:

```bash
base64 -i DeveloperIDApplication.p12 | tr -d '\n' | pbcopy
base64 -i AuthKey_ABC123.p8 | tr -d '\n' | pbcopy
```

Paste the first result into `MAC_CSC_LINK` and the second into
`APPLE_API_KEY_BASE64`.

## Releasing

After the five secrets are in place, the existing release process is unchanged:

```bash
npm version patch --no-git-tag-version
git commit -am "Release"
git tag v$(node -p "require('./package.json').version")
git push --follow-tags
```

The **Release** GitHub Action builds Android and macOS in parallel, verifies the
Mac signature and notarization ticket, and publishes every artifact to one GitHub
Release. The app checks GitHub at launch and every six hours; when an update is
downloaded, its notification restarts Bullets and installs it.
