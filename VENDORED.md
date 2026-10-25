# Vendored code

The MTProto client under `src/mtproto/` and the fake Telegram cluster under `testkit/` are copied, not written here.

- **Upstream:** Video-Gram (plugin id `video-gram`), https://github.com/kinotvapp/kino-plugin-video-gram.
- **Commit:** `08d2dca` ("0.3.1: the 2FA password setting has sync: false ..."), the parent of the public `1.0.0`
  (`658a49c`); checked locally with `git merge-base --is-ancestor 08d2dca 658a49c`.
- **Copied with** `git archive 08d2dca` from a local clone, so uncommitted work in that tree never comes along.

## The rule

**Change it in the source, re-vendor by commit.** A fix or a feature in a vendored file goes into the upstream (Video-Gram) repository
first, gets a commit there, and is copied here again from that commit (this file then names the new commit). Never edit a
vendored file here and leave it at that: two copies that drift apart are two clients to keep secure.

The only exception is the short list of local patches below, each one written so it can go upstream as it is. When
Video-Gram takes them, they leave this list.

## What is vendored

| Here | From `08d2dca` |
| --- | --- |
| `src/mtproto/{bytes,big,crypto,errors,tl,msgid,keys,transport,session,authkey,srp,client,requests}.js` | `src/mtproto/` (same names) |
| `src/mtproto/schema/{reader,generated}.js` | `src/mtproto/schema/` |
| `scripts/build.mjs` | `scripts/build.mjs` |
| `testkit/{fake-dc,fake-ws,server-transport,tl-serializer,fake-account,session-open,kino}.mjs` | `testkit/` |

Not vendored (the Library's own reading code, not needed to sync): `discovery.js`, `account-library.js`, `index.js`,
`src/shell/`, the Library's plugin entry and its tests.

## Local patches (to upstream)

1. `src/mtproto/client.js`: a third mode `sync` (Sync-Gram Cuenta's). It signs in like `account` (QR, 2FA, log
   out) and its `call` allowlist is `SYNC_CALLS`; in that mode a method that names a peer is refused unless the peer is
   `inputPeerSelf`, read from the body's bytes, and `messages.deleteMessages` (which names no peer) is accepted only
   without revoke and only for ids the client itself saw in an answer about Saved Messages (a self search, or the
   sendMedia that made the copy); `call` in sync mode sends `messages.sendMedia` with no retry on a closed socket.
   Its login list (never `call`) adds the phone sign-in, `auth.sendCode` and `auth.signIn` (`phoneSendCode`,
   `phoneSignIn`, following PHONE_MIGRATE/NETWORK_MIGRATE, never retried); account mode's login list is unchanged.
2. `testkit/kino.mjs`: inside Kino's own repository the import of the kit shim points at `plugins/sdk/`. In this
   published repository the kit sits in `sdk/`, as in Video-Gram, so the file is upstream's as it is.

Also MIT: Video-Gram is published under the MIT licence, Copyright (c) 2026 kinotvapp (see its `LICENSE`); the vendored
files keep that licence and that notice, the same as this repository's [LICENSE](LICENSE).

Ours, not vendored (they live next to vendored files because that is where they would go upstream):
`src/mtproto/sync-requests.js` (the `sync` allowlist and its self-only serializers), `src/mtproto/phone-requests.js`
(the phone sign-in's two methods and the auth.SentCode reader) and `testkit/fake-saved.mjs` (Saved
Messages for the fake account).

Everything else is Sync-Gram Cuenta's own: `src/plugin.js` (the entry, bundled into `plugin.js` by
`scripts/build.mjs`), `src/account/` (the rounds, the session, the QR login, the sync key and the texts),
`scripts/measure.mjs`, `test/`.
