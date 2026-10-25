// Account mode's texts for the person, in Spanish (neutral, tuteo) and English. `t(key, vars)` picks kino.lang's.
// Two kinds: status lines and action messages (shown as the plugin's own text, may name Telegram) and the round errors'
// userMessage (Kino shows those only under its rules: no brand names, no "kino"), the `say.*` keys.
const ES = {
  "status.ready": "Conectado con tu cuenta: la copia está en tus Mensajes guardados, fijada y en silencio.",
  "status.empty": "Conectado con tu cuenta. Aún no hay copia guardada: Kino la crea en la próxima sincronización.",
  "status.signin": "Falta iniciar sesión en este aparato: escribe tu número con el código de país y toca Enviar código.",
  "status.signin.tv": "Toca Iniciar sesión de Telegram con QR y escanea el código con Telegram en tu teléfono.",
  "status.closed": "Telegram cerró la sesión de este aparato (Ajustes ▸ Dispositivos). Vuelve a iniciar sesión con tu número: toca Enviar código.",
  "status.closed.tv": "Telegram cerró la sesión de esta TV (Ajustes ▸ Dispositivos). Toca Iniciar sesión de Telegram con QR para entrar otra vez.",
  "status.api_missing.phone": "Escribe tu api_id y tu api_hash de my.telegram.org y toca Guardar. Luego inicia sesión con tu número.",
  "status.api_missing.tv": "Recibe la configuración desde otro aparato: en el otro toca Enviar configuración y aquí Recibir configuración.",
  "status.nokey.tv": "Recibe la configuración desde otro aparato: en el otro toca Enviar configuración y aquí Recibir configuración.",
  "status.nokey": "Falta la clave: Kino la crea sola al activar la sincronización, o recíbela desde otro aparato.",
  "status.unsupported": "Esta versión de Kino no deja que el plugin se conecte con Telegram: actualiza Kino.",
  "status.wait": "Telegram pidió esperar {s} s. Kino sigue solo después.",
  "status.waitShort": "Telegram pidió esperar. Kino sigue solo después.",
  "status.unreachable": "No se pudo consultar Telegram ahora. Kino lo intentará de nuevo.",
  "status.password": "Tu cuenta tiene contraseña de dos pasos: escríbela arriba, toca Guardar y luego Confirmar la contraseña.",
  "status.password.tv": "Tu cuenta tiene contraseña de dos pasos: envíala desde tu celular con Enviar configuración; esta TV la usa sola.",
  "qr.already": "Ya iniciaste sesión con tu cuenta en este aparato.",
  "qr.scan": "En tu teléfono abre Telegram ▸ Ajustes ▸ Dispositivos ▸ Vincular un dispositivo y escanea el código.",
  "qr.scan.tv": "Escanea este código con Telegram en tu teléfono: Ajustes ▸ Dispositivos ▸ Vincular un dispositivo.",
  "qr.waiting": "Esperando que escanees el código con Telegram en tu teléfono.",
  "qr.waiting.tv": "Escanea este código con Telegram en tu teléfono: Ajustes ▸ Dispositivos ▸ Vincular un dispositivo.",
  "qr.phone": "En el celular inicia sesión con tu número: escríbelo y toca Enviar código.",
  "phone.sent": "Listo: Telegram te manda el código a tu app de Telegram en otro aparato o por SMS. Escríbelo en Código y toca Iniciar sesión.",
  "phone.enterCode": "Escribe el código que te mandó Telegram y toca Iniciar sesión.",
  "phone.done": "Listo: sesión iniciada. Ya puedes llevar la configuración a tu TV con Enviar configuración.",
  "phone.invalid": "Ese número no es válido: escríbelo con el código de país, por ejemplo +57 300 1234567.",
  "phone.noAccount": "Ese número no tiene cuenta de Telegram: créala primero en la app de Telegram.",
  "phone.unavailable": "Telegram no puede mandarte un código ahora: vuelve a intentarlo más tarde.",
  "phone.email": "Telegram quiere mandarle el código de esta cuenta a tu correo, y eso no se puede aquí: inicia sesión en la app de Telegram y vuelve a intentarlo.",
  "code.wrong": "El código no es correcto: revísalo y vuelve a tocar Iniciar sesión.",
  "code.expired": "El código venció: toca Enviar código otra vez.",
  "code.none": "Primero toca Enviar código: Telegram te manda uno nuevo.",
  "code.empty": "Escribe el código que te mandó Telegram y toca Iniciar sesión.",
  "pw.wrong.tv": "La contraseña de dos pasos que recibiste no es correcta: escríbela de nuevo en tu celular y vuelve a tocar Enviar configuración.",
  "qr.expired": "El código venció: toca Iniciar sesión de Telegram con QR otra vez.",
  "qr.done": "Listo: sesión iniciada. Kino solo usa tus Mensajes guardados para la copia.",
  "qr.failed": "No se pudo iniciar sesión ahora; vuelve a intentarlo.",
  "qr.budget": "Demasiados intentos de inicio de sesión en este aparato: vuelve a intentarlo en {min}.",
  "qr.flood": "Telegram pidió esperar: vuelve a intentarlo en {min}.",
  "qr.apiId": "Telegram no aceptó tu api_id o tu api_hash: revísalos en my.telegram.org.",
  "pw.notNeeded": "Telegram no está pidiendo una contraseña ahora.",
  "pw.empty": "Escribe primero la contraseña arriba y toca Guardar.",
  "pw.wrong": "La contraseña no es correcta: escríbela de nuevo, toca Guardar y luego Confirmar la contraseña.",
  "pw.budget": "Demasiados intentos de contraseña: vuelve a intentarlo en {min}.",
  "logout.done": "Listo: se cerró la sesión de tu cuenta en este aparato.",
  "logout.none": "No hay una sesión de tu cuenta en este aparato.",
  "minutes.one": "1 minuto",
  "minutes.many": "{n} minutos",
  "say.signin": "Falta iniciar sesión con tu cuenta en este aparato: ve a Configurar.",
  "say.closed": "Se cerró la sesión de tu cuenta en este aparato: vuelve a iniciarla en Configurar.",
  "say.api_missing": "Faltan el api_id y el api_hash de tu cuenta: ve a Configurar.",
  "say.wait": "Hay que esperar {s} s antes de la próxima copia. Se intentará solo.",
  "say.unsupported": "Esta versión no deja conectar este plugin: actualiza la app.",
  "field.apiId": "El api_id es un número: cópialo de my.telegram.org.",
  "field.apiHash": "El api_hash son 32 letras y números: cópialo de my.telegram.org.",
  "field.syncKey": "Esta clave la crea Kino sola: no la escribas tú, o recíbela desde otro aparato.",
  "field.code": "El código son solo números: cópialo del mensaje de Telegram.",
  "field.loginOk": "Esto lo llena Iniciar sesión: no lo cambies.",
  "say.big": "La copia es demasiado grande para guardarla.",
  "say.down": "No se pudo llegar al servicio ahora. Se intentará de nuevo.",
};
const EN = {
  "status.ready": "Connected to your account: the copy is in your Saved Messages, pinned and silent.",
  "status.empty": "Connected to your account. No copy saved yet: Kino makes it at the next sync.",
  "status.signin": "You still need to sign in on this device: enter your number with its country code and tap Send the code.",
  "status.signin.tv": "Tap Sign in to Telegram with QR and scan the code with Telegram on your phone.",
  "status.closed": "Telegram closed this device's session (Settings ▸ Devices). Sign in again with your number: tap Send the code.",
  "status.closed.tv": "Telegram closed this TV's session (Settings ▸ Devices). Tap Sign in to Telegram with QR to sign in again.",
  "status.api_missing.phone": "Enter your api_id and api_hash from my.telegram.org and tap Save. Then sign in with your number.",
  "status.api_missing.tv": "Get the setup from another device: on the other one tap Send settings, and here Receive settings.",
  "status.nokey.tv": "Get the setup from another device: on the other one tap Send settings, and here Receive settings.",
  "status.nokey": "The key is missing: Kino makes it by itself when you turn sync on, or receive it from another device.",
  "status.unsupported": "This Kino version does not let the plugin connect to Telegram: update Kino.",
  "status.wait": "Telegram asked to wait {s} s. Kino goes on by itself afterwards.",
  "status.waitShort": "Telegram asked to wait. Kino goes on by itself afterwards.",
  "status.unreachable": "Could not ask Telegram right now. Kino will try again.",
  "status.password": "Your account has a two-step password: type it above, tap Save, then Confirm the password.",
  "status.password.tv": "Your account has a two-step password: send it from your phone with Send settings; this TV uses it by itself.",
  "qr.already": "You are already signed in with your account on this device.",
  "qr.scan": "On your phone open Telegram ▸ Settings ▸ Devices ▸ Link Desktop Device and scan the code.",
  "qr.scan.tv": "Scan this code with Telegram on your phone: Settings ▸ Devices ▸ Link Desktop Device.",
  "qr.waiting": "Waiting for you to scan the code with Telegram on your phone.",
  "qr.waiting.tv": "Scan this code with Telegram on your phone: Settings ▸ Devices ▸ Link Desktop Device.",
  "qr.phone": "On the phone sign in with your number: enter it and tap Send the code.",
  "phone.sent": "Done: Telegram sends the code to your Telegram app on another device or by SMS. Type it in Code and tap Sign in.",
  "phone.enterCode": "Type the code Telegram sent you and tap Sign in.",
  "phone.done": "Done: signed in. You can now take the setup to your TV with Send settings.",
  "phone.invalid": "That number is not valid: enter it with its country code, for example +57 300 1234567.",
  "phone.noAccount": "That number has no Telegram account: create one in the Telegram app first.",
  "phone.unavailable": "Telegram cannot send you a code right now: try again later.",
  "phone.email": "Telegram wants to send this account's code to your email, which cannot be done here: sign in on the Telegram app and try again.",
  "code.wrong": "The code is not right: check it and tap Sign in again.",
  "code.expired": "The code expired: tap Send the code again.",
  "code.none": "First tap Send the code: Telegram sends you a new one.",
  "code.empty": "Type the code Telegram sent you and tap Sign in.",
  "pw.wrong.tv": "The two-step password you received is not right: type it again on your phone and tap Send settings again.",
  "qr.expired": "The code expired: tap Sign in to Telegram with QR again.",
  "qr.done": "Done: signed in. Kino only uses your Saved Messages for the copy.",
  "qr.failed": "Could not sign in now; try again.",
  "qr.budget": "Too many sign-in attempts on this device: try again in {min}.",
  "qr.flood": "Telegram asked to wait: try again in {min}.",
  "qr.apiId": "Telegram did not accept your api_id or api_hash: check them at my.telegram.org.",
  "pw.notNeeded": "Telegram is not asking for a password now.",
  "pw.empty": "Type the password above and tap Save first.",
  "pw.wrong": "The password is not right: type it again, tap Save, then Confirm the password.",
  "pw.budget": "Too many password attempts: try again in {min}.",
  "logout.done": "Done: your account's session on this device is closed.",
  "logout.none": "There is no session of your account on this device.",
  "minutes.one": "1 minute",
  "minutes.many": "{n} minutes",
  "say.signin": "You still need to sign in with your account on this device: go to Set up.",
  "say.closed": "Your account's session on this device was closed: sign in again in Set up.",
  "say.api_missing": "Your account's api_id and api_hash are missing: go to Set up.",
  "say.wait": "It has to wait {s} s before the next copy. It will try again by itself.",
  "say.unsupported": "This version cannot connect this plugin: update the app.",
  "field.apiId": "The api_id is a number: copy it from my.telegram.org.",
  "field.apiHash": "The api_hash is 32 letters and digits: copy it from my.telegram.org.",
  "field.syncKey": "Kino makes this key by itself: do not type it, or receive it from another device.",
  "field.code": "The code is digits only: copy it from Telegram's message.",
  "field.loginOk": "Sign in fills this in: do not change it.",
  "say.big": "The copy is too large to save.",
  "say.down": "Could not reach the service right now. It will try again.",
};
export const CATALOG = Object.freeze({ es: ES, en: EN });

const english = () => String(kino.lang || "es").toLowerCase().startsWith("en");
export function t(key, vars = {}) {
  const table = english() ? EN : ES;
  const text = table[key] ?? ES[key];
  if (text === undefined) throw new Error("no text " + key);
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
}
export const minutes = (seconds) => {
  const n = Math.max(1, Math.ceil((Number(seconds) || 60) / 60));
  return n === 1 ? t("minutes.one") : t("minutes.many", { n });
};
/** The status line for a missing session, by reason; the api line depends on the device (the TV has no api fields). */
export const missingLine = (reason) => {
  const tv = kino.device === "tv";
  if (reason === "api_missing") return t(tv ? "status.api_missing.tv" : "status.api_missing.phone");
  if (tv && (reason === "signin" || reason === "closed")) return t("status." + reason + ".tv");
  return t("status." + reason);
};
/** The missing-key line: on the TV the same "receive the setup" sentence as Kino's, never a setting's name. */
export const noKeyLine = () => t(kino.device === "tv" ? "status.nokey.tv" : "status.nokey");
