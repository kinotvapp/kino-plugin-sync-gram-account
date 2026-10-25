# Sync-Gram Cuenta: sync your Kino devices through your own Telegram account

[Leer en español](README.es.md)

> **Unofficial: not affiliated with Telegram.** Sync-Gram Cuenta is a Kino plugin that talks to Telegram's public
> MTProto API with your own account; Telegram does not make, endorse or support it.

This repository is **Sync-Gram Cuenta** (plugin id `sync-gram-account`), a **Kino sync provider** that keeps your
phone and your TV in step (library, history, progress and settings) through **your own Telegram account**. Kino
encrypts a copy of your data; the plugin keeps that copy in your **Saved Messages** as one file, `kino-sync.bin`,
pinned and sent silently. Your other devices read the pinned file back.

There is **no bot**, **no server of Kino's** and **no server of yours**: only Telegram's own servers
(`pluto`, `venus`, `aurora`, `vesta` and `flora` `.web.telegram.org`), which are the only addresses this plugin may
reach.

```
your phone ─┐                                                      ┌─ your Saved Messages
            ├─ MTProto over wss ─▶ *.web.telegram.org (your account) ─┤    📌 kino-sync.bin  (the encrypted copy)
your TV  ───┘                                                      └─ (only the newest copy is kept)
```

If you would rather not give a plugin a session of your whole account, use **Sync-Gram**
([kinotvapp/kino-plugin-sync-gram](https://github.com/kinotvapp/kino-plugin-sync-gram)) instead: it does the same
through a Telegram bot you create, which can see far less of your account (see [Privacy and risks](#privacy-and-risks)).

## What you need

- **Kino 0.9.74 or newer** on every device. Older versions cannot run this kind of sync provider.
- **A Telegram account**, with the Telegram app on your phone (you need it to receive the login code and to scan the
  TV's QR).
- **Your own `api_id` and `api_hash`** from <https://my.telegram.org> (free; step 1 below shows how). They identify
  "an app" of yours to Telegram. Nobody else's are built into the plugin.
- **Your phone number** with its country code, and the **login code** Telegram sends you.
- Your **two-step password**, if your account has one (Telegram ▸ Settings ▸ Privacy and Security ▸ Two-Step
  Verification).

## 1. Get your api_id and api_hash

You can do this on the phone itself, from the plugin's **Get api_id and api_hash** link (step 3 below), or on a
computer.

1. Open <https://my.telegram.org> and sign in with your phone number. Telegram sends a code **to your Telegram
   app** (not by SMS); type it on the page.
2. Tap **API development tools**.
3. If you have no app yet, fill in the form: **App title** and **Short name** can be anything (for example
   `My Kino sync` and `mykinosync`); the platform can stay as it is. Create it.
4. The page now shows **App api_id** (a number) and **App api_hash** (32 letters and digits). Keep that page open,
   or copy both somewhere private.
   - Treat the `api_hash` like a password: do not paste it into chats or screenshots.

## 2. Install the plugin in Kino

1. On the phone, open **Menu ▸ Plugins** and tap **+** (Add plugin). On the TV, open **Plugins** and choose **Add
   plugin**.
2. Leave the type on **Kino**. In **Plugin address**, type `kinotvapp/kino-plugin-sync-gram-account` and tap
   **Add**.
3. Kino shows **Install Sync-Gram Cuenta**. Tap **See details** and read the lines in red, then **Install**.
   - *Will sync your data through its service: the plugin and its service can read it.* Kino says this of every sync
     provider. What Telegram can actually read here is in [What Telegram and the plugin can read](#what-telegram-and-the-plugin-can-read).

Install it on the phone and on the TV (Kino can also copy it to your paired devices by itself).

## 3. On the phone: set up and sign in

1. Open **Settings ▸ Settings for all profiles ▸ Sync ▸ Provider**. *Sync-Gram Cuenta* is listed there. Tap its
   **Set up** button. The plugin's page opens with three numbered steps.
2. **1. Open my.telegram.org:** tap **Get api_id and api_hash** if you still need them (step 1 of this guide).
3. **2. Create an app and copy the data:** paste your **api_id** and **api_hash** and tap **Save**.
   - The section *What this device keeps* explains that this device will hold a session of your whole Telegram
     account (see [Privacy and risks](#privacy-and-risks)).
4. **3. Sign in with your phone:** type **Your number** with the country code (for example `+57 300 1234567`) and
   tap **Send the code**.
   - The status says *Done: Telegram sends the code to your Telegram app on another device or by SMS.*
   - The code usually arrives **as a message from "Telegram" inside your Telegram app**, not as an SMS.
   - The number stays on this phone: it is never synced and never sent to another device.
5. **Code** and **Sign in** appear. Type the code and tap **Sign in**. The code is erased once used.
6. If your account has a **two-step password**, the status says so: type it in **Two-step password**, tap **Save**,
   then **Confirm the password**.
7. The status says *Done: signed in. You can now take the setup to your TV with Send settings.* From now on the
   phone's page shows *Connected to your account*.

Only now does **Send settings** appear on the provider's card: what goes to the TV is a setup that is known to work.
There is no key to create or type: Kino makes the sync key by itself.

Telegram ▸ Settings ▸ Devices now lists a new session for this phone. That is the plugin.

## 4. On the TV: receive the setup and scan the QR

The TV never asks you to type anything. With both devices on the same Wi-Fi:

1. On the **TV**, open **Settings ▸ Settings for all profiles ▸ Sync ▸ Provider** and tap **Receive settings** under
   *Sync-Gram Cuenta*. For a few minutes it shows a QR code, an address such as `192.168.1.23:38917` and a 6-digit
   code.
2. On the **phone**, on the same screen, tap **Send settings**:
   - point the camera at the TV's QR; or
   - tap **Type address** and type the last number of the address and the 6-digit code the TV shows, then **Send**.
   - The phone says *Sent. Confirm it on the other device.*
3. The TV asks **"Received for Sync-Gram Cuenta: apply?"** and lists what it will save (never the values). Tap
   **Apply**.
4. Without pressing anything else, the TV's plugin page shows a **QR** with *Scan this code with Telegram on your
   phone*. On the phone, open **Telegram ▸ Settings ▸ Devices ▸ Link Desktop Device** (some versions say **Link a
   device**) and scan it.
   - If your account has a two-step password, the TV uses the one the phone sent, by itself.
   - The QR renews itself every few seconds, and a new one appears by itself if it expires.
5. The TV shows *Connected to your account*. Telegram ▸ Settings ▸ Devices now lists a second session, the TV's own.

On different networks? On the phone's send screen choose **Another network** and type the words and the code the TV
shows: the receive screen opens a temporary internet route for that.

## 5. Turn the provider on

On each device, in **Settings ▸ Settings for all profiles ▸ Sync ▸ Provider**, turn on the switch of *Sync-Gram
Cuenta*. Kino asks **"Sync with Sync-Gram Cuenta?"**:

- local network sync turns off while you use this provider;
- if your Saved Messages already hold a copy from another device, it is combined with this device's data: nothing
  that only one of them has is lost.

Tap **Combine with this device**. The first sync runs at once, and your Saved Messages show a pinned file
`kino-sync.bin`. Do not delete or unpin it: it is what your other devices read.

From then on, Kino pulls when it comes to the front and every 10 minutes, and pushes about 5 minutes after something
changes. **Sync now** syncs right away. Each push sends a new file, pins it and deletes the previous copy, so Saved
Messages keep one copy.

## What Telegram and the plugin can read

- **Telegram stores only ciphertext.** Kino encrypts the copy (AES-256-GCM) before the plugin gets it. The file in
  your Saved Messages cannot be opened without the sync key.
- **The key is made by Kino and travels only between your devices.** Kino generates it (32 random bytes) when you turn
  the provider on or tap **Send settings**, keeps it sealed like a password, and hands it to your other devices with
  **Send settings** or through sync itself. It is never sent to Telegram. Unlike Sync-Gram (the bot version), the key
  does not come from anything Telegram knows.
- **The plugin** runs on your device, inside Kino. It is handed the copy already encrypted. It checks that a key
  exists but never sends it anywhere, and its own code can only reach Telegram's servers.
- **What is in the copy:** everything Kino syncs between your devices: library, history, progress and settings,
  plus your plugins and their settings. Passwords are included, sealed again inside the copy.
- **Each device has its own Telegram session.** The session of the phone is never copied to the TV (the TV signs in
  with its own QR), never synced, and never part of a Kino backup. It is stored sealed on the device.
- **What the plugin reads in Telegram:** only your Saved Messages, looking for its pinned `kino-sync.bin`.

### The two-step password

The TV cannot type, so the phone keeps your two-step password after its own sign-in, **sealed and device-only**:
never synced and never in a backup. **Send settings** carries it once to the TV, which uses it by itself for its QR
login and clears it at its next action. On the phone it goes away when you tap **Sign out**, or when a password check
fails. The number and the login code never leave the phone.

## Privacy and risks

- **An account session can do much more than a bot.** While signed in, each device holds a session of your **whole
  Telegram account**, the same kind a Telegram Desktop app has. The plugin itself only acts in Saved Messages: its
  allowlist refuses any request that names another chat, and it can only delete its own old copies there. But if the
  plugin's code or the device were compromised, that session could read or send your messages.
- **End a session whenever you want:** in Telegram ▸ Settings ▸ Devices, end the Kino session of that device. Or tap
  **Sign out** on the plugin's page on the phone. The synced data on your devices is not lost.
- **Lost a device?** End its session in Telegram ▸ Settings ▸ Devices right away.
- **Narrower alternative:** [Sync-Gram](https://github.com/kinotvapp/kino-plugin-sync-gram) uses a Telegram bot you
  create. A bot sees only its own chat, not your account. The trade-off: there, the key comes from the bot token, so
  Telegram could open the copy; here, it cannot.
- Your `api_id` and `api_hash` are yours: the plugin keeps them as sealed settings and they travel only to your own
  devices.

## Limits

- **4 MiB copy cap.** That is the most Kino lets a sync provider move. If your data grows past it, the sync stops with
  *your data is larger than the provider accepts*.
- **One pinned file.** Saved Messages keep one `kino-sync.bin`; older copies are deleted after each push.
- **Your account's flood limits.** Telegram limits how often an account may sign in or send requests. When it asks to
  wait (`FLOOD_WAIT`), the plugin stops and goes on by itself afterwards; it never retries a sign-in in a loop.
- **Login budget.** The plugin also limits sign-in attempts on each device, so a mistake can never hammer Telegram.

## Reset sync

**Reset sync** (on the provider's card, when Kino shows it) replaces the copy saved in Telegram with this device's.
Use it when the copy cannot be opened with this device's key, for example after the key was made twice on two
devices that were never given the same setup, or when the copy is damaged. Then give your other devices the setup
again with **Send settings**.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| *The code is not right: check it and tap Sign in again.* | Type the code exactly as Telegram sent it (digits only). |
| *The code expired: tap Send the code again.* | Codes last a few minutes. Tap **Send the code** and use the new one. |
| No code arrives | Look for a message from **Telegram** inside your Telegram app on another device or on this phone; SMS comes only if Telegram decides so. |
| *That number is not valid* | Enter it with the country code, for example `+57 300 1234567`. |
| *Telegram did not accept your api_id or api_hash* | Copy them again from my.telegram.org ▸ API development tools, then **Save**. |
| *Telegram asked to wait …* / *try again in N minutes* (`FLOOD_WAIT`) | Telegram limits sign-ins and requests per account. Wait the time shown; Kino goes on by itself. |
| *Too many sign-in attempts on this device* | The plugin's own budget. Wait the time shown. |
| *The password is not right* | Type the two-step password again, **Save**, then **Confirm the password**. |
| The TV says *The two-step password you received is not right* | On the phone type it again and tap **Send settings** again. |
| The TV shows no QR | Make sure the phone is signed in first (*Connected to your account*) and send the settings again. If the automatic attempt stopped, the TV shows **Sign in to Telegram with QR**: press it. |
| The TV says *Get the setup from another device* | Do [step 4](#4-on-the-tv-receive-the-setup-and-scan-the-qr). |
| **Send settings** does not appear on the phone | The phone is not signed in yet: finish [step 3](#3-on-the-phone-set-up-and-sign-in). |
| *Telegram closed this device's session* | You (or Telegram) ended it in Settings ▸ Devices. Sign in again: on the phone with **Send the code**, on the TV with **Sign in to Telegram with QR**. |
| *The token does not match, or the saved data is not Kino's*, with **Reset sync** | The pinned copy was made with another key. Send the settings from the device that syncs well to this one, or use **Reset sync** as explained above. |
| You deleted or unpinned `kino-sync.bin` by mistake | The next push saves this device's copy again; nothing on your devices is lost. |

## For plugin authors

- **Layout.** `src/` holds the ES modules; `npm run build` (`node scripts/build.mjs src/plugin.js plugin.js`) bundles
  them into `plugin.js`, the one file Kino loads (committed; a test fails when it is stale). The manifest is
  `kino-plugin.json`, the icon `icon.png`.
- **Tests.** `npm test` builds and runs `node --test test/*.test.mjs` under Kino's Node kit (`sdk/`) against a fake
  Telegram cluster (`testkit/`). No test reaches the network or needs a real account.
- **Vendored code.** The MTProto client in `src/mtproto/` and the fake cluster in `testkit/` come from
  [Video-Gram](https://github.com/kinotvapp/kino-plugin-video-gram) at `08d2dca` (MIT), with the local patches listed
  in [VENDORED.md](VENDORED.md).
- **The allowlist.** The client's `sync` mode refuses any method whose peer is not `inputPeerSelf`, and deletes only
  ids it saw in an answer about Saved Messages, never with revoke.
- **The manifest:** `"capabilities": ["syncProvider", "socket", "storageLarge"]`, the five `*.web.telegram.org` hosts,
  and `"sync": { "keySecret": "syncKey", "generateKey": true, "provision": ["syncKey", "api_id", "api_hash",
  "tg_password", "login_ok"], "maxBlobBytes": 4194304, ... }`.
- **Signature.** The manifest is signed for `kinotvapp/kino-plugin-sync-gram-account` with Kino's author key
  (`npm run sign`); `npm run validate` checks it. `contract.json` and `kino.d.ts` are Kino's plugin contract.

## Licence

MIT, see [LICENSE](LICENSE). The vendored client keeps Video-Gram's MIT licence and notice (see VENDORED.md).
