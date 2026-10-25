// The sync key (manifest: sync.keySecret = "syncKey", sync.generateKey = true): Kino makes it by itself (apiVersion 13),
// 32 random bytes as 64 lower-case hex characters, when the person switches the provider on or presses Enviar
// configuración, and derives the snapshot's encryption key from it on every device. The other devices receive it with
// Recibir configuración, together with api_id and api_hash. Kino never draws the field; this plugin never makes,
// stores, shows or logs the key, and only checks its shape (validateSettings).
export const KEY_SHAPE = /^[0-9a-f]{64}$/;
