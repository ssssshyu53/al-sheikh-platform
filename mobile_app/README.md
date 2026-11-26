# MATN (مَتْن) Mobile App (Flutter — Android & iOS)

## Production Build Configuration

Pass your production HTTPS backend domain at compile time using `MATN_API_BASE_URL`:

```bash
# Android App Bundle / APK (production)
flutter build appbundle --release --dart-define=MATN_API_BASE_URL=https://matn.academy
flutter build apk --release --dart-define=MATN_API_BASE_URL=https://matn.academy

# iOS IPA (production)
flutter build ipa --release --dart-define=MATN_API_BASE_URL=https://matn.academy
```

## Android Release Signing

Create `android/key.properties` (never commit to git):

```properties
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=matn_release
storeFile=/path/to/matn-release.jks
```

## Security Controls Built-In
- Android `FLAG_SECURE` in `MainActivity.kt` (blocks screenshots & screen recording).
- iOS `UIScreen.capturedDidChangeNotification` + launch/foreground capture overlay shield in `AppDelegate.swift`.
- `FlutterSecureStorage` with Android `encryptedSharedPreferences: true`.
- Hardware/random persistent `X-Device-Id` device binding enforced server-side.
