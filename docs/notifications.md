# Notifications (Web Push)

Pocket can notify the installed PWA (or any browser with the site open in a service worker)
when something needs attention. It is **opt-in per device** and **off unless the operator
configures VAPID keys**. There is no email channel.

## Operator setup

1. `make vapid-keys` prints a key pair and a `VAPID_SUBJECT` placeholder.
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or https URL the
   push services can reach you at) on the API. `VAPID_PRIVATE_KEY_FILE` works as a Docker secret.
3. `DB_ENCRYPTION_KEY` must be set: a device's push keys are stored encrypted.

Any of the three unset means push is off: `GET /me/push/config` answers `enabled: false`, the
Settings toggle is hidden and every send is a no-op. Rotating the VAPID pair invalidates every
existing subscription; users switch the toggle off and on again.

## User flow

Settings › Account › **Notifications on this device** asks the browser for permission, subscribes
through the service worker and registers the device. **Send a test notification** confirms it
works. On iPhone and iPad the site must be added to the Home Screen first (iOS only delivers
push to installed web apps).

## API

| Route                                    | Notes                                                   |
| ---------------------------------------- | ------------------------------------------------------- |
| `GET /me/push/config`                    | `{ enabled, publicKey }`                                |
| `POST /me/push/subscriptions`            | `{ endpoint, keys: { p256dh, auth } }`, write-scoped    |
| `DELETE /me/push/subscriptions?endpoint` | removes the caller's own subscription only              |
| `POST /me/push/test`                     | pushes to the caller's devices; 5 per hour; 409 if none |

Read-scoped personal access tokens and connector tokens cannot register devices (the generic
mutating-method gate). At most 10 devices are kept per user (oldest dropped). An endpoint that
another user registered earlier moves to the user who registers it last.

## Sending from the server

`notifyUser(deps, userId, { title, body, url?, tag? })` in
`services/api/src/services/notifications/push.ts`. It never throws (a notification must not fail
the job that raised it), prunes subscriptions the push service reports gone (404/410), and
only ever lets `url` be a same-origin path. A newer notification with the same `tag` replaces
the older one instead of stacking.

## Trade Republic login

The first user of this channel: a push when the stored Trade Republic login is about to expire and
when it has expired (tag `tr-login`, opens `/holdings`). Timing, dedupe and the 24 h session
lifetime are in `docs/trade_republic.md` › "Session lifetime and early renew".

## Security notes

- The server POSTs to the subscription endpoint, so `endpoint` must be an `https` URL on a known
  push service (FCM, Mozilla autopush, Apple, Windows WNS). Anything else is refused, so the
  endpoint cannot be pointed at an internal host.
- The service worker re-checks that a click target is a same-origin path before navigating.
- Payloads carry no financial figures, only a short message and a path.
