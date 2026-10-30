# ARTUR PRO Mobile

Expo SDK 55 mobile client for the `ARTUR PRO` transport marketplace.

## What is inside

- customer flow: OTP authentication, quote, order creation, offer acceptance
- carrier flow: registration, fleet management, open orders, active rides
- secure session storage with `expo-secure-store`
- server-side mobile sessions with refresh rotation and logout revocation
- optional biometric app lock with `expo-local-authentication`
- backend integration through `/mobile/*` API

## Local run

1. Install dependencies:

```bash
npm install
```

2. Copy environment example and point it to the backend:

```bash
copy .env.example .env
```

3. Start backend on `3201` without Telegram:

```bash
cd ../backend
set PORT=3201
set TELEGRAM_ENABLED=false
npm run dev:server
```

4. Start the mobile app:

```bash
cd ../mobile
npx expo start
```

## Security notes

- login is two-step: `POST /mobile/auth/challenge` then `POST /mobile/auth/verify`
- access tokens are short-lived and renewed with refresh rotation
- logout revokes the current server-side mobile session
- biometric lock can be enabled from the customer or carrier profile screen
- local dev can use `MOBILE_AUTH_DEBUG=true` to receive OTP codes in the API response
- production should set `MOBILE_AUTH_DEBUG=false` and rely on a real delivery channel such as Telegram-linked accounts or an SMS provider

## Validation

```bash
npx tsc --noEmit
npx expo export --platform web
```

## Store build notes

- Android package: `com.arturpro.mobile`
- iOS bundle id: `com.arturpro.mobile`
- app scheme: `arturpro`

For production store builds, use EAS:

```bash
npx eas-cli build --platform android
npx eas-cli build --platform ios
```

Before uploading to App Store / Google Play, you will still need:

- final store screenshots
- privacy policy and support URL
- production backend URL in `EXPO_PUBLIC_API_URL`
- real app icons / splash assets if branding changes
