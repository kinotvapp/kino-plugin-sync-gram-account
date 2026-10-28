# Sync-Gram Cuenta: sincroniza tus aparatos de Kino a través de tu propia cuenta de Telegram

[Read in English](README.md)

> **No oficial: sin relación con Telegram.** Sync-Gram Cuenta es un plugin de Kino que habla con la API pública MTProto
> de Telegram usando tu propia cuenta; Telegram no lo hace, no lo respalda ni le da soporte.

Este repositorio es **Sync-Gram Cuenta** (id del plugin `sync-gram-account`), un **proveedor de sincronización de
Kino** que mantiene al día tu celular y tu TV (biblioteca, historial, progreso y ajustes) a través de **tu propia
cuenta de Telegram**. Kino cifra una copia de tus datos; el plugin guarda esa copia en tus **Mensajes guardados** como
un solo archivo, `kino-sync.bin`, fijado y enviado en silencio. Tus otros aparatos leen de vuelta el archivo fijado.

**No hay bot**, **no hay servidor de Kino** y **no hay servidor tuyo**: solo los servidores de Telegram (`pluto`,
`venus`, `aurora`, `vesta` y `flora` `.web.telegram.org`), que son las únicas direcciones a las que este plugin puede
llegar.

```
tu celular ─┐                                                        ┌─ tus Mensajes guardados
            ├─ MTProto por wss ─▶ *.web.telegram.org (tu cuenta) ──────┤    📌 kino-sync.bin  (la copia cifrada)
tu TV  ─────┘                                                        └─ (solo se guarda la copia más nueva)
```

Si prefieres no darle a un plugin una sesión de toda tu cuenta, usa **Sync-Gram**
([kinotvapp/kino-plugin-sync-gram](https://github.com/kinotvapp/kino-plugin-sync-gram)): hace lo mismo a través de un
bot de Telegram que creas tú, que ve mucho menos de tu cuenta (mira [Privacidad y riesgos](#privacidad-y-riesgos)).

## Lo que necesitas

- **Kino 0.9.74 o más nuevo** en todos tus aparatos. Las versiones anteriores no pueden usar este tipo de proveedor.
- **Una cuenta de Telegram**, con la app de Telegram en tu celular (la necesitas para recibir el código de inicio de
  sesión y para escanear el QR de la TV).
- **Tu propio `api_id` y tu `api_hash`** de <https://my.telegram.org> (gratis; el paso 1 explica cómo). Le identifican
  ante Telegram "una app" tuya. El plugin no trae los de nadie.
- **Tu número de teléfono** con el código de país, y el **código de inicio de sesión** que te manda Telegram.
- Tu **contraseña de dos pasos**, si tu cuenta tiene una (Telegram ▸ Ajustes ▸ Privacidad y seguridad ▸ Verificación
  en dos pasos).

## 1. Consigue tu api_id y tu api_hash

Puedes hacerlo en el mismo celular, desde el enlace **Obtener api_id y api_hash** del plugin (paso 3 de abajo), o en
un computador.

1. Abre <https://my.telegram.org> e inicia sesión con tu número. Telegram te manda un código **a tu app de Telegram**
   (no por SMS); escríbelo en la página.
2. Toca **API development tools**.
3. Si todavía no tienes una app, llena el formulario: **App title** y **Short name** pueden ser cualquier cosa (por
   ejemplo `Mi sincronizacion Kino` y `mikinosync`); la plataforma puede quedar como está. Créala.
4. La página muestra **App api_id** (un número) y **App api_hash** (32 letras y números). Deja esa página abierta, o
   copia los dos en un lugar privado.
   - Cuida el `api_hash` como una contraseña: no lo pegues en chats ni en capturas de pantalla.

## 2. Instala el plugin en Kino

1. En el celular, abre **Menú ▸ Plugins** y toca **+** (Agregar plugin). En la TV, abre **Plugins** y elige
   **Agregar plugin**.
2. Deja el tipo en **Kino**. En **Dirección del plugin**, escribe `kinotvapp/kino-plugin-sync-gram-account` y toca
   **Agregar**.
3. Kino muestra **Instalar Sync-Gram Cuenta**. Toca **Ver detalles**, lee las líneas en rojo y toca **Instalar**.
   - *Sincronizará tus datos a través de su servicio: el plugin y su servicio podrán leerlos.* Kino dice eso de todo
     proveedor de sincronización. Lo que Telegram puede leer de verdad aquí está en
     [Lo que pueden leer Telegram y el plugin](#lo-que-pueden-leer-telegram-y-el-plugin).

Instálalo en el celular y en la TV (Kino también puede copiarlo solo a tus aparatos emparejados).

## 3. En el celular: configura e inicia sesión

1. Abre **Ajustes ▸ Ajustes de todos los perfiles ▸ Sincronización ▸ Proveedor**. Ahí aparece *Sync-Gram Cuenta*.
   Toca su botón **Configurar**: se abre la pantalla propia del plugin, un paso a la vez (Kino 0.9.74 o posterior).
2. **Paso 1, los datos de tu app de Telegram:** toca **Abrir my.telegram.org** si todavía no los tienes (paso 1 de
   esta guía), pega tu **api_id** y tu **api_hash** en los dos campos ocultos y toca **Guardar**. Una forma
   equivocada se marca bajo el campo antes de guardar nada (el api_id es un número, el api_hash 32 letras y números).
   - La nota bajo el paso explica que este aparato guardará una sesión de toda tu cuenta de Telegram (mira
     [Privacidad y riesgos](#privacidad-y-riesgos)).
3. **Paso 2, tu número:** escríbelo con el código de país (por ejemplo `+57 300 1234567`) y toca **Enviar código**.
   El botón sigue apagado, y el campo muestra el error, hasta que el número tenga una forma válida.
   - Casi siempre el código llega **como un mensaje de "Telegram" dentro de tu app de Telegram**, no como SMS.
   - El número se queda en este celular: nunca se sincroniza ni se envía a otro aparato.
4. **Paso 3, el código:** escríbelo en el campo oculto y toca **Iniciar sesión**. El código nunca se guarda. **Usar
   otro número** vuelve al paso 2.
5. **Paso 4, contraseña de dos pasos:** solo si tu cuenta la tiene. Escríbela en el campo oculto y toca **Confirmar**.
   La contraseña queda cifrada en este aparato para que **Enviar configuración** la lleve una vez a la TV.
6. **Paso 5, conectado:** la pantalla dice *Conectado con tu cuenta*. **Revisar el estado** pregunta otra vez a
   Telegram y **Cerrar sesión** (con un segundo toque para confirmar) termina la sesión de este aparato y borra la
   contraseña.

Todo secreto (api_id, api_hash, el código, la contraseña) se escribe en un campo oculto; Kino no lo vuelve a mostrar,
no lo registra y no lo guarda en la pantalla. Toca un paso terminado para volver a él (los datos de la app o el número).
La pantalla se actualiza sola mientras está abierta; no hay nada que recargar.

Solo ahora aparece **Enviar configuración** en la tarjeta del proveedor: lo que va a la TV es una configuración que ya
se sabe que funciona. No hay clave que crear ni escribir: Kino crea sola la clave de sincronización.

En Telegram ▸ Ajustes ▸ Dispositivos ahora aparece una sesión nueva de este celular. Es la del plugin.

## 4. En la TV: recibe la configuración y escanea el QR

La TV nunca te pide escribir nada. Con los dos aparatos en el mismo Wi-Fi:

1. En la **TV**, abre **Ajustes ▸ Ajustes de todos los perfiles ▸ Sincronización ▸ Proveedor** y toca **Recibir
   configuración** debajo de *Sync-Gram Cuenta*. Durante unos minutos muestra un código QR, una dirección como
   `192.168.1.23:38917` y un código de 6 cifras.
2. En el **celular**, en esa misma pantalla, toca **Enviar configuración**:
   - apunta la cámara al QR de la TV; o
   - toca **Escribir dirección** y escribe el último número de la dirección y el código de 6 cifras que muestra la TV,
     y toca **Enviar**.
   - El celular dice *Enviado. Confírmalo en el otro aparato.*
3. La TV pregunta **"Recibido para Sync-Gram Cuenta: ¿aplicar?"** y muestra qué va a guardar (nunca los valores). Toca
   **Aplicar**.
4. Sin tocar nada más, la pantalla del plugin en la TV muestra un **QR** con *Escanea este código con Telegram en tu
   teléfono*. En el celular abre **Telegram ▸ Ajustes ▸ Dispositivos ▸ Vincular un dispositivo** (en algunas versiones
   dice **Vincular dispositivo de escritorio**) y escanéalo.
   - Si tu cuenta tiene contraseña de dos pasos, la TV usa sola la que mandó el celular.
   - El QR se renueva solo cada pocos segundos, y si vence aparece uno nuevo sin que hagas nada; si los intentos
     automáticos se detienen, aparece **Mostrar el código QR otra vez**.
5. La TV muestra *Conectado con tu cuenta* y **Cerrar sesión**. En Telegram ▸ Ajustes ▸ Dispositivos ahora hay una segunda sesión, la
   propia de la TV.

¿Están en redes distintas? En la pantalla de envío del celular elige **Otra red** y escribe las palabras y el código
que muestra la TV: la pantalla de recibir abre para eso una ruta temporal por internet.

## 5. Activa el proveedor

En cada aparato, en **Ajustes ▸ Ajustes de todos los perfiles ▸ Sincronización ▸ Proveedor**, activa el interruptor de
*Sync-Gram Cuenta*. Kino pregunta **"¿Sincronizar con Sync-Gram Cuenta?"**:

- la sincronización por red local se apaga mientras uses este proveedor;
- si tus Mensajes guardados ya tienen una copia de otro aparato, se combina con los datos de este: no se pierde nada
  que solo uno de los dos tenga.

Toca **Combinar con este aparato**. La primera sincronización corre enseguida, y en tus Mensajes guardados aparece un
archivo fijado `kino-sync.bin`. No lo borres ni lo desfijes: es lo que leen tus otros aparatos.

Desde ahí, Kino trae los datos cuando pasa al frente y cada 10 minutos, y envía unos 5 minutos después de que algo
cambia. **Sincronizar ahora** sincroniza en el momento. Cada envío manda un archivo nuevo, lo fija y borra la copia
anterior, así que en Mensajes guardados queda una sola copia.

## Lo que pueden leer Telegram y el plugin

- **Telegram solo guarda datos cifrados.** Kino cifra la copia (AES-256-GCM) antes de que el plugin la reciba. El
  archivo de tus Mensajes guardados no se puede abrir sin la clave de sincronización.
- **La clave la crea Kino y solo viaja entre tus aparatos.** Kino la genera (32 bytes al azar) cuando activas el
  proveedor o tocas **Enviar configuración**, la guarda sellada como una contraseña y la pasa a tus otros aparatos con
  **Enviar configuración** o por la misma sincronización. Nunca se envía a Telegram. A diferencia de Sync-Gram (la
  versión con bot), la clave no sale de nada que Telegram conozca.
- **El plugin** corre en tu aparato, dentro de Kino. Recibe la copia ya cifrada. Revisa que la clave exista, pero
  nunca la envía a ningún lado, y su propio código solo puede llegar a los servidores de Telegram.
- **Lo que va en la copia:** todo lo que Kino sincroniza entre tus aparatos: biblioteca, historial, progreso y
  ajustes, además de tus plugins y sus ajustes. Las contraseñas van incluidas, selladas otra vez dentro de la copia.
- **Cada aparato tiene su propia sesión de Telegram.** La sesión del celular nunca se copia a la TV (la TV entra con
  su propio QR), nunca se sincroniza y nunca entra en una copia de seguridad de Kino. Se guarda sellada en el aparato.
- **Lo que el plugin lee en Telegram:** solo tus Mensajes guardados, buscando su `kino-sync.bin` fijado.

### La contraseña de dos pasos

La TV no puede escribir, así que el celular conserva tu contraseña de dos pasos después de su propio inicio de
sesión, **sellada y solo en ese aparato**: nunca se sincroniza ni entra en una copia de seguridad. **Enviar
configuración** la lleva una vez a la TV, que la usa sola para su inicio de sesión con QR y la borra en su siguiente
acción. En el celular se va cuando tocas **Cerrar sesión**, o cuando falla una comprobación de la contraseña. El número
y el código de inicio de sesión nunca salen del celular.

## Privacidad y riesgos

- **Una sesión de cuenta puede hacer mucho más que un bot.** Mientras tiene la sesión iniciada, cada aparato guarda
  una sesión de **toda tu cuenta de Telegram**, del mismo tipo que la de Telegram Desktop. El plugin solo actúa en
  Mensajes guardados: su lista de permitidos rechaza cualquier petición que nombre otro chat, y allí solo puede borrar
  sus propias copias viejas. Pero si el código del plugin o el aparato se vieran comprometidos, esa sesión podría leer
  o enviar tus mensajes.
- **Cierra una sesión cuando quieras:** en Telegram ▸ Ajustes ▸ Dispositivos, termina la sesión de Kino de ese aparato.
  O toca **Cerrar sesión** en la pantalla del plugin en el celular. Los datos sincronizados en tus aparatos no se
  pierden.
- **¿Perdiste un aparato?** Termina su sesión enseguida en Telegram ▸ Ajustes ▸ Dispositivos.
- **Alternativa más acotada:** [Sync-Gram](https://github.com/kinotvapp/kino-plugin-sync-gram) usa un bot de Telegram
  que creas tú. Un bot ve solo su propio chat, no tu cuenta. A cambio: allí la clave sale del token del bot, así que
  Telegram podría abrir la copia; aquí no puede.
- Tu `api_id` y tu `api_hash` son tuyos: el plugin los guarda como ajustes sellados y solo viajan a tus propios
  aparatos.

## Límites

- **Tope de 4 MiB por copia.** Es lo máximo que Kino deja mover a un proveedor de sincronización. Si tus datos pasan
  de eso, la sincronización se detiene con *tus datos superan el tamaño que admite el proveedor*.
- **Un solo archivo fijado.** En Mensajes guardados queda un `kino-sync.bin`; las copias viejas se borran después de
  cada envío.
- **Los límites de tu cuenta (flood).** Telegram limita cada cuánto una cuenta puede iniciar sesión o hacer
  peticiones. Cuando pide esperar (`FLOOD_WAIT`), el plugin se detiene y sigue solo después; nunca repite un inicio de
  sesión en bucle.
- **Cupo de inicios de sesión.** El plugin también limita los intentos de inicio de sesión en cada aparato, para que
  un error nunca sature a Telegram.

## Restablecer sincronización

**Restablecer sincronización** (en la tarjeta del proveedor, cuando Kino lo muestra) reemplaza la copia guardada en
Telegram por la de este aparato. Úsalo cuando la copia no se puede abrir con la clave de este aparato, por ejemplo
cuando la clave se creó dos veces en dos aparatos que nunca recibieron la misma configuración, o cuando la copia está
dañada. Después vuelve a pasar la configuración a tus otros aparatos con **Enviar configuración**.

## Si algo falla

| Lo que ves | Qué hacer |
| --- | --- |
| *El código no es correcto: revísalo y vuelve a tocar Iniciar sesión.* | Escribe el código tal cual te lo mandó Telegram (solo números). |
| *El código venció: toca Enviar código otra vez.* | Los códigos duran pocos minutos. Toca **Enviar código** y usa el nuevo. |
| No llega ningún código | Búscalo como mensaje de **Telegram** dentro de tu app de Telegram, en otro aparato o en este celular; el SMS llega solo si Telegram lo decide. |
| *Ese número no es válido* | Escríbelo con el código de país, por ejemplo `+57 300 1234567`. |
| *Telegram no aceptó tu api_id o tu api_hash* | Cópialos otra vez de my.telegram.org ▸ API development tools y toca **Guardar**. |
| *Telegram pidió esperar …* / *vuelve a intentarlo en N minutos* (`FLOOD_WAIT`) | Telegram limita los inicios de sesión y las peticiones de cada cuenta. Espera el tiempo que dice; Kino sigue solo. |
| *Demasiados intentos de inicio de sesión en este aparato* | Es el cupo del propio plugin. Espera el tiempo que dice. |
| *La contraseña no es correcta* | Escribe otra vez la contraseña de dos pasos en el paso 4 y toca **Confirmar**. |
| La TV dice *La contraseña de dos pasos que recibiste no es correcta* | En el celular escríbela otra vez y vuelve a tocar **Enviar configuración**. |
| La TV no muestra ningún QR | Revisa primero que el celular tenga la sesión iniciada (*Conectado con tu cuenta*) y vuelve a enviar la configuración. Si el intento automático se detuvo, la TV muestra **Iniciar sesión de Telegram con QR**: tócalo. |
| La TV dice *Recibe la configuración desde otro aparato* | Haz el [paso 4](#4-en-la-tv-recibe-la-configuración-y-escanea-el-qr). |
| **Enviar configuración** no aparece en el celular | El celular todavía no inició sesión: termina el [paso 3](#3-en-el-celular-configura-e-inicia-sesión). |
| *Telegram cerró la sesión de este aparato* | Tú (o Telegram) la terminaron en Ajustes ▸ Dispositivos. Vuelve a iniciar sesión: en el celular con **Enviar código**, en la TV con **Iniciar sesión de Telegram con QR**. |
| *El token no coincide o los datos guardados no son de Kino*, con **Restablecer sincronización** | La copia fijada se hizo con otra clave. Envía la configuración desde el aparato que sincroniza bien a este, o usa **Restablecer sincronización** como se explica arriba. |
| Borraste o desfijaste `kino-sync.bin` por error | El siguiente envío guarda otra vez la copia de este aparato; no se pierde nada de tus aparatos. |

## Para autores de plugins

- **Estructura.** `src/` tiene los módulos ES; `npm run build` (`node scripts/build.mjs src/plugin.js plugin.js`) los
  junta en `plugin.js`, el único archivo que carga Kino (va en el repositorio; una prueba falla si quedó viejo). El
  manifiesto es `kino-plugin.json` y el ícono `icon.png`.
- **Pruebas.** `npm test` compila y corre `node --test test/*.test.mjs` con el kit de Node de Kino (`sdk/`) contra un
  clúster de Telegram falso (`testkit/`). Ninguna prueba sale a la red ni necesita una cuenta real.
- **Código copiado.** El cliente MTProto de `src/mtproto/` y el clúster falso de `testkit/` vienen de
  [Video-Gram](https://github.com/kinotvapp/kino-plugin-video-gram) en `08d2dca` (MIT), con los parches locales que
  lista [VENDORED.md](VENDORED.md).
- **La lista de permitidos.** El modo `sync` del cliente rechaza cualquier método cuyo destino no sea `inputPeerSelf`,
  y solo borra ids que vio en una respuesta sobre Mensajes guardados, nunca con revoke.
- **El manifiesto:** `"capabilities": ["syncProvider", "socket", "storageLarge"]`, los cinco hosts
  `*.web.telegram.org` y `"sync": { "keySecret": "syncKey", "generateKey": true, "provision": ["syncKey", "api_id",
  "api_hash", "tg_password", "login_ok"], "maxBlobBytes": 4194304, ... }`.
- **Firma.** El manifiesto está firmado para `kinotvapp/kino-plugin-sync-gram-account` con la llave de autor de Kino
  (`npm run sign`); `npm run validate` la revisa. `contract.json` y `kino.d.ts` son el contrato de plugins de Kino.

## Licencia

MIT, mira [LICENSE](LICENSE). El cliente copiado conserva la licencia MIT y el aviso de Video-Gram (mira VENDORED.md).
