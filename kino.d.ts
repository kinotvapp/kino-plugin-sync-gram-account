// TypeScript declarations for Kino plugins (apiVersion 1 to 13; 13 adds the socket capability (kino.ws, outbound WebSockets) and the byteSource capability (a stream whose bytes the plugin serves through its read export) and the storageLarge capability (a 16 MiB kino.storage for a plugin that keeps a catalog) and the catalog capability (kino.catalog, a searchable SQLite catalog of up to 100,000 items per plugin in a 64 MiB file) and the qrScan capability (kino.qr.scan, the phone's camera scanner for a QR code) and the settings form's qr setting (a QR whose text settingsStatus gives, refreshed every refreshMs) and the kino.crypto operations aesIge, modPow, gunzip, convert and aesIgeVerify and the imageSource capability (a poster, backdrop, still or hero image the plugin serves through its image export, KinoImageRef); 12 adds the syncProvider capability (syncPull, syncPush, syncStatus and the manifest's sync block); 11 adds the externalResolve capability (a stream's `external` hand-off to a resolver app, the manifest's externalResolver) and, from Kino 0.9.66, a stream's advisory `media` and its `portable` universal copy; 10 adds the playlists capability; 9 adds the player panel (panel, panelAction, playerEvent, the manifest's panel and settingsLayout), fetchHosts "any" for hand-written plugins, English setting texts and kino.meta by title; 8 adds the audio item kinds music and podcast; 7 adds tracking and segments; apiVersion 5 only adds the manifest's signature, 6 the plain-plugin SDK: typed and larger secrets, migrate, signed streams, the settings form, debug, telemetry, section, categories, theme and scopedSearch). Reference them from plugin.js
// with `/// <reference path="./kino.d.ts" />` for editor help; Kino itself runs plain JavaScript.
// The numbers in the comments come from contract.json, which is authoritative. The app checks that
// every `kino` member declared here exists in its runtime and nothing else does (KinoDtsTest).

// ---------- what your functions receive and return ----------

/**
 * `search(query)`: `type` is a hint, never a filter. `cursor` is null on the first page. `"music"` and `"podcast"`
 * (apiVersion 8) when Kino leans towards audio; `"any"` includes them.
 */
interface KinoSearchQuery {
  q: string;
  type: "movie" | "series" | "music" | "podcast" | "any";
  year: number;
  season: number;
  episode: number;
  tmdbId: number;
  /** TMDB's original title when it differs from `q`, else "". */
  originalTitle: string;
  /** Other known titles, at most 5, each at most 200 characters. */
  altTitles: string[];
  cursor: string | null;
  /**
   * apiVersion 6, capability "scopedSearch": the browse `ref` of the "Ver más" page the person searches inside (a Home
   * row, a section row, a category), exactly as you gave it; absent on a plain search. Return null when you cannot
   * search there: Kino then filters the page's loaded titles itself.
   */
  within?: string;
}

interface KinoItem {
  /** ^[A-Za-z0-9._~-]{1,128}$, stable: the library keys the title by it. */
  id: string;
  /** Your own opaque reference, at most 4096 characters. */
  ref: string;
  title: string;
  /**
   * `"live"` needs `"apiVersion": 2` (a v1 plugin's live item is dropped): a live channel, whose
   * `ref` goes to `resolve` and plays as live straight from its card, with an "EN VIVO" badge; it
   * has no `runtimeMinutes` (ignored) and no episodes, is never saved to the library, never resumed
   * and never downloaded.
   *
   * `"music"` (an album, playlist or single track) and `"podcast"` (a show or an audiobook) need `"apiVersion": 8`
   * (below it they are dropped, with a log line, and the rest of the answer stays) and NOT the `episodes` capability.
   * With `episodes` declared, Kino calls `episodes(ref)` with an audio item's `ref` for its tracks or episodes (a single
   * track answers one entry: `number` = track number, `still` = cover, `runtimeMinutes`), each entry's `ref` going to
   * `resolve`; without it, the item's own `ref` goes straight to `resolve` and plays as one track, like a movie's.
   * `runtimeMinutes` is kept.
   */
  kind: "movie" | "series" | "live" | "music" | "podcast";
  /**
   * apiVersion 8, `music` and `podcast` only: the artist (music) or the host/author (podcast). Trimmed, at most 200
   * characters; ignored on any other kind. The album or podcast page shows it as the line under the title; without it
   * there is no such line (Kino never guesses one from `overview` or `genres`).
   */
  artist?: string;
  year?: string | number;
  /**
   * http or https, at most 2048 characters; a public name or a public IPv4 address, never the home network or a local name
   * (over http not even a name without a dot), except the person's own server. apiVersion 13 with "imageSource": or an
   * image reference ({@link KinoImageRef}) whose bytes your `image` export serves.
   */
  poster?: string | KinoImageRef;
  /** Like `poster`: a URL, or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  backdrop?: string | KinoImageRef;
  overview?: string;
  originalTitle?: string;
  /** At most 5, each at most 30 characters. */
  genres?: string[];
  /** 0..10 */
  rating?: number;
  /** 1..1000; ignored on a `live` item. */
  runtimeMinutes?: number;
  ids?: { tmdb?: number; /** ^tt\d{5,10}$ */ imdb?: string };
  lang?: string;
  quality?: string;
  /** At most 3, each at most 20 characters; shown as chips. */
  badges?: string[];
  /** apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental). Below apiVersion 6 it is dropped. */
  adult?: boolean;
}

/** A Home row. `ref` needs the `browse` capability: the row gets "Ver más", which calls browse(ref, null). */
type KinoGenre =
  | "peliculas" | "series" | "anime" | "infantil" | "documentales"
  | "deportes" | "noticias" | "musica" | "entretenimiento" | "otros";

interface KinoRow {
  id: string;
  title: string;
  /**
   * Items of kind "live" (channels) stay in a Home row from apiVersion 6, as channel cards with the "En vivo" badge
   * that open like a channel from En vivo (a 18+ one only while the person's code is unlocked); below 6 they are
   * dropped from Home. A row left with nothing to show is not shown.
   */
  items: KinoItem[];
  ref?: string;
  /**
   * What the row (or category, or list) is about, from Kino's closed vocabulary: "peliculas", "series", "anime",
   * "infantil", "documentales", "deportes", "noticias", "musica", "entretenimiento" or "otros". Kino groups Categorías
   * by it and filters En vivo by it across plugins. Optional: without it Kino guesses from the title; a value outside
   * the list is ignored. Kino versions before this field ignore it.
   */
  genre?: KinoGenre;
}

/** `next` (at most 2048 characters, opaque) needs the `browse` capability; the app passes it back as the cursor. */
interface KinoPage {
  items: KinoItem[];
  next?: string;
}

interface KinoEpisode {
  /** 1..999, default 1. */
  season?: number;
  /** 1..99999 */
  number: number;
  ref: string;
  title?: string;
  /** Like an item's `poster`: a URL, or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  still?: string | KinoImageRef;
  overview?: string;
  /** YYYY-MM-DD. Since Kino 0.9.55 shown under the episode in the list (phone and TV), worded in the app's language. */
  airDate?: string;
  /** 1..1000. Since Kino 0.9.55 shown under the episode in the list, next to `airDate` ("12 mar 2024 · 48 min"). */
  runtimeMinutes?: number;
}

interface KinoSeriesInfo {
  title?: string;
  /** Like an item's: a URL, or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  poster?: string | KinoImageRef;
  backdrop?: string | KinoImageRef;
  overview?: string;
  genres?: string[];
  year?: string | number;
  /** Kino 0.9.54: 0 to 10, like an item's. */
  rating?: number;
  /** `tmdb`, `imdb`; Kino 0.9.54: also an anime's `mal`, `anilist`, `kitsu` (whole numbers), for AniList and meta plugins. */
  ids?: { tmdb?: number; imdb?: string; mal?: number; anilist?: number; kitsu?: number };
  /** Kino 0.9.54: a movie's length (in a `details` answer); a series' is per episode and ignored. */
  runtimeMinutes?: number;
}

/**
 * One season of a series, for a source that keeps each season as its own `series` item: that item's
 * `id` and `ref` (`episodes(ref)` lists it). `title` is what the season selector shows ("Temporada 2");
 * `current` marks the season whose episodes came in the same answer (Kino also recognizes it by `id`).
 */
interface KinoSeason {
  /** The season's own item id, same pattern as an item id. */
  id: string;
  /** The season's own series ref, at most 4096 characters. */
  ref: string;
  title: string;
  /** 1..999; leave it out when the source has no numbering. */
  number?: number;
  current?: boolean;
}

interface KinoEpisodes {
  series?: KinoSeriesInfo;
  episodes: KinoEpisode[];
  /**
   * Only when each season is a separate item: every season of the show, this one included, at most
   * 50. Leave it out when `episodes` already holds every season (Kino reads the seasons from them).
   */
  seasons?: KinoSeason[];
}

interface KinoStream {
  /**
   * https on a declared host (http only on one declared `insecureHttp`), or the person's own server exactly as typed.
   * A live channel's stream of a plugin approved for `"liveStreamHosts": "any"` may be on any public host, http or https.
   * Ignored when `external` is given instead (apiVersion 11): then `url` may be omitted or left empty.
   */
  url: string;
  mime?: string;
  /**
   * Sent with every request the player makes for this stream (and, for a plugin that declares the
   * `download` capability, with the request that saves it to the device). At most 20.
   */
  headers?: Record<string, string>;
  subtitles?: { lang: string; url: string; format?: "vtt" | "srt" }[];
  /**
   * Separately-hosted audio tracks (a dub, an alternate mix), at most 8: Kino plays your video with
   * each merged in as its own track, offered and auto-picked by the person's audio-language
   * preference exactly like the container's own. `lang` is a short code like `subtitles`' (up to 16
   * characters; blank becomes `"und"`); `label`, if given (up to 40 characters), is shown verbatim
   * instead of a name guessed from `lang`. Checked the same way as `subtitles`: https on a declared
   * host, or the person's own server exactly as typed; a bad entry is dropped and the rest survive,
   * and so is a `url` already listed (the first entry wins). Ignored for a `live` item's stream: a
   * channel's other languages go inside its manifest.
   */
  audioTracks?: { lang: string; url: string; label?: string }[];
  /** Ignored for a `live` item's stream: a channel has no length. */
  durationMs?: number;
  /** 30..86400: after that long, a failed playback calls resolve() once more. */
  expiresInSeconds?: number;
  /**
   * apiVersion 2, and only with the `drm` capability declared: the stream is Widevine-protected and
   * Kino fetches its license from `licenseUrl` (checked exactly like `url`: https on a declared host, http only on one declared `insecureHttp`)
   * sending `licenseHeaders` (filtered like `headers`, at most 20) with the license request only.
   * Without the capability any DRM-shaped key refuses the stream. A protected title never downloads.
   * Kino negotiates Widevine at security level L3 (software), and only when the device confirms L3:
   * the license server must allow it. `audioTracks` next to `drm` are played clear (no license for
   * them): plain, unencrypted files only.
   */
  drm?: { type: "widevine"; licenseUrl: string; licenseHeaders?: Record<string, string> };
  /**
   * apiVersion 6: `"request"` makes Kino sign every playlist and segment request of this stream with your
   * `sign()` export, right before sending it, through a local proxy. HLS only (an HLS `mime` or a `.m3u8`
   * path); never with `drm` or `audioTracks`; not on an inline `liveChannels` stream (use `resolve()`).
   */
  signing?: "request";
  /**
   * apiVersion 6, with `signing`: up to 4096 characters `sign()` gets back as `context` (it can't read kino.storage).
   * Never a `kino.secret()` marker (refused): a marker only works in the runtime that made it, so call
   * `kino.secret()` inside `sign()` itself.
   */
  signContext?: string;
  /**
   * apiVersion 6, with `signing`: other hosts serving this same stream at the same path and scheme, up
   * to 6, each `"host"` or `"host:port"` (no scheme, no path, no IPv6). Kino tries the playlist on each
   * (3 rounds, the one that served last first) and moves a segment, key or map to another one when its
   * own fails 3 times. `sign()` always gets the URL of the host being asked, so pick that host's token
   * from `context`. Each entry meets the same host rule as `url` (declared hosts, or any public host
   * under `liveStreamHosts: "any"`); one that fails it, repeats `url`'s host or another entry, or comes
   * after the sixth is dropped. Not an array of strings: the stream is refused. Ignored without `signing`.
   */
  alternateHosts?: string[];
  /**
   * apiVersion 6: this copy's short name, e.g. "Latino · Streamwish", shown in the player's "Servidor" menu (phone and
   * TV) and in logs. Trimmed; at most 48 characters, no control characters, or it is dropped (the copy still plays).
   * Ignored below apiVersion 6.
   */
  label?: string;
  /**
   * Other copies of the same video, best first, at most 8: when `url` cannot play on the device (a codec it lacks, a broken
   * file) or is gone, Kino moves on to the next one by itself, at the same spot, before showing any error. Each is checked
   * exactly like `url`, `mime` and `headers`; a bad entry is dropped. They share this stream's subtitles and audio tracks.
   * Ignored next to `drm`, with `signing` (use `alternateHosts`) and for a live channel.
   *
   * apiVersion 6: each may carry a `label` (same rules as the Stream's), and may be `{ label, ref }` instead of a URL: a
   * lazy copy. `ref` (a non-blank string of at most 512 characters) goes to your `resolve(ref)` ONLY when that copy is
   * needed -- the person picks it in the "Servidor" menu, the automatic fallback reaches it, or a download's copy choice
   * probes it within its 30 s budget. That call is a normal `resolve` (same time limit, same checks,
   * `kino.browser.capture` allowed); only its `url`, `headers`, `mime`, `subtitles`, `expiresInSeconds` and `skip` are
   * used, never its own `alternatives`. Its `skip` applies while that copy plays and is never saved (the Stream's `skip`
   * stays the episode's). A failure moves on to the next copy. Below apiVersion 6 a ref-only entry has no `url` and is
   * dropped.
   */
  alternatives?: KinoStreamAlternative[];
  /**
   * Where THIS file's opening and ending are, in ms from its start: Kino's "Saltar intro" shows from
   * `openingStartMs` (0 when left out or null) to `openingEndMs`, "Saltar outro" from `endingStartMs`. Each a
   * finite number in 0..`durationMs` (0..86 400 000 without `durationMs`); the opening needs its end,
   * after its start; the ending not before the opening's end. A bad part is dropped, never the stream.
   * A person's hand correction wins over it; it wins over AniSkip. Ignored for a live channel.
   */
  skip?: { openingStartMs?: number; openingEndMs?: number; endingStartMs?: number };
  /**
   * apiVersion 11: instead of a playable `url`, hand this stream to an independently-installed app that declares it
   * can resolve `protocol` (Kino never interprets `protocol` or `ref` itself). `ref` is opaque, 1..2048 characters,
   * never logged in full. When `external` is present, `url` is ignored. See the External Source Resolver guide.
   */
  external?: {
    protocol: string;
    ref: string;
    /**
     * Android package of the one resolver app this stream wants. Overrides the manifest's `externalResolver.package`.
     * Kino asks only that app (the person still has to allow it) and never another one in its place; if it isn't
     * installed and the manifest doesn't name a download for it, the stream fails.
     */
    resolver?: string;
  };
  /**
   * Kino 0.9.66, optional and ADVISORY: what you know about the file itself. Kino shows and logs it and may use it as a
   * hint (for a cast), never for anything that could harm the person. Every field is optional; text is one line cut at 120
   * characters (`codec`/`container` 40, `language` 20), numbers are clamped, at most 16 tracks and 4 `notes`; an object with
   * nothing usable left is dropped, and a bad `media` never refuses the stream. Older Kino ignores it.
   */
  media?: KinoStreamMedia;
  /**
   * Kino 0.9.66, optional: a universal copy of THIS video, for a source that can make one on demand (an external resolver app
   * that converts): HLS, H.264 8-bit up to 1080p, stereo AAC, playable by any TV receiver. Checked exactly like `url`
   * (anything else, a non-HLS `mime` included, drops it and the rest still counts); ignored next to `drm`, request signing or
   * `external`. The phone's own player never uses it; Kino casts it when the title's own cast route needs a conversion or the
   * stream is likely not playable as it is. See the External Source Resolver guide.
   */
  portable?: { url: string; mime?: "application/x-mpegURL" | "application/vnd.apple.mpegurl" };
}

/**
 * apiVersion 13, capability "byteSource": a stream whose bytes the plugin itself serves, instead of a URL. Kino pulls them
 * by calling the plugin's `read` export (see `KinoPlugin.read`). `handle` is opaque to Kino (1..512 characters, the plugin
 * decides what it means); `size` is the total byte length; `mime` the media type (e.g. "video/mp4"). It casts to a
 * Chromecast or a DLNA TV (served from the phone over the LAN, every byte still from `read`) when `mime` is a video or audio
 * file type other than MPEG-TS; it is never downloaded (declaring "download" is pointless for such streams).
 */
interface KinoPluginByteStream {
  source: "plugin";
  handle: string;
  size: number;
  mime: string;
}

/**
 * apiVersion 13, capability "imageSource": a picture whose bytes your plugin serves, instead of a URL. Accepted wherever
 * an item's `poster` or `backdrop`, an episode's `still`, a series' (or `details`') `poster`/`backdrop` or a section hero's
 * `image` is read; anywhere else (a channel logo, a category's art, a `meta` answer, a layout image), and from a plugin
 * that does not declare "imageSource", it is ignored like a bad URL. `handle` is yours and opaque to Kino: 1 to 512
 * characters, no control characters (a malformed reference is simply no image, the item stays).
 *
 * When a card with such an image comes on screen, Kino calls your `image({ handle })` export ({@link KinoPlugin.image}),
 * at most one call at a time for your plugin, never while one of your byte streams is open or your `read` runs (it waits
 * for that to end, at most 20 s), and keeps the picture in its image cache: the same handle of the same installed version is asked once.
 * Make handles stable (the same picture, the same handle) and never put a secret in one: Kino stores it like a poster URL
 * wherever the title is saved (library, history), which sync to the person's other devices and go into backups. There it
 * shows the placeholder, and a saved row keeps it (Kino never rewrites it): a reference only loads on the device whose Kino
 * read it from your answer.
 *
 * @example
 * export async function home() {
 *   return [{ id: "new", title: "New", items: [
 *     { id: "v1", ref: "video:1", title: "Holiday", kind: "movie", poster: { source: "plugin", handle: "thumb:1" } },
 *   ] }];
 * }
 * export async function image({ handle }) {
 *   const bytes = kino.storage.get(handle);              // a base64 JPEG you saved when you indexed the video
 *   if (!bytes) throw kino.error("not_found", "no thumbnail");
 *   return { bytes, mime: "image/jpeg" };
 * }
 */
interface KinoImageRef {
  source: "plugin";
  handle: string;
}

/**
 * What `image({ handle })` answers (apiVersion 13, "imageSource"): the picture, base64-encoded (canonical: the standard
 * alphabet, padded, no whitespace), at most 262,144 bytes (256 KB) once decoded, and its type, one of "image/jpeg",
 * "image/png" or "image/webp", which the bytes must really be (their first bytes are checked). Anything else, a throw or
 * no answer within 10 s shows the card's placeholder, and Kino does not ask for that handle again for 5 minutes; two
 * timeouts in a row pause all your images for 5 minutes.
 */
interface KinoImageAnswer {
  bytes: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

/** What a stream's source says about the media itself (`KinoStream.media`). */
interface KinoStreamMedia {
  /** The file's own name or a title for it. */
  title?: string;
  /** Bytes of the file being served (0..2^50). */
  sizeBytes?: number;
  /** The container as the source names it ("matroska,webm", "mp4"…). Display only: never given to the player. */
  container?: string;
  video?: {
    codec?: string;
    profile?: string;
    width?: number;
    height?: number;
    fps?: number;
    /** 0..16 */
    bitDepth?: number;
    hdr?: boolean;
  };
  /** The FILE's audio tracks, converted or not. */
  audio?: { codec?: string; channels?: number; language?: string; title?: string; default?: boolean }[];
  /** The FILE's subtitle tracks; `text` is true for the text formats (SubRip, ASS, WebVTT…) as opposed to bitmaps (PGS…). */
  subtitles?: { codec?: string; language?: string; title?: string; text?: boolean }[];
  /** The source re-encoded the file to make it playable: what it serves is not what the file holds. */
  converted?: boolean;
  /** Short plain remarks in the source's own words, at most 4. */
  notes?: string[];
}

/**
 * One of a Stream's `alternatives`: a URL (labelled from apiVersion 6), (apiVersion 6) a lazy `{ label, ref }`, or
 * (apiVersion 11) an external hand-off.
 */
type KinoStreamAlternative =
  | { url: string; mime?: string; headers?: Record<string, string>; label?: string }
  | { ref: string; label?: string }
  | { external: { protocol: string; ref: string; resolver?: string }; label?: string };

/** apiVersion 3, capability "channels": a section of the En vivo tab. */
interface KinoLiveCategory {
  id: string;
  title: string;
  /** ISO 3166 alpha-2, e.g. "CO". Informational. */
  country?: string;
  /**
   * What the row (or category, or list) is about, from Kino's closed vocabulary: "peliculas", "series", "anime",
   * "infantil", "documentales", "deportes", "noticias", "musica", "entretenimiento" or "otros". Kino groups Categorías
   * by it and filters En vivo by it across plugins. Optional: without it Kino guesses from the title; a value outside
   * the list is ignored. Kino versions before this field ignore it.
   */
  genre?: KinoGenre;
  /** apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental). Below apiVersion 6 it is dropped. Every channel listed in it is 18+ too. */
  adult?: boolean;
}

/**
 * apiVersion 3: an M3U playlist Kino downloads itself (from a declared host only, never under
 * `liveStreamHosts: "any"`), with an optional XMLTV guide. Put it next to your categories in the
 * `liveCategories()` answer, or return it alone. At most 10 per answer. `refreshHours` is 1..168,
 * default 12. `hideGroups` are group titles not to show (case-insensitive), at most 50. With
 * `resolve: true` each entry plays through your `resolve(<entry url>)` instead of directly.
 */
interface KinoPlaylist {
  playlist: {
    url: string;
    format: "m3u";
    headers?: Record<string, string>;
    /**
     * Headers the PLAYER sends for every channel of the list: a `User-Agent` some channels only answer to, a
     * `Referer`. Filtered like a Stream's `headers` (at most 20). Kept apart from `headers` on purpose: those carry
     * the list's own credentials and go only to the list's host, never to the hosts the channels are on. A header an
     * M3U entry names itself (`#EXTVLCOPT:http-user-agent=...`) wins. Kino versions before this field ignore it.
     */
    streamHeaders?: Record<string, string>;
    /** The [genre](KinoLiveCategory) of every group this list produces; without it Kino guesses from each group's title. */
    genre?: KinoGenre;
    epg?: { url: string; format: "xmltv" };
    refreshHours?: number;
    hideGroups?: string[];
    resolve?: boolean;
  };
}

/**
 * apiVersion 10, capability "playlists": one of the person's own playlists on that plugin's service
 * (not an M3U/IPTV channel list — see {@link KinoPlaylist} for that, an unrelated, older concept).
 */
interface KinoHostedPlaylist {
  id: string;
  title: string;
  itemCount: number;
}

/**
 * One channel: give `ref` (resolved on play, exactly like a `live` item's) or `stream` (played as
 * is, checked like `resolve()`'s answer). With both, the stream plays and `ref` is the fallback.
 * An `id` starting with `~` is reserved for Kino and dropped.
 */
interface KinoLiveChannel {
  id: string;
  title: string;
  ref?: string;
  stream?: KinoStream;
  /**
   * In liveChannels, informational: the channel is listed under the category it was asked for. Not a valid id = empty.
   * In a liveSearch hit (apiVersion 6), the category it belongs to: one of your 18+ categories makes it 18+, a plain one
   * makes it plain. A hit with neither `categoryId` nor `adult` counts as 18+ when you have any 18+ category.
   */
  categoryId?: string;
  /** https image, like a poster. */
  logo?: string;
  /** 1..9999. */
  number?: number;
  /**
   * apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental).
   * Below apiVersion 6 it is dropped. On a liveSearch hit, `false` says it is plain (needed when your categories can't be
   * read and it carries no `categoryId`): mark every hit with `adult` or `categoryId`.
   */
  adult?: boolean;
}

interface KinoLiveChannelPage {
  items: KinoLiveChannel[];
  /** Opaque cursor for the next page; omit or null at the end. */
  next?: string | null;
}

/** One programme. `start`/`end` are epoch milliseconds. */
interface KinoGuideEntry {
  channelId: string;
  title: string;
  start: number;
  end: number;
  description?: string;
}

/** apiVersion 6, capability "migrate": one value Kino stored and can no longer open. */
type KinoMigrateInput =
  | { kind: "title"; ref: string }
  | { kind: "chapter"; ref: string; season: number | null; episode: number | null }
  | { kind: "live"; provider: string; code: string };

/**
 * Your answer: the same id/ref you would return from search() today. `ref` never starts with "plg1:".
 * "music" and "podcast" need apiVersion 8 (below it such an answer is no claim). They move in the shape your
 * plugin saves them in: with the "episodes" capability as an album or show, chapter by chapter like a series;
 * without it as a lone track, like a movie, and only when one row is saved.
 */
type KinoMigrateAnswer =
  | { kind: "movie" | "series" | "music" | "podcast"; id: string; ref: string }
  | { kind: "episode"; ref: string; season?: number; number: number }
  | { kind: "live"; code: string };

/** apiVersion 6, with `"section": { "label" }` in the manifest: your own section (TV sidebar, chip atop Inicio on the phone). Kino 0.9.55: an optional `"labelEn"` (same 20-character limit) is the entry's text when the app is in English; `label` stays the Spanish default and the fallback. */
interface KinoSectionAnswer {
  /** At most 8; each `id` matches the item id pattern, each `label` at most 24 characters. */
  tabs?: { id: string; label: string }[];
  /** The tab this answer is for; an unknown or missing one reads as the first tab. */
  tab?: string;
  /** A banner above the rows: `title` as an item title, `text` at most 300 characters, `image` http or https (the Images rule), or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  hero?: { title: string; image?: string | KinoImageRef; text?: string };
  /** The same shape and limits as `home`. */
  rows: KinoRow[];
}

/** apiVersion 6, optional, needs the `browse` capability: a tile of your Categorías group; it opens `browse(ref, null)`. */
interface KinoCategory {
  /** The item id pattern. */
  id: string;
  /** At most 40 characters. */
  title: string;
  /** http or https image (the Images rule), same rules as a poster. */
  art?: string;
  /** At most 4096 characters. */
  ref: string;
  /** apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental). Below apiVersion 6 it is dropped. */
  adult?: boolean;
}

// ---------- apiVersion 9 (Kino 0.9.55): the player panel ----------
// A button in the player, shown only while YOUR content plays, opens a panel you describe with `panel(context)`. Kino
// validates every answer; an invalid element is dropped (and logged), a panel that is not an object shows nothing. The
// kit runs the same validation: node sdk/run.mjs <plugin dir> panel|panelAction|playerEvent. Layout limits: at most 40
// top-level elements, 120 nodes in all, 4 levels deep, 6 children per row.

/** What the player knows about the title playing when `panel`, `panelAction` or `playerEvent` is called (exactly these keys; an absent optional is left out). */
interface KinoPanelContext {
  kind: "movie" | "episode" | "live";
  /** The ref of the title that plays, exactly as you gave it. */
  ref: string;
  title: string;
  year?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  ids: { tmdb?: number; imdb?: string; tvdb?: number; mal?: number; anilist?: number; kitsu?: number };
  /** The copy playing now. */
  playing: { label?: string; lang?: string; quality?: string; server?: string };
  positionMs: number;
  /** Absent for live or while the player does not know it. */
  durationMs?: number;
  paused: boolean;
  /** The back/forward step in effect, ms. */
  seekStepMs: number;
  /** Read-only playback stats; only what the player knows. */
  stats: {
    width?: number; height?: number; videoCodec?: string; audioCodec?: string; bitrateKbps?: number; bufferedMs?: number;
    droppedFrames?: number; network?: "wifi" | "ethernet" | "cellular" | "other"; stallsThisSession?: number;
  };
  device: "tv" | "phone";
  /** The app's language, "es-CO" or "en-US" style. */
  lang: string;
  /** The tab the person asked for (a tab press calls `panel` again with it). */
  tab?: string;
  /** What you saved with `values`/`save`: per title (`video`) and for the whole plugin (`plugin`). */
  values: { video: Record<string, KinoPanelValue>; plugin: Record<string, KinoPanelValue> };
  /** The player's own properties in effect: the step, the speed, the resize mode and your `autoNext` when you set one. */
  player: { seekStepMs: number; speed?: number; resize?: KinoPlayerResize; autoNext?: { enabled: boolean; countdownS: number; nextRef?: string } };
  /**
   * Kino 0.9.64 (additive): what this Kino draws beyond apiVersion 9's panel; `"loading"`: the `loading` element. Absent on
   * an older Kino, which drops that element: check it before you answer with one.
   */
  features?: "loading"[];
}

type KinoPanelValue = string | boolean | number | null;
type KinoPlayerResize = "fit" | "fill" | "zoom" | "4:3" | "16:9" | "21:9";
/** `scope` of an input: `plugin` (default) is one value for all your titles, `video` one per title. */
type KinoPanelScope = "video" | "plugin";

/**
 * Rows, columns and cards around leaves (the one layout model of the player panel and of `settingsLayout`). `hidden: true`
 * keeps a node out of sight, `enabled: false` greys it out and takes it out of focus (a settings layout ignores both).
 * Limits: depth 4, a row keeps 6 children, `col.weight` 1 to 12 (else 1), 120 nodes in all, card `title` 60 characters.
 */
type KinoLayoutNode<Leaf> =
  | { type: "row"; children: KinoLayoutNode<Leaf>[]; gap?: "none" | "small" | "medium" | "large"; align?: "start" | "center" | "end" | "stretch"; stackOnNarrow?: boolean; enabled?: boolean; hidden?: boolean }
  | { type: "col"; children: KinoLayoutNode<Leaf>[]; weight?: number; gap?: "none" | "small" | "medium" | "large"; align?: "start" | "center" | "end" | "stretch"; enabled?: boolean; hidden?: boolean }
  | { type: "card"; title?: string; titleEn?: string; children: KinoLayoutNode<Leaf>[]; style?: "plain" | "outlined" | "filled"; enabled?: boolean; hidden?: boolean }
  | (Leaf & { enabled?: boolean; hidden?: boolean });

/**
 * A leaf of a panel. `key` (1 to 128 of A-Z a-z 0-9 . _ ~ -) names what holds a value or can be pressed and is unique
 * across the whole panel; a label is 1 to 40 characters. Every text has an optional `...En` twin shown when the app is in English.
 */
type KinoPanelElement =
  | { type: "section"; title: string; titleEn?: string; text?: string; textEn?: string }
  | { type: "text"; text: string; textEn?: string }
  /** At most 200 characters. */
  | { type: "status"; text: string; textEn?: string }
  /** https only, on a public host; `alt` up to 200 characters. */
  | { type: "image"; url: string; aspect?: "16:9" | "2:3" | "1:1" | "banner"; alt?: string; altEn?: string }
  /** `confirm` (up to 160 characters) asks first. Pressing calls `panelAction` with trigger "press". */
  | { type: "button"; key: string; label: string; labelEn?: string; confirm?: string; confirmEn?: string }
  /** `autoSave: true` saves each change by itself (trigger "change"). `hint` up to 80 characters. */
  | { type: "toggle"; key: string; label: string; labelEn?: string; scope?: KinoPanelScope; hint?: string; hintEn?: string; autoSave?: boolean }
  /** 1 to 20 options, `value` and `label` 1 to 40 characters, values distinct. */
  | { type: "select"; key: string; label: string; labelEn?: string; scope?: KinoPanelScope; options: { value: string; label: string; labelEn?: string }[]; hint?: string; hintEn?: string; autoSave?: boolean }
  /** `placeholder` up to 40 characters; Enter calls `panelAction` with trigger "submit". */
  | { type: "text-input"; key: string; label: string; labelEn?: string; scope?: KinoPanelScope; hint?: string; hintEn?: string; placeholder?: string; placeholderEn?: string }
  /** https, up to 512 characters, on a public host with a dot, or a public IPv4 address (never the device or the home network: no single-label or local name, private address or IPv6 literal). */
  | { type: "qr"; url: string; label?: string; labelEn?: string }
  /**
   * Kino 0.9.64 (additive, any apiVersion): a spinner, with `text` beside it (else Kino's «Cargando…»). Answer at once
   * with the tab's shell and this element, and set `refreshMs` so Kino asks again for the finished tab. Send it only when
   * `context.features` includes "loading": an older Kino drops it as an unknown element (answer a `status` line there).
   */
  | { type: "loading"; text?: string; textEn?: string }
  /** The series' episodes, the current one highlighted; choosing one plays it. */
  | { type: "episodes"; ref: string }
  /** Not in this Kino: dropped ("needs a newer Kino"). Reserved for a later version. */
  | { type: "ai"; [field: string]: unknown }
  /** Not in this Kino: dropped ("needs a newer Kino"). Reserved for a later version. */
  | { type: "chat"; [field: string]: unknown };

/** What `panel(context)` returns. A tab press calls it again with `context.tab`; `refreshMs` calls it again by itself. */
interface KinoPanel {
  /** Up to 60 characters. */
  title?: string;
  titleEn?: string;
  /**
   * Accepted for compatibility; both values look the same: the panel is a drawer over the whole player
   * (from the right on TV and a phone held sideways, from the bottom on a phone held upright). The video keeps playing.
   */
  presentation?: "modal" | "panel";
  /** `#RRGGBB`; kept only when it passes the same rules as the manifest theme's `accent`. */
  accent?: string;
  /** Asks Kino to call `panel` again every so often: 2000 to 60000 ms (clamped). */
  refreshMs?: number;
  /** At most 6: `id` as a key, `label` up to 24 characters. */
  tabs?: { id: string; label: string; labelEn?: string }[];
  /** The tab shown; the first one when absent or unknown. */
  tab?: string;
  elements: KinoLayoutNode<KinoPanelElement>[];
}

/** Why `panelAction` is called: a button pressed, an input changed or submitted. "tab" and "open" are reserved: this Kino never sends them. */
interface KinoPanelEvent {
  /** The element's key. */
  key: string;
  trigger: "press" | "change" | "submit" | "tab" | "open";
  /** Every input's value on screen now (saved or not yet). */
  values: Record<string, KinoPanelValue>;
  /** The new value, for "change" and "submit". */
  value?: KinoPanelValue;
}

/** What the plugin asks the player to do (every field optional). Bounds below are applied by Kino, which clamps or drops what is outside them. */
interface KinoPlayerAction {
  /** Ms from the start, clamped to 0..duration; ignored on live. At most one seek per second. */
  seekToMs?: number;
  /** The back/forward step: 5000 to 120000, whole seconds. */
  seekStepMs?: number;
  /** One of 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2. */
  speed?: number;
  resize?: KinoPlayerResize;
  /** The same block as a Stream's `skip`: the skip-intro/outro button. */
  skip?: { openingStartMs?: number; openingEndMs?: number; endingStartMs?: number };
  /** At most 30 dots on the progress bar; `label` up to 24 characters; selecting one seeks there. */
  markers?: { atMs: number; label: string }[];
  /** The end-of-episode countdown: `countdownS` 0 to 30, required when `enabled` (left out it is 0 when disabled). */
  autoNext?: { enabled: boolean; countdownS?: number; nextRef?: string };
}

/** What `panelAction` (and, for `player` and `message`, `playerEvent`) may return. `null` is "nothing to do". */
interface KinoPanelAnswer {
  /** A whole new panel. */
  panel?: KinoPanel;
  /** Replaces single elements in place, by key (at most 40 entries); each is one node, validated like any element. */
  patch?: Record<string, KinoLayoutNode<KinoPanelElement>>;
  /** Values to show now (at most 120 keys; strings up to 500 characters). */
  values?: Record<string, KinoPanelValue>;
  /** Keys of `values` (or on-screen inputs) to keep: at most 50. */
  save?: string[];
  /** The key to move focus to. */
  focus?: string;
  /** A short toast for the person (up to 160 characters); shown only when it passes the rules a `userMessage` does. */
  message?: string;
  player?: KinoPlayerAction;
}

/** What `playerEvent` is told. `failed` carries `kind`; `copyChanged` carries `automatic`, `label` and, after an automatic change, the last copy's failure `kind`. */
interface KinoPlayerEvent {
  type: "started" | "paused" | "resumed" | "ended" | "failed" | "copyChanged";
  kind?: string;
  label?: string;
  automatic?: boolean;
}

/**
 * The manifest's `panel` (apiVersion 9): the player's button. `label` 1 to 24 characters (`labelEn` the English one),
 * and `icon` (one of info, tune, settings, star, bolt, language, subtitles, list, magic, heart, movie, tv, sports, music,
 * bookmark, help; another name draws tune) or `iconFile`, a relative .png of exactly 96x96 px with an alpha channel, at
 * most 24 KB (only its alpha is drawn), never both. Declaring it makes `panel` required.
 */
interface KinoManifestPanel { label: string; labelEn?: string; icon?: string; iconFile?: string }

/**
 * The manifest's `settingsLayout` (apiVersion 9): where the settings of the form go. A list of rows, columns and cards
 * around `{ setting: "<key>" }`, `{ type: "text", text }` and `{ type: "image", url }` leaves. Settings left out are
 * added at the end in manifest order; an unknown or repeated key is ignored by Kino (and refused by the kit's validate).
 */
type KinoSettingsLayoutLeaf = { setting: string } | { type: "text"; text: string; textEn?: string } | { type: "image"; url: string; aspect?: "16:9" | "2:3" | "1:1" | "banner" };
type KinoSettingsLayout = KinoLayoutNode<KinoSettingsLayoutLeaf>[];

/**
 * Configuration aids in the manifest's `settings` (apiVersion 12; no value, never in kino.config, never required).
 * `link`: a button that opens `url` through the system ONLY when the person taps it (https only, no user info, at most 2048
 * characters; https://t.me/... opens Telegram when installed), with Kino's "Abrir enlace" and the host under it; on TV the
 * address as text plus a QR to open on a phone. Kino makes no request to that host. An address holding one of your secrets is
 * not shown. `help`: a button (your `label`, else Kino's "Ayuda" / "Help") that opens a modal titled with your plugin's name with
 * `title` (at most 60) and `body` (at most 2000; `body` or `bodyEn` required), plain text only: newlines are kept, markup is
 * shown literally, nothing is clickable (use a `link` for an address); scrubbed of your secrets; a missing Spanish or English
 * text falls back to the other. At most 4 of each per plugin; they count among the sections, statuses and actions.
 */
type KinoLinkSetting = { key: string; type: "link"; label: string; labelEn?: string; url: string; hint?: string; hintEn?: string; devices?: KinoSettingDevice[] };
type KinoHelpSetting = { key: string; type: "help"; label?: string; labelEn?: string; title?: string; titleEn?: string; body?: string; bodyEn?: string; devices?: KinoSettingDevice[] };

/**
 * apiVersion 12 (additive): `devices` on any settings item, the devices whose Kino draws it: `["phone"]`, `["tv"]` or both
 * (absent = every device; an unknown device, an empty list or a repeat refuses the manifest). Host side only: on a device it
 * leaves out the item is neither drawn nor checked, but its value is still stored, saved back unchanged, synced, provisioned
 * and read through `kino.config`. Use it for setup a TV cannot do (a token pasted on the phone, sent with "Enviar
 * configuración"). Ignored below apiVersion 12.
 */
type KinoSettingDevice = "phone" | "tv";

/** One entry of the manifest's `settings` (the manifest is JSON: this documents its shape, a `settings` array holds these). */
type KinoManifestSetting =
  | {
      key: string; label: string; labelEn?: string;
      type: "text" | "url" | "password" | "toggle" | "select" | "list" | "section" | "status" | "action";
      hint?: string; hintEn?: string; required?: boolean; default?: string | boolean;
      options?: { value: string; label: string; labelEn?: string }[];
      fields?: { key: string; label: string; labelEn?: string; type: "text" | "url"; hint?: string; hintEn?: string; required?: boolean }[];
      max?: number; confirm?: string; confirmEn?: string;
      devices?: KinoSettingDevice[];
      /**
       * apiVersion 12, on an `action` only: never drawn on any device; it runs only as the `confirm` of another action's `link`,
       * after Kino's own "¿Eres tú?" (a find-then-confirm pair shows the person one button).
       */
      linkOnly?: boolean;
      /**
       * apiVersion 13, on a `password` or a `text` only: `false` keeps the value on the device where it was typed (never sent to a
       * paired device, never set or cleared by one, in no backup or kit). A password one may still be named in a sync `provision`
       * for a one-shot secret (stored device-only on the receiver too), never as the `keySecret`; a text one never in a provision.
       * A text one is still drawn as a plain text field (nothing masked). Default `true`.
       */
      sync?: boolean;
    }
  | KinoLinkSetting
  | KinoHelpSetting;
type KinoManifestSettings = KinoManifestSetting[];

/** Your module's exports. `resolve` is required, and at least one of `search`/`home` (a catalog-only plugin: see [KinoCatalogOnlyPlugin]). */
interface KinoPlugin {
  /** apiVersion 6, capability "migrate". Return null for anything that is not yours. 10 s per call. */
  migrate?(input: KinoMigrateInput): Promise<KinoMigrateAnswer | null>;
  /** apiVersion 6, required when the manifest declares `section`. `tab` is null the first time. 20 s per call. */
  section?(arg: { tab: string | null }): Promise<KinoSectionAnswer>;
  /**
   * apiVersion 9, required when the manifest declares `panel`: the panel the button opens. Called with the context when it
   * opens, on a tab press and every `refreshMs`. 20 s per call; a panel that is not an object shows nothing.
   */
  panel?(context: KinoPanelContext): Promise<KinoPanel>;
  /** apiVersion 9, optional: a button pressed, an input changed or submitted. Called with TWO arguments, `(event, context)`. 20 s per call. */
  panelAction?(event: KinoPanelEvent, context: KinoPanelContext): Promise<KinoPanelAnswer | null | void>;
  /**
   * apiVersion 9, optional, needs no `panel`: told about the playing title's player events (fire and forget: 5 s, at most one
   * in flight, events coalesce). May answer a `player` action or a `message`; anything else is ignored. `(event, context)`.
   */
  playerEvent?(event: KinoPlayerEvent, context: KinoPanelContext): Promise<KinoPanelAnswer | null | void>;
  /** apiVersion 6, optional, needs `browse`: up to 24 tiles in Categorías, in your order. 20 s per call. */
  categories?(arg: null): Promise<KinoCategory[]>;
  /** With `query.within` (capability "scopedSearch", apiVersion 6): null = "can't search inside this page". 15 s per call. */
  search?(query: KinoSearchQuery): Promise<KinoItem[] | KinoPage | null>;
  home?(): Promise<KinoRow[]>;
  browse?(ref: string, cursor: string | null): Promise<KinoPage>;
  episodes?(ref: string): Promise<KinoEpisodes>;
  /** Kino 0.9.54, optional, no capability, asked only from apiVersion 8 (a RESERVED export name from apiVersion 8): a movie item's details for its title page. 20 s. */
  details?(ref: string): Promise<KinoSeriesInfo | null>;
  /** `options.retry` (apiVersion 6) only when Kino resolves again after the origin refused your stream. `attempt` is 1 to 3; `status` is the origin's HTTP status when Kino heard one. */
  resolve(ref: string, options?: { retry?: { reason: "conflict" | "expired"; attempt: number; status?: 401 | 403 | 409 } }): Promise<KinoStream | KinoPluginByteStream>;
  /**
   * apiVersion 13, required with "byteSource". Kino calls it to play a `{ source: "plugin" }` stream: `handle` is the one
   * you returned, `offset` is a multiple of 4096, `length` is at most 1048576 (1 MiB). Answer with the bytes of that range,
   * base64-encoded; fewer than `length` only at the end of the data.
   */
  read?(arg: { handle: string; offset: number; length: number }): Promise<{ bytes: string }>;
  /**
   * apiVersion 13, required with "imageSource". Kino calls it to draw a {@link KinoImageRef} you returned: `handle` is
   * yours. Answer the picture as {@link KinoImageAnswer} within 10 s. It runs in the background (nobody is asked
   * anything, a slow answer never marks your plugin "No responde"), one call at a time for your plugin and never while
   * one of your byte streams is open; a call that started always runs to its end, so a connection you keep stays open. A
   * timeout discards your sandbox (QuickJS cannot be interrupted), and with it that connection.
   */
  image?(arg: { handle: string }): Promise<KinoImageAnswer>;
  /**
   * apiVersion 6, needed when a stream says `signing: "request"`: headers for one request, computed with
   * kino.crypto / kino.secret only. kino.fetch answers host_not_allowed; kino.storage, kino.cookies and
   * kino.sleep fail with not_allowed. 1.5 s limit.
   */
  sign?(request: { url: string; kind: "playlist" | "segment"; ref: string; context: string }): Promise<{ headers: Record<string, string> }>;
  /** apiVersion 3, capability "channels" (required with it). At most 200 categories. */
  liveCategories?(): Promise<Array<KinoLiveCategory | KinoPlaylist> | KinoPlaylist>;
  /**
   * apiVersion 3, capability "channels" (required with it). At most 500 per page. Kino asks 10
   * pages at first and 5 more each time the person scrolls near the end, up to 10,000 channels.
   */
  liveChannels?(arg: { categoryId: string; cursor: string | null }): Promise<KinoLiveChannelPage | KinoLiveChannel[]>;
  /**
   * apiVersion 3, optional with "channels": channels whose name matches `query`, listed or not (the
   * En vivo search, while some of your channels were never listed). At most 100 kept; `next` ignored.
   * apiVersion 6 with an 18+ category: give every hit `adult` or `categoryId`; an unmarked hit counts as 18+.
   */
  liveSearch?(arg: { query: string }): Promise<KinoLiveChannelPage | KinoLiveChannel[]>;
  /** apiVersion 3, optional with "channels". At most 50 channels and a 24 h window per call. */
  guide?(arg: { channelIds: string[]; from: number; to: number }): Promise<KinoGuideEntry[]>;
  /**
   * apiVersion 10, capability "playlists" (optional with it, like every function below). The
   * playlists already in the person's account on this service.
   */
  playlists?(): Promise<KinoHostedPlaylist[]>;
  /**
   * apiVersion 10, optional with "playlists". A page of one playlist's items, the same shape as
   * {@link KinoPlugin.browse}.
   */
  playlistItems?(arg: { playlistId: string; cursor: string | null }): Promise<KinoPage | KinoItem[]>;
  /**
   * apiVersion 10, optional with "playlists". Absent means Kino never offers "crear lista nueva" for
   * this plugin.
   */
  playlistCreate?(arg: { title: string }): Promise<{ id: string }>;
  /** apiVersion 10, optional with "playlists", independently of playlistRemoveItem. */
  playlistAddItem?(arg: { playlistId: string; ref: string }): Promise<void>;
  /** apiVersion 10, optional with "playlists", independently of playlistAddItem. */
  playlistRemoveItem?(arg: { playlistId: string; ref: string }): Promise<void>;
  /** apiVersion 10, optional with "playlists". The new full order, as a list of every item's `ref`. */
  playlistReorder?(arg: { playlistId: string; refs: string[] }): Promise<void>;
  /**
   * The settings form's texts (manifest, not code): since Kino 0.9.55 a setting may add `labelEn`, `hintEn` and (an action,
   * next to `confirm`) `confirmEn`, an option and a list field `labelEn` (a field also `hintEn`), each with the base field's
   * limits. Kino shows them when the app is in English; the base texts stay the Spanish default and the fallback. apiVersion 9
   * (Kino 0.9.55): below it the keys are unknown and ignored. Your code never sees them: keys and values are the same in both languages.
   */
  /**
   * apiVersion 6: required when a setting has `type: "status"` (or, apiVersion 13, `type: "qr"`). One text per status setting
   * key, shown as-is (at most 200 characters; a missing key or a non-text reads "Sin información"). 10 s. A `qr` setting's
   * key holds the text its QR encodes: 1 to 512 characters, no control character, an http(s) address only https on a public
   * host; anything else (or a text holding a sealed secret) draws no QR. Asked when the form opens, after every action and,
   * with a `qr` setting's `refreshMs`, every that many ms while the form is on screen (never while the previous call runs).
   * apiVersion 13 `hide`: keys of your own settings the form does not draw while this answer is current (values kept, at most
   * 32 read, unknown keys ignored). A `qr` setting with no text draws nothing.
   */
  settingsStatus?(): Promise<{ [key: string]: string | string[] | undefined; hide?: string[] }>;
  /** apiVersion 6: required when a setting has `type: "action"`. Runs when the person presses that button (30 s); the `message` (at most 300 characters, default "Listo") is shown; settingsStatus() is asked again after every action (and when the form opens); `refresh: true` is still accepted and changes nothing. `clearSettings` (up to 12 keys of your own optional, valued settings: not a `required` one, not a section/status/action) is emptied by Kino right after a successful action, as if the person had emptied the field and saved (a password leaves the Keystore; your sandbox closes as for any saved change; `kino.storage` survives); anything else in it is dropped. A throwing action clears nothing. `link` (Kino 0.9.74, additive `action.link`): Kino asks the person with its OWN question ("¿Eres tú, <candidate>?" / "Is this you, <candidate>?", naming your plugin by its manifest `name`) and runs the `confirm` action exactly once only if they confirm; Cancel runs nothing and your plugin hears nothing. `candidate`: 1 to 64 characters after trimming, runs of spaces collapsed; no control or invisible formatting characters, no space but the ASCII one, no blank fillers (U+115F, U+1160, U+3164, U+FFA0, U+2800); scrubbed of your secrets and shown as plain text. `confirm`: the key of ANOTHER `action` setting of this plugin that declares no `confirm`/`confirmEn` question of its own. Anything else refuses the link: your `message` still shows, with Kino's generic error. A `link` in the confirm action's own answer is ignored. `setSettings` (Kino 0.9.74, additive `action.setSettings`): up to 8 of your own `text` or `select` settings and, from apiVersion 13, `password` settings (never a `url`: only the person types a server; never a toggle or list) with string values, checked like typed values (a required one is never emptied; your `validateSettings` is not run); Kino saves them through the form's own save, so they reach the person's other devices like typed values. An unknown or secret key, a non-string, a bad value, a key also in `clearSettings`, a value holding one of your secrets or more than 8 keys refuse the whole field: nothing is applied and the form shows Kino's generic error under your message. A password filled this way (apiVersion 13, a "Create key" action) is stored sealed exactly like a typed one, never logged, and scrubbed from this answer's `message` and `link`, so it is never shown back. */
  action?(key: string): Promise<{ message?: string; refresh?: boolean; clearSettings?: string[]; setSettings?: Record<string, string>; link?: { candidate: string; confirm: string } } | null | void>;
  /**
   * apiVersion 6, optional: checks the values BEFORE Kino saves them (20 s). `null` accepts; `{ key: "mensaje" }`
   * refuses with the message under that field (a key that is not one of your valued settings refuses too, as a
   * general message); a text refuses with that text. If it throws, times out or answers anything else, nothing is
   * saved and the person may "Guardar sin comprobar".
   */
  validateSettings?(values: Record<string, string | boolean | Array<Record<string, string>>>): Promise<Record<string, string> | string | null>;
}

/** A subtitles() track: a Stream's `subtitles` entry plus an optional `label` and `translated` (a machine translation). */
interface KinoSubtitleTrack { lang: string; url: string; format?: "vtt" | "srt"; label?: string; translated?: boolean }

/**
 * `subtitles` -- optional for any plugin (Kino asks every plugin that exports it), required with the capability
 * "subtitles". Tracks for a title Kino knows by IMDb or TMDB id (an episode's ids are the series'); `languages` are ISO
 * 639-1, best first. Checked like a Stream's `subtitles`: 30 kept, then only the person's languages are listed. 10 s, a
 * background call.
 */
type KinoSubtitlesFn = (arg: {
  imdbId?: string; tmdbId?: number; kind: "movie" | "series"; season?: number; episode?: number;
  title?: string; year?: number; languages: string[];
  /**
   * The file playing (Kino 0.9.51+), only what is known, absent when nothing is; never its URL. `hash`: the 16-hex
   * OpenSubtitles hash and `size` the bytes it was computed with; `name`: the file name with its extension.
   */
  file?: { hash?: string; size?: number; name?: string };
}) => Promise<KinoSubtitleTrack[]>;

/** Ids a tracking event carries, each only when known. */
interface KinoTrackingIds { imdb?: string; tmdb?: number; tvdb?: number; anilist?: number; mal?: number }

/**
 * `track(event)`'s argument (apiVersion 7, the "tracking" capability): what the person plays on this device. For a movie
 * `ids` are the movie's; for an episode `ids` are the EPISODE's own (may be `{}`) and the show's are in `show.ids` -- never
 * use the show's ids as the episode's. `watched` fires once, with 3 minutes or less left and at least 90% played.
 */
interface KinoTrackingEvent {
  /** Stable across retries of this event: the idempotency key. */
  id: string;
  type: "start" | "progress" | "stop" | "watched";
  /** When it happened on the device, epoch ms. */
  at: number;
  kind: "movie" | "episode";
  ids: KinoTrackingIds;
  /** A movie's name, or an episode's own name when TMDB has one. */
  title?: string;
  year?: number;
  show?: { title: string; year?: number; ids: KinoTrackingIds };
  season?: number;
  episode?: number;
  positionMs?: number;
  durationMs?: number;
  /** positionMs / durationMs, 0..1. */
  progress?: number;
  /** A `progress` sent because the person paused. */
  paused?: true;
}

/**
 * `track` -- required with the capability "tracking" (apiVersion 7). Return anything (`{ ok: true }`) when delivered; throw
 * `kino.error(code)` otherwise: `timeout`/`network`/`unavailable`/`rate_limited` retry later (in order, with backoff),
 * `auth_required`/`invalid_request`/`not_found`/`geo_blocked`/`host_not_allowed`/`too_large` drop the event. 10 s, a
 * background call.
 */
type KinoTrackFn = (event: KinoTrackingEvent) => Promise<unknown>;

/**
 * `segments(query)`'s argument (apiVersion 7, the "segments" capability): the title that started playing. For a movie `ids`
 * are the movie's; for an episode `ids` are the EPISODE's own (maybe `{}`) and the show's are in `show.ids`.
 */
interface KinoSegmentsQuery {
  kind: "movie" | "episode";
  ids: KinoTrackingIds;
  show?: { ids: KinoTrackingIds };
  season?: number;
  episode?: number;
  /** The playing file's length: answer for that cut. */
  durationMs?: number;
}

/** One segment of the file, in whole ms. Kino uses `intro` and the first `outro`/`credits`; `recap` and `preview` have no button yet. */
interface KinoSegment { type: "intro" | "outro" | "recap" | "credits" | "preview"; startMs: number; endMs: number }

/**
 * `segments` -- required with the capability "segments" (apiVersion 7). Each bad entry is dropped on its own (unknown type,
 * not whole ms, under 1 s, past the file's end, overlapping one of its type); 10 kept. 8 s, a background call.
 */
type KinoSegmentsFn = (query: KinoSegmentsQuery) => Promise<KinoSegment[] | null>;

/** A plugin that plays (`resolve` required, as above), optionally finding subtitles, tracking or segments too. */
interface KinoPlayingPlugin extends KinoPlugin { subtitles?: KinoSubtitlesFn; track?: KinoTrackFn; segments?: KinoSegmentsFn; meta?: KinoMetaFn }

/** A subtitle provider: capabilities only "subtitles" (and maybe "tracking" or "segments"), so `subtitles` is its export. */
interface KinoSubtitleProvider { subtitles: KinoSubtitlesFn; track?: KinoTrackFn; segments?: KinoSegmentsFn }

/** A tracker: capabilities only "tracking" (and maybe "subtitles" or "segments"). */
interface KinoTracker { track: KinoTrackFn; subtitles?: KinoSubtitlesFn; segments?: KinoSegmentsFn }

/** A segment source: capabilities only "segments" (and maybe "subtitles" or "tracking"). */
interface KinoSegmentSource { segments: KinoSegmentsFn; subtitles?: KinoSubtitlesFn; track?: KinoTrackFn }

/**
 * Kino 0.9.54, `"catalogOnly": true` in kino-plugin.json (additive: no new apiVersion, an older Kino ignores the field): a
 * catalog that lists and describes titles and plays none. Kino sends its titles to the person's other sources ("Buscar
 * dónde verlo"), never lists it as a source of a title and never calls its `resolve`. Needs one of `home`, `browse`,
 * `search`, `meta`; refuses `download`, `drm`, `channels`, `streamHosts` and `"browser": true` (`"pages"` is fine). To install
 * on Kino 0.9.53 and older too, keep declaring and exporting `resolve` (throw `kino.error("not_found", …, { userMessage })`)
 * and declare `search` or `home`: those apps ignore the field and require both.
 */
interface KinoCatalogOnlyPlugin extends Omit<KinoPlugin, "resolve" | "sign" | "liveCategories" | "liveChannels" | "liveSearch" | "guide"> {
  /** Only for Kino 0.9.53 and older (which require it): never called from Kino 0.9.54 on. */
  resolve?: KinoPlugin["resolve"];
  subtitles?: KinoSubtitlesFn;
  track?: KinoTrackFn;
  segments?: KinoSegmentsFn;
  meta?: KinoMetaFn;
}

/** Your module's exports: one of these. */
type KinoPluginModule = KinoPlayingPlugin | KinoCatalogOnlyPlugin | KinoSubtitleProvider | KinoTracker | KinoSegmentSource;

// ---------- the kino API ----------

type KinoErrorCode = "auth_required" | "not_found" | "geo_blocked" | "rate_limited" | "unavailable";
type KinoFetchErrorCode = "host_not_allowed" | "timeout" | "network" | "too_large" | "invalid_request" | "rate_limited";
/** Kino 0.9.53: what `kino.meta` and `kino.tmdb` throw besides the fetch codes (see contract.json `kinoMeta`/`kinoTmdb`). */
type KinoServiceErrorCode = "rate_limited" | "not_allowed" | "no_tmdb_key" | "not_found" | "unavailable";

/** Kino 0.9.71, `kino.nuvio.scrapers(query)`: `repo` is a GitHub `owner/repo` or the https address of a Nuvio `manifest.json`, as the person added it. */
interface KinoNuvioScrapersRequest {
  repo: string;
  /** Only these scraper ids (at most 64). */
  scrapers?: string[];
}

/** Kino 0.9.71, `kino.nuvio.streams(query)`: the title by its TMDB id; a series needs `season` and `episode`. */
interface KinoNuvioStreamsRequest extends KinoNuvioScrapersRequest {
  type: "movie" | "series" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
  /** How long each scraper may take, 2000 to 60000 ms (default 60000): a scraper that hangs answers `timeout` and hides nothing. */
  timeoutMs?: number;
}

interface KinoNuvioScraper { id: string; name: string }

/** One scraper a repository offers (`kino.nuvio.available`). */
interface KinoNuvioOffered extends KinoNuvioScraper { description: string; types: string[]; languages: string[]; compatible: boolean; installed: boolean }

/** One copy a scraper found: a `Stream`'s fields, copies included; a lazy copy (no address yet) is left out. */
interface KinoNuvioStream {
  url: string;
  mime?: string;
  headers?: Record<string, string>;
  label?: string;
  expiresInSeconds?: number;
  subtitles?: { lang: string; url: string; format?: "vtt" | "srt" }[];
  alternatives?: { url: string; mime?: string; headers?: Record<string, string>; label?: string }[];
}

type KinoNuvioResult =
  | { scraper: KinoNuvioScraper; ok: true; stream: KinoNuvioStream }
  | { scraper: KinoNuvioScraper; ok: false; code: string; message: string };

interface KinoNuvioStreamsAnswer { results: KinoNuvioResult[]; truncated: boolean }

/**
 * Kino 0.9.53, `kino.meta(query)`: the title to ask about. `type` and at least one id; ids are positive integers up to
 * 2147483647 (a number or a digit string) except `imdb` ("tt0133093"). `lang` ("es", "es-MX") goes to the person's meta
 * plugins. Anything else is `invalid_request`; the whole query as JSON is at most 4096 characters.
 */
interface KinoMetaRequest {
  type: "movie" | "series";
  ids: { imdb?: string; tmdb?: number | string; tvdb?: number | string; kitsu?: number | string; mal?: number | string; anilist?: number | string };
  lang?: string;
}

/**
 * Kino 0.9.55, apiVersion 9 (check `kino.meta.byTitle === true` first; below apiVersion 9 or on an older Kino the title is dropped and the query answers `invalid_request`): the title to ask about by
 * name when you have no id. `title` 1..200 characters, `year` 1870..2100 (a number or a 4-digit string; only with `title`).
 * Kino searches TMDB (the type's own search, es-MX, first page) and keeps the hit whose es-MX or original title equals
 * yours once both are normalised (lowercase, no accents, punctuation as spaces); with `year`, that exact year wins, else
 * one a year off. Two hits that tie (same title and year, or same title and no year) or no match: the answer is null,
 * never a guess. Then it answers exactly as for ids (same shape, `ids` filled in, same cache, budget and timeout). With
 * `ids` too, the ids win.
 */
interface KinoMetaTitleRequest {
  type: "movie" | "series";
  title: string;
  year?: number | string;
  lang?: string;
}

/**
 * Kino 0.9.53, what `kino.meta` answers (or null: nobody knew the title). Merged the way Kino's info page merges: Kino's
 * own TMDB lookup first (Spanish, es-MX), AniList for an anime, then the person's other `meta` plugins, each only filling
 * what the earlier ones left empty (ratings add up). Every field but `ids` and `sources` appears only when known.
 */
interface KinoMetaAnswer {
  title?: string;
  /** Up to 2000 characters, HTML stripped. */
  overview?: string;
  /** "1999". */
  year?: string;
  poster?: string;
  backdrop?: string;
  /** A clear-logo of the title (its name drawn as art). */
  logo?: string;
  /** At most 5. */
  genres?: string[];
  /** A movie's runtime, 1..1000 (never a series'). */
  runtimeMinutes?: number;
  tagline?: string;
  /** Age rating ("12+", "PG-13"). */
  certification?: string;
  /** A movie's directors, or a series' creators. */
  directors?: string[];
  /** A series' episodes, at most 5000 (trimmed from the end to keep the answer under 1,000,000 characters); `id` is the Stremio-style video id ("tt0944947:1:1"). */
  episodes?: { season: number; number: number; title?: string; overview?: string; still?: string; airDate?: string; id?: string }[];
  /** Every id Kino knows for the title, the ones you asked with included. */
  ids: { imdb?: string; tmdb?: number; tvdb?: number; kitsu?: number; mal?: number; anilist?: number };
  /** At most 6, one per source; TMDB's own vote is `{ source: "tmdb" }`. */
  ratings?: { source: "imdb" | "tmdb" | "rottentomatoes" | "metacritic" | "letterboxd" | "mal" | "anilist" | "trakt"; value: string }[];
  /** At most 20. */
  cast?: { name: string; character?: string; photo?: string }[];
  /** Who contributed to this answer. */
  sources: ("tmdb" | "anilist" | "plugin")[];
}
type KinoEncoding = "utf8" | "hex" | "base64";
type KinoKeyType = "ec" | "ed25519" | "x25519";
/** A public key as a JWK, in WebCrypto's key order: EC `{ crv, kty: "EC", x, y }`, OKP `{ crv: "Ed25519" | "X25519", kty: "OKP", x }` (base64url, no padding). */
interface KinoJwk { readonly crv: string; readonly kty: "EC" | "OKP"; readonly x: string; readonly y?: string }
/** apiVersion 6: a handle to a private key that lives only inside Kino, in this runtime. */
interface KinoPrivateKey { readonly type: KinoKeyType; readonly namedCurve?: "P-256" | "P-384"; readonly handle: string }
/** apiVersion 6: `spki` is DER as base64; `raw` is base64 (an uncompressed point 04||x||y for ec, 32 bytes otherwise). */
interface KinoPublicKey { readonly type: KinoKeyType; readonly namedCurve?: "P-256" | "P-384"; readonly jwk: KinoJwk; readonly spki: string; readonly raw: string }

interface KinoError extends Error {
  /** `KinoError_<code>` (e.g. `KinoError_not_found`). */
  readonly name: string;
  readonly code: KinoErrorCode | KinoFetchErrorCode | KinoServiceErrorCode | "crypto_error" | "unknown";
  /**
   * The sentence you passed as `{ userMessage }`, cut at 161 characters; absent when you passed none. On a `no_tmdb_key`
   * from `kino.tmdb` (Kino 0.9.53) it is Kino's own sentence for the person, in their language: show it as is.
   */
  readonly userMessage?: string;
  /**
   * Kino 0.9.55: on a `host_not_allowed` from `kino.fetch`, the host Kino refused (at most 253 characters), so you never
   * have to read it out of the message. Absent on older Kino and when no one host was refused (the signing lane).
   */
  readonly host?: string;
}

interface KinoErrorOptions {
  /**
   * Your own sentence for the person, shown INSTEAD of Kino's line for the code as "Mensaje de <plugin>: <sentence>",
   * only when: your plugin's name has no ":", no digit glued to a letter, spells no Kino and uses only the characters
   * below; the code is one of
   * the five `KinoErrorCode`s; it is 1..160 characters once trimmed, made only of Basic Latin and Latin-1 letters
   * (á é í ó ú ü ñ ç ã õ…, not ø æ ð þ ß), digits 0-9, the plain space and . , : ; ¿ ? ¡ ! ' ’ ‘ “ ” « » ( ) % - – — ▸
   * (; only before a space); it reads as
   * plain words (two or more, no URL, no "TypeError:" prefix, no undefined/null/NaN, not ending in : , ; -); fewer than
   * 6 digits in all and none glued to a letter; no domain (site.app, site .app, site. app, www, punto/dot + com, app…);
   * no "kino" once 1 l ! ¡ read as
   * i, 0 as o and non-letters dropped; no credential, money or contact stem (pag…, abon…, recarg…, transfer…,
   * contraseñ…, passw…, clave…, token…, tarjeta, PIN, Nequi, Daviplata, WhatsApp, Telegram, SMS/verification code);
   * and none of the person's passwords or a sealed value. Otherwise Kino's line stays. A host the person refused still
   * wins, whatever the code. It counts only for the call that built the error. Older Kino builds ignore it. Plugins
   * that use it to ask for money, credentials or contact outside Kino are removed from the catalog.
   */
  userMessage?: string;
}

interface KinoFetchOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** A string, or JSON, a form, or raw bytes as base64. URL + headers + body at most 1,048,576 characters. */
  body?: string | { json: unknown } | { form: Record<string, string | number | boolean> } | { base64: string };
  /** "follow" (default, at most 10 hops, each host-checked) or "manual" (returns the 3xx). */
  redirect?: "follow" | "manual";
  /** true (default): send and store cookies from the plugin's jar. */
  cookies?: boolean;
  /** Default 15000, at most 30000. */
  timeoutMs?: number;
}

interface KinoResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly url: string;
  /** Lower-cased names; repeated headers joined with ", "; never set-cookie. */
  readonly headers: Readonly<Record<string, string>>;
  text(): string;
  json(): any;
  /** The body bytes (at most 5 MB) as base64. */
  base64(): string;
}

interface KinoHtmlMatch {
  text: string;
  html: string;
  attrs: Record<string, string>;
}

interface KinoCipherOptions {
  key: string;
  iv?: string;
  data: string;
  /** CBC/ECB only. Default "pkcs7". */
  padding?: "pkcs7" | "none";
  /** GCM only: additional authenticated data. */
  aad?: string;
  /** Default utf8 to encrypt, base64 to decrypt. */
  inputEncoding?: KinoEncoding;
  /** Default base64 from encrypt, utf8 from decrypt. */
  outputEncoding?: KinoEncoding;
  keyEncoding?: KinoEncoding;
  ivEncoding?: KinoEncoding;
  aadEncoding?: KinoEncoding;
}

type KinoCipher =
  | "aes-128-cbc" | "aes-192-cbc" | "aes-256-cbc"
  | "aes-128-ecb" | "aes-192-ecb" | "aes-256-ecb"
  | "aes-128-ctr" | "aes-192-ctr" | "aes-256-ctr"
  | "aes-128-gcm" | "aes-192-gcm" | "aes-256-gcm"
  | "des-ede3-cbc" | "des-ede3-ecb";

/** apiVersion 6: `kino.browser.capture` options. */
interface KinoBrowserCaptureOptions {
  /** 1..25000 ms; default 18000. */
  timeoutMs?: number;
  /** Extra headers for the first page load only (a `Referer` an embed insists on). */
  headers?: Record<string, string>;
  /** A regular expression (case-insensitive, up to 500 characters) for what counts as the video request; default: m3u8, mpd, mp4, `master.txt`, `videoplayback`, `/hls/`. */
  match?: string;
  /** Default true: mute and start the page's player, click common play buttons, tap the middle. Off with `waitForCookie`. */
  autoplay?: boolean;
  /**
   * Kino 0.9.54 (check `kino.browser.captureAll` first; older Kino ignores it): collect EVERY request matching `match`
   * (or the default media pattern) or one of `alsoMatch`, deduplicated by URL, at most 20, until the page settles (the
   * first match was seen and nothing new matched for 1 s) or `timeoutMs`. The answer then has `requests`.
   */
  captureAll?: boolean;
  /** Kino 0.9.54, only with `captureAll`: 1..10 more patterns (up to 500 characters each, case-insensitive) whose requests are collected too, never held back from the page. */
  alsoMatch?: (string | RegExp)[];
  /**
   * Kino 0.9.54: a cookie name (an HTTP token, e.g. `"cf_clearance"`) the page must also hold for its current host.
   * Without `match` no request is needed: the page ends as soon as the cookie is there (a cookie-only page). Kino never
   * autoplays or taps a page that waits for a cookie. With `captureAll` it needs a `match`.
   */
  waitForCookie?: string;
  /** Kino 0.9.54: a page that runs out of time answers what it had, with `timedOut: true`, instead of throwing `timeout`. */
  returnCookiesOnTimeout?: boolean;
}

/** apiVersion 6: what `kino.browser.capture` saw. */
interface KinoBrowserCapture {
  /** At most 8, manifests first. `headers` carries Referer, User-Agent and, when the request had them, Origin and Cookie. */
  media: { url: string; mime?: string; headers: Record<string, string> }[];
  /** `.vtt`/`.srt` requests the page made, at most 10. */
  subtitles: { url: string; lang?: string }[];
  /** The top page's last address. */
  finalUrl: string;
  /**
   * Kino 0.9.54, only when the call used `captureAll`, `waitForCookie` or `returnCookiesOnTimeout`: the matching requests
   * (at most 20) with the method and headers the page sent, the first match first. On a timeout answer without a match,
   * only `alsoMatch` hits (or none): check each URL against your own patterns.
   */
  requests?: { url: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"; headers: Record<string, string> }[];
  /** Kino 0.9.54, same condition: the final page's cookies (at most 64, 16,384 characters in all, Cloudflare's `cf_*`/`__cf*` kept first). */
  cookies?: Record<string, string>;
  /** Kino 0.9.54, same condition: the hidden page's user agent (the one Cloudflare ties `cf_clearance` to). */
  userAgent?: string;
  /** Kino 0.9.54, same condition: true only for a `returnCookiesOnTimeout` page that ran out of time. */
  timedOut?: boolean;
}

/** apiVersion 6, `"browser": "pages"`: `kino.browser.page` options. */
interface KinoBrowserPageOptions {
  /**
   * 1..25000 ms; default 15000. Counts inside your call's own time limit; Kino cuts it to what is left of that limit
   * minus 1.5 s. Pass about 12000 in `search` (15 s for the whole call).
   */
  timeoutMs?: number;
  /**
   * A JavaScript regular expression (source string or RegExp, whose `m` and `s` flags are kept; matched
   * case-insensitively against the page's HTML, up to 500 characters): the page is returned only once it matches. Without it, as soon as the page is loaded and is no
   * longer the site's browser check page. Use it for pages that fill in their list with scripts.
   */
  waitFor?: string | RegExp;
}

/** apiVersion 6, `"browser": "pages"`: what `kino.browser.page` read. */
interface KinoBrowserPage {
  /** The doctype and the DOM's outerHTML (after the page's scripts ran), at most 2,000,000 characters. Feed it to `kino.html.select`. */
  html: string;
  /** The top page's last address (after redirects and the browser check). */
  finalUrl: string;
  /** The HTTP status of the top page's last load: 200 unless that load answered an error. */
  status: number;
  /** True when `html` was cut at 2,000,000 characters. */
  truncated: boolean;
}

/** `kino.cloudstream` (converted plugins only): one result of a CloudStream provider's search or main page. */
interface CsItem {
  name: string;
  url: string;
  type?: string;
  poster?: string;
  posterHeaders?: Record<string, string>;
  year?: number;
  quality?: string;
  provider?: string;
}

/** `kino.cloudstream` (converted plugins only): what a CloudStream provider's `load` says about a title. */
interface CsTitle {
  name: string;
  url: string;
  type?: string;
  plot?: string;
  poster?: string;
  background?: string;
  year?: number;
  tags?: string[];
  rating?: number;
  durationMin?: number;
  kind?: string;
}

/** `kino.cloudstream` (converted plugins only): one episode of a title; `data` is what `loadLinks` takes. */
interface CsEpisode {
  data: string;
  season?: number;
  episode?: number;
  name?: string;
  poster?: string;
  description?: string;
  date?: number;
  dubStatus?: string;
}

/** `kino.cloudstream` (converted plugins only): a playable link, already filtered (public https only) and ranked by Kino. */
interface CsLink {
  url: string;
  name: string;
  quality: number;
  linkType: "VIDEO" | "M3U8" | "DASH";
  headers: Record<string, string>;
}

/** apiVersion 13, `kino.ws.open`: a connected WebSocket carrying binary messages. */
interface KinoWebSocket {
  /** Sends one binary message of at most 786000 bytes (`"too_large"` above). `await` it: it rejects with code `"closed"` when the socket is no longer open. */
  send(data: Uint8Array): Promise<void>;
  /**
   * Sends one binary message given as a string in `encoding`: `"hex"` (an even number of digits, either case) or `"base64"`
   * (standard alphabet, padded, no whitespace). Kino decodes it natively, so no JavaScript loop touches the bytes: for a
   * binary protocol whose bytes already live as hex in your code (`kino.crypto` results, a packet you built), this is the
   * fast path. The 786000-byte cap is on the decoded bytes (`"too_large"`); a string that is not exactly that encoding
   * rejects with `"invalid_request"`, as does an `encoding` other than these two.
   * @example
   * await ws.send("efefefef", { encoding: "hex" });
   * await ws.send(kino.crypto.aesIge("encrypt", key, iv, plain, { keyEncoding: "hex", ivEncoding: "hex", inputEncoding: "hex", outputEncoding: "hex" }), { encoding: "hex" });
   */
  send(data: string, options: { encoding: "hex" | "base64" }): Promise<void>;
  /**
   * Waits up to `timeoutMs` (default 30000, at most 60000) for the next message: resolves with it, or with null when none
   * came in time. Rejects with code `"closed"` once the socket is closed and nothing is left queued (`"limit"` when it was
   * closed for holding more than 8 MiB of unread messages).
   */
  recv(timeoutMs?: number): Promise<Uint8Array | null>;
  /**
   * As `recv(timeoutMs)`, but the message comes as a string in `encoding`, `"hex"` (lower case) or `"base64"` (padded),
   * encoded natively by Kino. Building a `Uint8Array` costs a JavaScript pass over every byte (QuickJS interprets each
   * iteration); for anything big prefer an encoded frame and hand it on as it is, e.g. to `kino.crypto` with the same
   * `inputEncoding`. Rejects with `"invalid_request"` for an `encoding` other than these two, before waiting.
   * @example
   * const hex = await ws.recv(10000, { encoding: "hex" });   // "0a1b..." (2 characters per byte), or null
   */
  recv(timeoutMs: number | undefined, options: { encoding: "hex" | "base64" }): Promise<string | null>;
  /** Closes the socket; later calls reject with `"closed"`. Closing twice is harmless. */
  close(): Promise<void>;
}

/**
 * apiVersion 13, `kino.catalog`: one item as you give it to `upsert`. Only these four fields are kept; anything else is
 * dropped before it reaches Kino.
 */
interface KinoCatalogUpsertItem {
  /**
   * Your own key for the item (a message id, a video id, a URL), 1 to 128 characters (longer is `"too_large"`, empty or not a
   * string is `"invalid_request"`). Upserting an id that is already there REPLACES that item whole (title, sort and data).
   */
  id: string;
  /**
   * What `search` matches and what the "title" order sorts by: at most 300 characters (longer is `"too_large"`). Kino keeps
   * a copy lower-cased and without accents for the search ("Película" is found by "pelicula", "PELICULA" or "película").
   */
  title: string;
  /**
   * A whole number for the "newest" (descending) and "oldest" (ascending) orders, for example a date in ms or a message id.
   * Default 0. Must be a safe integer (at most 2^53 - 1 in size); a fraction, `NaN` or `Infinity` is `"invalid_request"`.
   */
  sort?: number;
  /**
   * Small display fields you want back with the item (a poster URL, a duration, a file reference), a plain object whose
   * JSON is at most 4,096 bytes in UTF-8 (`"too_large"` above; an array, a string or a number is `"invalid_request"`).
   * Not searched. Not a place for blobs or credentials.
   */
  data?: Record<string, unknown> | null;
}

/** apiVersion 13, `kino.catalog`: one stored item as `search` and `get` answer it. */
interface KinoCatalogItem {
  id: string;
  title: string;
  /** 0 when you gave none. */
  sort: number;
  /** The object you stored, parsed again; null when you gave none. */
  data: Record<string, unknown> | null;
}

/** apiVersion 13, `kino.catalog.search`'s options. Every field is optional; anything else is dropped. */
interface KinoCatalogSearchOptions {
  /**
   * Words to find, at most 256 characters (`"too_large"` above). Split on whitespace; EVERY word must appear somewhere in
   * the title (AND, any order, as a substring: "gat roj" finds "Gato rojo"), ignoring case, accents and control characters
   * other than whitespace (a NUL, an escape code). `%`, `_` and `\`
   * are plain characters, never wildcards. Empty, blank or absent lists everything.
   */
  q?: string;
  /** Items per page: default 50, at most 100 (`"too_large"` above, `"invalid_request"` below 1, for a fraction, `NaN` or `Infinity`). */
  limit?: number;
  /** Items to skip: default 0, at most 1,000,000 (`"too_large"` above, `"invalid_request"` for a negative, fractional or non-finite number). */
  offset?: number;
  /**
   * "newest" (default): `sort` descending, then `id`; "oldest": `sort` ascending, then `id`; "title": the title without case
   * or accents, then the title as written, then `id`. Ties are always broken by `id`, so paging is stable.
   */
  order?: "newest" | "oldest" | "title";
}

/** apiVersion 13, `kino.catalog.search`'s answer: one page and the count of every match. */
interface KinoCatalogPage {
  /** At most `limit` items, in the order asked. */
  items: KinoCatalogItem[];
  /** How many items match `q` in all (not just this page): compare it with `offset + items.length` to know if there is more. */
  total: number;
}

declare namespace kino {
  const apiVersion: number;
  /** Kino's version name, for example "0.9.56" ("sdk" in the Node kit). */
  const appVersion: string;
  /**
   * The language Kino speaks now, as a tag: "es-CO" or "en-US" (`kino.lang.slice(0, 2)` for the bare "es"/"en"). It follows
   * the person's choice in Ajustes ▸ App ▸ Idioma: on a change Kino closes the plugin's runtime and the next call opens a
   * new one with the new value (a `sign()` lane keeps the old one), so read it per call, not into a long-lived cache.
   */
  const lang: string;
  /**
   * Kino 0.9.55+: the UI Kino shows on this device, `"tv"` (remote control, ten-foot screen) or `"phone"` (touch; a
   * tablet gets whatever Kino shows it, usually `"phone"`). Same value for every apiVersion and every call while Kino
   * runs; no permission, it says nothing about the person. `undefined` on an older Kino. The Node kit says `"phone"`
   * unless `run.mjs --device tv` or `KINO_DEVICE=tv`.
   */
  const device: "tv" | "phone" | undefined;
  /**
   * Kino 0.9.55+: `true` when THIS install's `kino.fetch` may reach any public host -- the manifest declares
   * `"fetchHosts": "any"`, the plugin qualifies (apiVersion 9 or later, or converted from a Nuvio scraper) and the
   * person approved its red consent line. `false` otherwise; `undefined` on an older Kino (keep your own fallback).
   */
  const fetchAnyHost: boolean | undefined;

  /**
   * Only to the manifest's hosts over https (http only on a host declared `insecureHttp`), or to the person's own server as typed.
   * With `fetchAnyHost` true, also any PUBLIC host over https on port 443, at a public IPv4 address or a dotted name (never
   * the home network, never a single-label name; a sealed secret still only goes to the manifest's own hosts over https).
   * Those requests spend a budget kept for the whole app: at most 60 a minute per site and 600 every 10 minutes per plugin
   * (250 / 2,500 for a converted Nuvio scraper), then `rate_limited`; declared hosts never spend it (declare your main
   * sites). From Kino 0.9.55; a hidden page's start address and a capture's top-level navigations to a host reachable
   * only through the grant follow the same https / port 443 / dotted-name rule (declared hosts keep theirs); its
   * subresources do not.
   * Never throws for a non-2xx status.
   */
  function fetch(url: string, options?: KinoFetchOptions): Promise<KinoResponse>;

  /**
   * `throw kino.error("not_found", "…")`: the app words the message; yours is a detail of at most 200 characters.
   * `throw kino.error("not_found", "…", { userMessage: "Este capítulo ya no está disponible." })`: your own sentence
   * for the person, shown instead of Kino's line when it is safe (see `KinoErrorOptions`).
   */
  function error(code: KinoErrorCode, message?: string, options?: KinoErrorOptions): KinoError;

  /** 0..5000 ms, counts inside the call's own timeout. */
  function sleep(ms: number): Promise<void>;

  /**
   * Kino 0.9.53 (no new apiVersion: absent on older Kino, so check `typeof kino.meta === "function"` first). Asks Kino about
   * a title and answers what it knows, without your plugin ever touching a TMDB key: Kino's own TMDB lookup (its app
   * feature, the one its info page uses), AniList for an anime, then the person's installed `meta` plugins (never yours,
   * and none at all when called from your own `meta` export). Null when nobody knows the title (never an error).
   * At most 30 calls a minute per plugin (`rate_limited`); 8 s at most, inside your call's own time limit; cached 30 min.
   * Throws `invalid_request` (a bad query), `rate_limited`, `not_allowed` (from `sign()`).
   */
  function meta(query: KinoMetaRequest | KinoMetaTitleRequest): Promise<KinoMetaAnswer | null>;
  namespace meta {
    /** Kino 0.9.55, apiVersion 9: true when `kino.meta` takes `{ type, title, year? }` (KinoMetaTitleRequest); absent before. */
    const byTitle: true | undefined;
  }

  /**
   * Kino 0.9.53 (no new apiVersion: check `typeof kino.tmdb === "function"` first). A GET to TMDB's v3 API
   * (`https://api.themoviedb.org/3` + `path`) with no key in your plugin. Kino's own TMDB key goes first, behind Kino's
   * TMDB cache, a shared in-flight request and its own limits (at most 20 calls per 10 s per plugin and 60 per 10 s for
   * all plugins on Kino's key). Only when Kino's key fails (TMDB answers 401/403/429 for it, or one of those limits is
   * spent) does the same request go again with the PERSON'S key: the one they typed in Ajustes ("Tu llave de TMDB",
   * optional), else the one they configured in an installed Stremio addon (once they agree). With neither, a cached copy
   * up to 7 days old, else `rate_limited`. A key your plugin keeps in its own settings is never used. Your plugin never
   * sees any key and needs no `hosts` entry for TMDB. `path` starts with /discover, /trending, /search, /movie, /tv,
   * /find, /genre, /configuration, /person or /collection, without the version and without a query string; `params` (at
   * most 20; never `api_key` or a session) become the query. Answers the parsed JSON body (a cached copy when TMDB is down
   * or unreachable). At most 40 calls per 10 s per plugin whichever key; bodies up to 2 MiB; cached 10 min in memory by
   * path and params, and on disk with Kino's TMDB cache. Throws `no_tmdb_key` (only on a Kino build without a key of its
   * own and a person without one: `e.userMessage` is Kino's sentence telling the person what to do), `invalid_request`,
   * `rate_limited`, `not_found`, `too_large`, `timeout`, `network`, `unavailable`, `not_allowed` (from `sign()`).
   */
  function tmdb(path: string, params?: Record<string, string | number | boolean>): Promise<any>;

  /**
   * Kino 0.9.71, apiVersion 11, needs `"nuvio"` in the manifest's `capabilities` (a declarative capability; the consent sheet says "Instala y usa
   * scrapers de Nuvio del repositorio que indica para buscar enlaces"; check `typeof kino.nuvio === "object"` first). EXPERIMENT. You name
   * your Nuvio repositories in the manifest's `nuvioRepos` (1 to 4, `owner/repo`; the capability needs it) and `kino.nuvio` refuses any other (`not_allowed`).
   * The scrapers you install are yours: Kino does not list them among the person's plugins, counts them under yours and removes them with it. The app installs the scrapers you ask for exactly as the importer does for a person (same reader, same conversion, same
   * torrent filter: a P2P-only scraper is listed as not compatible and never installed), with nothing for the person to do, then asks each for a
   * title and hands you what it found, to sort, merge and label as you like. Nothing is run or downloaded by your plugin: every scraper keeps
   * the importer's own hosts, request budget and 75 s limit, and a plugin that declares `nuvio` gets the same 75 s for its own `resolve`.
   * Only inside one of your functions. At most 20 calls a minute; up to 12 scrapers per `use` or `streams` call (`streams` asks 4 at a time).
   * Throws `invalid_request` (a bad query), `rate_limited`, `unavailable` (the repository cannot be read), `not_allowed` (the capability is
   * not declared, or from `sign()`).
   */
  namespace nuvio {
    /** What `repo` offers, read by the importer: each scraper's id, name, types (`movie`, `tv`, `anime`) and languages, whether it is `compatible` and whether it is already `installed`. */
    function available(query: { repo: string }): Promise<KinoNuvioOffered[]>;
    /**
     * Makes sure each scraper in `scrapers` (at most 12) is installed, installing the missing ones one after another (up to 45 s each). A scraper that
     * cannot be installed is in `failed` (`refused` for a torrent-based one, `not_found`, `timeout`, `failed`) and the rest go on.
     */
    function use(query: { repo: string; scrapers: string[] }): Promise<{ ready: string[]; failed: { id: string; code: string; message: string }[] }>;
    /** The scrapers of `repo` that are installed and on right now (18+ ones are never listed), in install order. */
    function scrapers(query: KinoNuvioScrapersRequest): Promise<KinoNuvioScraper[]>;
    /**
     * One answer per scraper asked, in install order. A scraper that fails or takes longer than 60 s is an entry with `ok: false`, never a
     * throw, so one slow source hides nothing. `truncated` is true when more than 12 scrapers were installed and only the first 12 were asked.
     */
    function streams(query: KinoNuvioStreamsRequest): Promise<KinoNuvioStreamsAnswer>;
  }

  /**
   * Kino 0.9.55: share ONE anonymous, free guest session of your source's portal, so people in regions that can't log in
   * have live sessions to seed from. `session` is a plain object of the session's own fields (its ids and token); Kino keeps
   * only the known seed fields, drops everything else, and sends it to Kino's own error board — but only when the
   * person's plugin-telemetry consent is on (the same consent `kino.log.report` rides on). It is anonymous: it names no
   * account and carries nothing about the person. Best-effort and synchronous; it answers nothing and never throws. Mint a
   * BRAND-NEW guest session for this, never the person's own, and send it only after you confirmed it works. Absent on a
   * Kino older than 0.9.55 (feature-detect with `typeof kino.seed === "function"`).
   */
  function seed(session: Record<string, string | number>): void;

  /**
   * Kino 0.9.74, additive: a `"sync": { "mode": "realtime" }` provider that can learn of a remote change tells Kino, so Kino pulls
   * at once. Synchronous, cheap, answers nothing. Kino accepts at most one signal every 30 seconds and drops one that arrives while
   * a pull is already running (that pull sees the remote), so call it when you notice the change, not in a loop. Throws
   * `{ code: "not_allowed" }` unless the plugin declares the `syncProvider` capability with `mode: "realtime"`. Your code only runs
   * while Kino calls it, so you cannot hold a connection open between calls: the place to notice a change and signal is
   * `syncStatus` (not `syncPull`). Kino also keeps pulling every `pullEveryMs`. Feature-detect with `typeof kino.sync === "object"`.
   */
  namespace sync {
    function remoteChanged(): void;
  }

  /**
   * apiVersion 6, with `"browser": true` (or `"pages"`) in the manifest (the person approves it in red): from `resolve` only, and only
   * a `resolve` the person started (they pressed play, or they started a download; never a background one), opens
   * `url` in a hidden web view, lets the page run its own player (muted; with `autoplay`, the default, it also clicks the
   * usual play buttons and taps the middle of the page), and answers the video requests the page made, HLS/DASH first,
   * each with the headers to play it with (put them in your Stream's `headers`). The start `url` must be a host your
   * `kino.fetch` may reach; the page may then load from any public server, never the home network. One page at a
   * time in the whole app (a download's capture never waits: `busy` at once). Throws a typed error: `browser_unavailable`
   * (no WebView on this device, and always under the Node kit), `timeout` (no video in `timeoutMs`, default 18000, at
   * most 25000), `blocked`, `busy`, `not_allowed` (no approved `"browser": true`, not inside `resolve`, or a `resolve`
   * nobody started), `invalid_request`.
   */
  namespace browser {
    function capture(url: string, options?: KinoBrowserCaptureOptions): Promise<KinoBrowserCapture>;
    /** Kino 0.9.54+: `true` when `capture` takes `captureAll`, `alsoMatch`, `waitForCookie` and `returnCookiesOnTimeout`; absent before. */
    const captureAll: true | undefined;
    /**
     * apiVersion 6, with `"browser": "pages"` in the manifest (`true` is capture-only and answers `not_allowed` here; the
     * person approves "Puede abrir páginas web ocultas para mostrar contenido y
     * encontrar el video", in red): from `search`, `home`, `browse`, `episodes`, `section` or `resolve`, only
     * while the person is using the app (never a background call), loads `url` in the same hidden web view and returns its
     * HTML once the page is past the site's automatic browser check (Cloudflare's "Just a moment…") and matches `waitFor`.
     * Kino never clicks, taps, types or scrolls in it and never solves a captcha: a page that asks for a human answers
     * `blocked` at once, and one still on its check page when the time runs out answers `blocked` too. The top document
     * must stay on your hosts: a redirect or navigation elsewhere answers `blocked`, never that site's HTML. Same start-host
     * rule, same one page at a time, fresh cookies per call; at most 20 page reads per minute per plugin. Throws a typed
     * error: `browser_unavailable` (always under the Node kit: keep a plain `kino.fetch` path), `timeout`, `blocked`,
     * `busy` (another page is open, or the person pressed play and the read was ended), `not_allowed`, `rate_limited`,
     * `invalid_request`.
     */
    function page(url: string, options?: KinoBrowserPageOptions): Promise<KinoBrowserPage>;
  }

  /**
   * Present only in plugins Kino generates from a CloudStream repository. Hand-written plugins never have it.
   * Each call runs the CloudStream provider at index `provider` inside the CloudStream bridge app. Throws a typed
   * error: `not_found` (the provider itself failed), `unavailable` (no bridge, an incompatible plugin, a timeout or a
   * refused request; the message says which), `invalid_request` (the request is over 1 MB).
   */
  namespace cloudstream {
    function search(provider: number, query: string): Promise<{ items: CsItem[] }>;
    function mainPage(provider: number, index: number, page: number): Promise<{ rows: { name: string; items: CsItem[] }[]; hasNext: boolean }>;
    function load(provider: number, url: string): Promise<{ title: CsTitle; episodes: CsEpisode[] }>;
    function loadLinks(provider: number, data: string): Promise<{ links: CsLink[]; subtitles: { lang: string; url: string }[] }>;
  }

  /** apiVersion 4: a marker for a secret the manifest's `secrets` declares (throws for any other name). Kino swaps it for the value in `kino.fetch`, toward the manifest's own hosts only; your code never sees the value. apiVersion 6: a secret declared `{ seal, use: "cipher-key", encoding }` is accepted as the whole `key` of any `kino.crypto.encrypt`/`decrypt` (des-ede3 included), read with the manifest's encoding; it is refused everywhere else, including `kino.fetch`. */
  function secret(name: string): string;

  /** Writes to Kino's log (and console.* does the same); lines are cut at 2000 characters. When a call of a plugin whose manifest says `"telemetry": true` or `"verbose"` (apiVersion 6) fails (a plugin that does not declare it never sends a line; a later Kino build adds a per-device "Enviar registros de errores y de reproducción" switch, on by default, that stops them) (sign and the settings exports included), the last 30 lines it logged (cut at 300 characters, scrubbed of URLs, hosts, ids, secrets and the person's text, 2 KB in all) go with the failure report; never for a call that succeeds. Log what happened, never what the person typed. */
  function log(...args: unknown[]): void;
  namespace log {
    /** apiVersion 6, with `"telemetry": true`: a log line that also tells Kino's error tracker your plugin served a degraded result (a fallback account, a backup source). The line's first word is its area (`[a-z0-9_:]`, with a `_` or `:`, up to 24 characters; anything else is filed as "other"); at most one report per area an hour and 3 per plugin per session, scrubbed like any line. Without telemetry (or, once the per-device switch exists, with it off) it is only a log line. With `"telemetry": "verbose"` a plugin's playback metrics, live/cast problems and edge cases also reach the board (see the README). In a debug build, or while the plugin's "Modo debug" switch is on (every plugin has one in Ajustes; `"debug": true` only makes it on by default), every line is in logcat under `KinoPlugin/<id>` and Kino's playback lines under `KinoPlay`. */
    function report(...args: unknown[]): void;
  }

  namespace html {
    /** Jsoup CSS selectors; at most 500 matches. Only inside Kino. */
    function select(html: string, css: string): KinoHtmlMatch[];
  }

  /**
   * 256 KB in total for this plugin. apiVersion 13, capability "storageLarge" (declarative, nothing to export): 16 MiB in
   * total, 2 MiB per value, at most 1000 keys of at most 256 characters instead, for a plugin that keeps a catalog (shard
   * it into values of about 512 KB); the same API and TTL rules, one file per value on the device. Going over throws
   * code `"too_large"`: "plugin storage full (256 KB)", or with storageLarge "plugin storage full (16 MB)" /
   * "plugin storage full (2 MB per value)" / "plugin storage full (1000 keys)"; a longer key is `"invalid_request"`.
   * The storageLarge store is device-only: never synced and NOT in backups. Declaring storageLarge moves the plugin's
   * existing keys into it, out of the backed-up 256 KB store: keep credentials and sessions in sealed secrets or the
   * person's settings, or in a plugin without the capability.
   */
  namespace storage {
    /** Returns `null` once the entry has expired (see `set`). */
    function get(key: string): string | null;
    /**
     * `options.ttlMs` makes the entry expire: after that many milliseconds, `get` returns `null` and
     * `keys()` leaves it out, even across a restart of the app. A whole number greater than 0,
     * at most 2,592,000,000 ms (30 days); anything else throws before the entry is touched. Leave
     * out `options` (or `ttlMs`) for a permanent entry, exactly as before this option existed. An
     * expired entry never counts against the cap (256 KB, or 16 MiB with storageLarge): it is dropped the next time your plugin
     * reads or writes storage.
     */
    function set(key: string, value: string, options?: { ttlMs?: number }): void;
    function remove(key: string): void;
    /** Expired keys are already gone. */
    function keys(): string[];
  }

  namespace config {
    /** A setting's value (string; boolean for a toggle; an array of `{ [field.key]: string }` for a `list`, apiVersion 4); undefined when unset with no default (a `url` setting never has one). Read-only. */
    function get(key: string): string | boolean | Array<Record<string, string>> | undefined;
    function all(): Record<string, string | boolean | Array<Record<string, string>>>;
  }

  /**
   * apiVersion 13, capability "socket": an outbound WebSocket. `url` must be wss:// (port 443) on a host the manifest declares and the
   * person approved -- never the local network or an IP literal. At most 4 open sockets per plugin and 8 MiB queued unread.
   */
  namespace ws {
    /**
     * Opens the socket and resolves once it is connected. Rejects with an error whose `code` is `"host_not_allowed"` (it
     * also carries the offending `host`), `"not_https"` (not a wss:// address) or `"limit"` (4 sockets already open); also `"network"` and `"timeout"` when the connection cannot be made.
     */
    function open(url: string, options?: { protocol?: string }): Promise<KinoWebSocket>;
  }

  /**
   * apiVersion 13, capability "catalog" (declarative, nothing to export, no consent line): a searchable catalog of your own
   * items, kept by Kino in ONE SQLite database file for your plugin alone, so you can index and search thousands of videos
   * without holding them in your 64 MB of QuickJS memory. Undefined without the capability, and inside `sign()`.
   *
   * Limits (contract.json `catalog`): at most 100,000 items per plugin; `id` 1 to 128 characters; `title` at most 300
   * characters; `data` at most 4,096 bytes of JSON; at most 500 items per `upsert` and 500 ids per `get` or `remove`;
   * `search` `limit` default 50, at most 100, `offset` at most 1,000,000, `q` at most 256 characters; the file at most 64 MiB.
   * Both item limits hold at once: 100,000 items fit only at about 670 bytes of file per item on average (measured with a
   * 50-character title: about 370 bytes with no `data`, about 920 with 500 bytes of `data`, about 4,850 with 4,000 bytes,
   * so only about 13,800 items at that size). Keep `data` small.
   *
   * Every refusal is a KinoError whose `code` says what to do: `"invalid_request"` (a wrong shape or type: fix the call),
   * `"too_large"` (one value or one batch over its limit, named in the message: split it or shorten it), `"limit"` (the
   * catalog is full, 100,000 items or 64 MiB: remove old items first) and `"unavailable"` (Kino could not read or write the
   * file right now: try again later; the message says "damaged and has been reset to empty" when the file was corrupt and
   * Kino started an empty one: rebuild it). A refused `upsert` writes nothing of its batch.
   *
   * Isolation and privacy: no other plugin can read or change your catalog, and your plugin never writes SQL (only these
   * six operations, every value bound). It stays on the device: never synced and NOT in backups, so after a restore or a
   * reinstall it is empty: rebuild it from your source. Credentials and sessions never belong here.
   */
  namespace catalog {
    /**
     * Adds or replaces up to 500 items in one transaction (all or nothing: one bad item refuses its whole batch, so clean
     * them first). Answers how many items were written.
     * @example
     *   const items = videos
     *     .filter((v) => String(v.id).length <= 128)
     *     .map((v) => ({ id: String(v.id), title: String(v.caption || "").slice(0, 300).replace(/[\uD800-\uDBFF]$/, "") || "Video " + v.id, sort: Number.isSafeInteger(v.date) ? v.date : 0, data: { file: String(v.fileRef) } }));
     *   for (let i = 0; i < items.length; i += 500) await kino.catalog.upsert(items.slice(i, i + 500));
     */
    function upsert(items: KinoCatalogUpsertItem[]): Promise<{ count: number }>;
    /**
     * One page of the items whose title holds every word of `q` (case and accents ignored), plus `total`, the count of
     * every match. Reads only the page asked for.
     * @example
     *   const offset = 40;
     *   const page = await kino.catalog.search({ q: "pelicula 2001", limit: 20, offset, order: "newest" });
     *   const more = page.total > offset + page.items.length;
     */
    function search(options?: KinoCatalogSearchOptions): Promise<KinoCatalogPage>;
    /**
     * The items with these ids (at most 500 per call), in the order asked; an id that is not there is skipped and a repeated
     * one comes once.
     * @example
     *   const [item] = await kino.catalog.get([ref]); // ref: the catalog id your resolve(ref) got
     */
    function get(ids: string[]): Promise<KinoCatalogItem[]>;
    /**
     * Deletes the items with these ids (at most 500 per call). Answers how many were there and are now gone.
     * @example
     *   await kino.catalog.remove(staleIds);
     */
    function remove(ids: string[]): Promise<{ count: number }>;
    /**
     * Deletes every item: Kino deletes the file itself, so the space goes back to the device.
     * @example
     *   await kino.catalog.clear(); // then upsert everything again
     */
    function clear(): Promise<void>;
    /**
     * How many items the catalog holds.
     * @example
     *   if ((await kino.catalog.count()) === 0) await rebuild();
     */
    function count(): Promise<number>;
  }

  /**
   * apiVersion 13, capability "qrScan" (declarative, nothing to export, no consent line): ask the person to scan a QR code
   * with the phone's camera. Undefined without the capability, and inside `sign()`.
   *
   * Kino opens its own camera scanner full screen over whatever the person was doing. At the top it shows, from the top:
   * "<your plugin's installed name> wants to read a QR code", your `title` (your `titleEn` when Kino speaks English, else
   * `title`; each at most 80 characters, at most two lines on screen, with no control, bidi or format character), and
   * Kino's instruction; a close button beside them. The first code the camera decodes that holds 1 to 4,096 characters
   * answers the call; a longer one is ignored, the scanner says "This code is not valid for <your plugin>" and keeps looking.
   *
   * Rules: only from a settings `action` or a `panelAction` (the person pressed one of your buttons), never from Home,
   * search, a play, a list, a title page, your section, `settingsStatus` or any background call; that call's own time limit
   * stops while the scanner is up. At most one scan on screen at a time, for the whole app. The scanner closes by itself
   * after 120 s. On a device without a camera, and on Kino's TV interface, it never opens.
   *
   * Errors (a KinoError whose `code` says what to do): `"busy"` (a scan is already open, yours or another plugin's: wait
   * for it), `"timeout"` (nothing was scanned in 120 s: offer to try again), `"unavailable"` (this device cannot scan: no
   * camera, or a TV: show the code another way, such as a settings `qr` setting), `"not_allowed"` (called from anything but
   * a settings `action` or a `panelAction`: "kino.qr.scan only runs from a settings action or panelAction"; scan from a
   * button), `"permission_denied"` (the person did not give Kino the camera: say they can allow it in the phone's
   * settings) and `"invalid_request"` (a `title` or `titleEn` that is not a string, is over 80 characters or holds a
   * control or formatting character: fix the call).
   *
   * Privacy: you get only the decoded text of the code the person pointed the camera at, never an image; it is data from
   * the world (check it before you trust it), and only your plugin gets it.
   *
   * To SHOW a QR instead (say, on the new device a login is for), use a settings `qr` setting: `{ "key": "login", "label":
   * "...", "type": "qr", "refreshMs": 5000 }`, whose text is your `settingsStatus()` answer under that key (at most 512
   * characters); Kino asks again when the form opens, after every action and every `refreshMs` (2000 to 60000) while the
   * form is on screen, so a code that expires is replaced in place.
   */
  namespace qr {
    /**
     * Opens the scanner; resolves with the scanned text, or null when the person closed the scanner (the close button,
     * Back, leaving the screen).
     * @example
     *   // In action("link"): the person pressed "Vincular otro aparato" in your settings.
     *   let text;
     *   try {
     *     text = await kino.qr.scan({ title: "Escanea el código del otro aparato", titleEn: "Scan the other device's code" });
     *   } catch (e) {
     *     if (e.code === "unavailable") return { message: "Este aparato no puede escanear: usa tu teléfono" };
     *     if (e.code === "permission_denied") return { message: "Permite la cámara en los ajustes del teléfono" };
     *     throw e;
     *   }
     *   if (text === null) return { message: "Cancelado" };
     *   if (!text.startsWith("exampleapp://login?token=")) return { message: "Ese no es un código de inicio de sesión" };
     *   await acceptLogin(text);
     *   return { message: "Listo: el otro aparato ya entró" };
     */
    function scan(options?: { title?: string; titleEn?: string }): Promise<string | null>;
  }

  namespace cookies {
    /** The value of cookie `name` for `url` (a host the plugin may reach), or null. */
    function get(url: string, name: string): string | null;
    /** Forgets every cookie of this plugin (they also go when its settings change). */
    function clear(): void;
  }

  namespace crypto {
    /** Default input utf8, output hex. Data at most 5 MB. Errors carry code "crypto_error". */
    function hash(alg: "md5" | "sha1" | "sha256" | "sha512", data: string, options?: { inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    function hmac(alg: "md5" | "sha1" | "sha256" | "sha512", key: string, data: string, options?: { keyEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /** GCM appends the 16-byte tag to the ciphertext. */
    function encrypt(alg: KinoCipher, options: KinoCipherOptions): string;
    /** GCM expects the 16-byte tag appended. */
    function decrypt(alg: KinoCipher, options: KinoCipherOptions): string;
    /** iterations at most 100000, keyLength at most 64 bytes. Password uses keyEncoding, salt inputEncoding. */
    function pbkdf2(hash: "sha1" | "sha256" | "sha512", password: string, salt: string, iterations: number, keyLength: number, options?: { keyEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /**
     * apiVersion 13: MTProto's AES-256-IGE (`c_i = E(m_i xor c_{i-1}) xor m_{i-1}`). `dir` is "encrypt" or "decrypt"; `key` is
     * 32 bytes, `iv` 32 bytes (two blocks) and `data` a multiple of 16 bytes, each read with its encoding (key and iv with
     * keyEncoding/ivEncoding, data with inputEncoding; default utf8). Output base64 by default. Anything malformed fails
     * with the fixed text "invalid crypto operation". A sealed value is refused in every field.
     */
    function aesIge(dir: "encrypt" | "decrypt", key: string, iv: string, data: string, options?: { keyEncoding?: KinoEncoding; ivEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /**
     * apiVersion 13: `base ^ exp mod mod` over big-endian hex strings (no 0x prefix; each at most 4096 bits). The answer is hex,
     * left-padded with zeros to the modulus' byte width. A zero modulus or an empty string in any of the three fails with
     * "invalid crypto operation" (write zero as "0").
     */
    function modPow(base: string, exp: string, mod: string): string;
    /** apiVersion 13: inflates a gzip stream (input base64 by default, output utf8 by default); the output is at most 5 MB. */
    function gunzip(data: string, options?: { inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /**
     * apiVersion 13 (Kino's own version, not the manifest's: feature-detect with `typeof kino.crypto.convert === "function"`):
     * `data` read in `from` and written in `to` (`"hex"` to `"base64"` and back, `"utf8"` to bytes...), in native
     * code: no JavaScript loop over the bytes. Hex comes out lower case, base64 padded with the standard alphabet; base64 in may
     * be URL-safe or unpadded. At most 5 MB of bytes. A bad input fails with `"data" is not valid hex` / `base64`, an unknown
     * encoding with `unknown encoding: <name>`. A sealed value is refused.
     */
    function convert(data: string, from: KinoEncoding, to: KinoEncoding): string;
    /**
     * apiVersion 13 (Kino's own version, not the manifest's: feature-detect with `typeof kino.crypto.aesIgeVerify === "function"`):
     * AES-256-IGE decryption (as `aesIge("decrypt", ...)`) checked by a MAC in the same call: the SHA-256 digest of
     * `macPrefix` followed by the plaintext, bytes `macOffset` to `macOffset + mac.length` (1 to 32 bytes inside the 32-byte digest),
     * must equal `mac`, compared in constant time. On a match it answers the plaintext (base64 by default); on a mismatch it fails
     * with the fixed text "the mac doesn't match" and answers nothing. `mac` and `macPrefix` are read with `macEncoding` (default
     * hex), `key`/`iv`/`data` as in `aesIge`. MTProto 2.0's msg_key check is `macPrefix` = 32 bytes of the auth key, `macOffset` 8,
     * `mac` = the 16-byte msg_key. Anything malformed (sizes, an offset that is not a whole number or runs past the digest) fails
     * with "invalid crypto operation". A sealed value is refused in every field.
     */
    function aesIgeVerify(key: string, iv: string, data: string, options: { mac: string; macPrefix?: string; macOffset?: number; macEncoding?: KinoEncoding; keyEncoding?: KinoEncoding; ivEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /** 1..1024 bytes, hex by default. */
    function randomBytes(n: number, outputEncoding?: KinoEncoding): string;
    /** A random (v4) UUID. */
    function uuid(): string;
    /**
     * apiVersion 6: a new key pair. The private key stays inside Kino: you get a handle that works only in this
     * runtime (not in sign()'s signing lane, not after the plugin restarts) and is gone when it closes; at most 64
     * live at once (a new one drops the oldest). Node's generateKeyPairSync / WebCrypto's generateKey map here.
     */
    function generateKeyPair(options: { type: "ec"; namedCurve: "P-256" | "P-384" } | { type: "ed25519" } | { type: "x25519" }): { readonly privateKey: KinoPrivateKey; readonly publicKey: KinoPublicKey };
    /** apiVersion 6: a peer's public key (jwk object, spki base64, or raw base64 with `type` and, for ec, `namedCurve`). Private keys cannot be imported. */
    function importKey(options: { format: "jwk"; key: KinoJwk } | { format: "spki"; key: string } | { format: "raw"; key: string; type: KinoKeyType; namedCurve?: "P-256" | "P-384" }): KinoPublicKey;
    /**
     * apiVersion 6: signs `data` (read with `encoding`, default utf8) with your private key; base64 by default.
     * ec: `hash` "SHA-256" (default) or "SHA-384"; `format` "der" (default, Node's crypto.sign) or "ieee-p1363"
     * (r||s, 64 bytes on P-256, 96 on P-384: WebCrypto's). ed25519: 64 bytes, no `hash`. x25519 does not sign.
     */
    function sign(options: { key: KinoPrivateKey | string; data: string; encoding?: KinoEncoding; hash?: "SHA-256" | "SHA-384"; format?: "der" | "ieee-p1363"; outputEncoding?: "base64" | "hex" }): string;
    /** apiVersion 6: true when `signature` (base64 by default) is valid for `data`; a malformed signature is false. `key`: a public key, a `{ jwk }`, or your own private key. */
    function verify(options: { key: KinoPublicKey | { jwk: KinoJwk } | KinoPrivateKey | string; data: string; encoding?: KinoEncoding; signature: string; signatureEncoding?: KinoEncoding; hash?: "SHA-256" | "SHA-384"; format?: "der" | "ieee-p1363" }): boolean;
    /** apiVersion 6: ECDH (ec, same curve) or X25519: the shared secret, base64 by default (32 bytes; 48 on P-384). */
    function deriveSharedSecret(options: { privateKey: KinoPrivateKey | string; publicKey: KinoPublicKey | { jwk: KinoJwk }; outputEncoding?: "base64" | "hex" }): string;
  }

  namespace rank {
    /**
     * The title's HEAD, up to its first `:`, `,`, `|`, en dash or em dash -- for a search backend
     * that ranks a short query better than a long one. A one- or two-letter head identifies
     * nothing, so the whole (trimmed) text comes back instead; a plain "-" is never a cut point (it
     * would split a hyphenated word like "Spider-Man").
     */
    function shortQuery(query: string): string;
    /**
     * Reorders `items` so the ones sharing the most words with `query` come first; ties keep
     * `items`' own order. `query` is a title, or several forms of one (try `query.q`,
     * `query.originalTitle` and `query.altTitles` together: a backend may only know a title in one
     * language). `getTitle` reads a title off an item, string or array of them; it defaults to
     * `(item) => item.title`. Never throws: `items` not an array answers `[]`; an item with no
     * usable title (missing, not a string, or `getTitle` itself failing) sorts after every item
     * that has one, in `items`' own order among themselves.
     */
    function sortBySimilarity(items: any[], query: string | string[], getTitle?: (item: any) => string | string[]): any[];
    /**
     * Drops items sharing too few words with `query` (under 60% of its distinctive words of 3+
     * letters), and any item with no usable title along with them. Never throws: `items` not an
     * array answers `[]`. Reordering alone (`sortBySimilarity`) still shows a full page of near-misses when
     * the title genuinely is not on the backend, so an absent title comes back with 0 results
     * instead.
     */
    function filterRelevant(items: any[], query: string | string[], getTitle?: (item: any) => string | string[]): any[];
  }
}

// ---------- web globals Kino adds (QuickJS has none of them natively) ----------
// URL, URLSearchParams, atob, btoa, TextEncoder and TextDecoder (UTF-8 only) behave like the
// browser's, without IDN/punycode. Use the lib "dom" typings, or declare them in your editor.

/**
 * The manifest's optional `categories` (every apiVersion; read only by Kino's plugin marketplace for its category chips).
 * A list without repeats; when present it replaces what Kino guesses from the capabilities.
 */
type KinoManifestCategory = "movies" | "series" | "anime" | "live" | "radio" | "subtitles" | "utilities" | "adult";

/**
 * apiVersion 6, capability "meta": what `meta(query)` is asked about a title ANOTHER source listed (never one of your own),
 * as the app's TitleMetaQuery builds it. Keys appear only when known; Kino asks nobody about a title with no id at all.
 */
interface KinoMetaQuery {
  type: "movie" | "series";
  /** Every id Kino knows for the title (from the card, TMDB or its anime mapping); each one only when known, never 0 or "". */
  ids: { imdb?: string; tmdb?: number; kitsu?: number; mal?: number; anilist?: number };
  /** The title's own Stremio-style id in its source ("kitsu:1376", "tt0944947"), only for a Stremio addon's title. */
  id?: string;
  /** The person's language ("es"). */
  lang?: string;
}

/**
 * `meta`'s answer (or null: a title you do not know -- not a failure). Every field optional; Kino only fills what TMDB and
 * AniList left empty, and an answer with only `year` and/or `runtimeMinutes` counts as none. Text fields may also be numbers
 * (read as text); each is trimmed and cut, and anything Kino cannot use is dropped on its own (`node sdk/run.mjs . meta`
 * says which and why). Images follow an item's poster rule: http(s), a public name or IPv4 (http never to a name without
 * a dot), or the person's own server; a URL longer than 2048 characters is dropped, so keep them shorter. Fields not
 * listed here are ignored.
 */
interface KinoTitleMeta {
  /** Read (up to 200 characters) but not shown: the page keeps the source's own title. */
  title?: string | number;
  /** Up to 2000 characters; HTML tags are stripped on the page. */
  overview?: string | number;
  poster?: string;
  backdrop?: string;
  /** Only its first 9 characters are read, and their first four digits are the year: 1999, "1999", "1999-2003". */
  year?: string | number;
  /** Strings only, trimmed, up to 30 characters each; the first 5 non-empty ones. */
  genres?: string[];
  /** 1..1000 (a numeric string or a decimal is read as Android's JSON optInt does). Shown only for a movie. */
  runtimeMinutes?: number | string;
  /**
   * At most 5000 entries read (invalid ones count); `season` 0..999 (0 kept, but never listed on the page), `number`
   * 1..99999, one per season and number (the first wins), sorted. Texts as an item's; `airDate` "YYYY-MM-DD";
   * `id` (up to 4096 characters) the episode's Stremio-style video id.
   */
  episodes?: { season: number | string; number: number | string; title?: string | number; overview?: string | number; still?: string; airDate?: string; id?: string | number }[];
  /** Kino 0.9.51+: a clear-logo of the title, shown instead of its name on the info page. */
  logo?: string;
  /**
   * Kino 0.9.51+: one per source (the first valid one wins; `source` is case-insensitive), at most 6 kept; added to the
   * page's score, never replacing it (a `tmdb` one is left out when the page has a score). `value`: up to 3 digits, up to 2
   * decimals with "." or ",", then optionally "%" or "/N" ("8.8", "94%", "4.1/5", "72/100"); a number >= 0 is written
   * without trailing zeros (8.80 is "8.8").
   */
  ratings?: { source: "imdb" | "tmdb" | "rottentomatoes" | "metacritic" | "letterboxd" | "mal" | "anilist" | "trakt"; value: string | number }[];
  /**
   * Kino 0.9.51+: at most 20 with a name, one per name (the first wins); `name` and `character` up to 60 characters.
   * Shown only when TMDB has no cast, as "Reparto:" with the first 5 names; `character` and `photo` are kept, not shown.
   */
  cast?: { name: string | number; character?: string | number; photo?: string }[];
}

/**
 * `meta` -- required with the capability "meta" (apiVersion 6). Asked with every other meta plugin at once; the first
 * answer in install order wins, within 6 s (a timeout or a throw is just no answer, never shown), remembered 30 minutes.
 */
type KinoMetaFn = (query: KinoMetaQuery) => Promise<KinoTitleMeta | null>;

/**
 * apiVersion 11, manifest field `"externalResolver"` (needs the `externalResolve` capability): the resolver app this
 * plugin wants by default, and optionally where to get it when it isn't installed.
 *
 *     "externalResolver": {
 *       "package": "com.example.resolver",
 *       "apk": { "url": "https://github.com/acme/resolver/releases/download/v1.0/resolver.apk", "sha256": "<64 hex>", "label": "Example Resolver" },
 *       "fdroid": true,
 *       "downloader": { "code": "1234567" }
 *     }
 *
 * `apk.url` must be a GitHub release asset (`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`) or an archive.org
 * file (`https://archive.org/download/<item>/<file>`); nothing else is
 * ever downloaded. It is offered only for exactly `package`, and only handed to the installer if the file's sha256 matches.
 * Three independent ways to get the app when it is not installed, each optional: `apk` (above); `fdroid: true` (the same
 * `package` is listed in F-Droid: Kino opens F-Droid for exactly that package; the official F-Droid client has no real Android TV
 * support, so on a TV prefer the others); `downloader.code` (3 to 10 digits: a Downloader code for TV sideloading, which Kino only
 * SHOWS, with a button to open the Downloader app when it is installed). Kino offers only what the manifest declares for exactly
 * `package`. With none of them (or if the stream names another package) a missing resolver just fails with "resolver not found".
 * A stream's `external.resolver` overrides `package`; without either, any installed app declaring the protocol may be asked.
 */
interface KinoManifestExternalResolver {
  package: string;
  apk?: { url: string; sha256: string; label?: string };
  /** Only `true` means anything: this `package` is listed in F-Droid. */
  fdroid?: true;
  /** A Downloader app code (3 to 10 digits) that fetches the app, for a TV. Shown, never installed by Kino. */
  downloader?: { code: string };
}

/**
 * apiVersion 12, capability `"syncProvider"`: the plugin is the transport of the person's cross-device sync. Kino keeps the logic
 * (what is synced, merging, when to run) and encrypts the snapshot before handing it over; the plugin only stores and returns an
 * opaque blob, byte for byte. Needs the exports `syncPull` and `syncPush`; `syncStatus` is optional.
 * Who can read the data: the key is derived from one of your own settings (`sync.keySecret`, required), which your code reads, so
 * the plugin and its service CAN read the synced data; the install sheet says so in red ("Sincronizará tus datos a través de su
 * servicio: el plugin y su servicio podrán leerlos"). An update that adds the capability waits for the person's approval again.
 */
interface KinoSyncContext {
  /**
   * The largest blob, in bytes after decoding, Kino will send or accept: the manifest's `maxBlobBytes`, at most 4194304 (4 MiB).
   * Kino 0.9.74: while `syncPull`/`syncPush` run (only then), `kino.fetch` requests and response bodies, and the call's answer,
   * may reach ceil(maxBlobBytes * 4/3) + 65536 characters/bytes instead of 1 MB / 5 MB, so the base64 blob fits in one request.
   */
  maxBlobBytes: number;
}

/**
 * `syncPull` -- required with the capability "syncProvider". The latest stored blob and its version, or null when nothing is stored yet.
 * Every sync export receives ONE argument (an object, or null for `syncStatus`). `blob` is standard base64 (RFC 4648, `+` and `/`,
 * padded) WITHOUT line breaks, in both directions.
 */
type KinoSyncPullFn = (arg: KinoSyncContext) => Promise<{ blob: string /* base64 ciphertext */; version: string } | null>;

/**
 * `syncPush` -- required with the capability "syncProvider". Store `blob` (base64 ciphertext, sealed with the key Kino derives from `sync.keySecret`) and return
 * the new opaque `version`. `arg.expectedVersion` is the version Kino last pulled (null if none): a provider that can detect that the remote
 * changed since throws `{ code: "conflict" }` and Kino pulls, merges and pushes again; one that cannot ignores it.
 */
type KinoSyncPushFn = (arg: KinoSyncContext & { blob: string; expectedVersion: string | null }) => Promise<{ version: string }>;

/** `syncStatus` -- optional with the capability "syncProvider": the status line of the plugin's sync settings. */
type KinoSyncStatusFn = (arg: null) => Promise<{ ready: boolean; message?: string }>;

/**
 * apiVersion 12, manifest field `"sync"` (needs the `syncProvider` capability; refused without it). Required with that capability:
 * a provider without a `sync` block or without `keySecret` is refused. Every key but `keySecret` and `provision` is optional:
 *
 *     "sync": { "mode": "poll", "pullEveryMs": 600000, "pushDebounceMs": 300000, "maxBlobBytes": 4194304,
 *               "keySecret": "botToken", "provision": ["botToken", "chatId"] }
 *
 * `mode` is `"poll"` (default: Kino pulls on foreground and every `pullEveryMs`) or `"realtime"` (the provider signals remote changes).
 * Both times are positive whole milliseconds (defaults 600000 and 300000); Kino clamps them to its own floors. `maxBlobBytes` is the
 * largest blob the provider accepts (default and maximum 4194304).
 *
 * `keySecret` (required) is the `key` of one of the plugin's own `"password"` settings (anything else refuses the manifest). Kino
 * derives the sync key from that setting's value on each device (HKDF-SHA256, host side), so the key never travels: a second device
 * only needs the same settings (for example the same bot token). The derivation is public and your code reads the setting, so the
 * plugin and its service CAN read the synced data (the consent sheet says so in red). It must be a long random token
 * (a bot token, an API key), never a password a person picks: anyone holding a stored blob can try guesses offline. That setting
 * must not declare a `default` (the manifest is refused): the person types it, and until then Kino runs no sync round. There is no
 * key without it: a key one device made up could never reach another. Changing that setting's value changes the key: the copy
 * stored remotely then no longer opens until the person resets sync on one device and gives the new value to the others.
 *
 * `provision` (required) lists the `key`s of your own settings (secret or not, at most 8, no repeats) that pairing hands to another
 * device so it can run the same provider, for example `["botToken", "chatId"]`. It must include `keySecret`. From apiVersion 13 it
 * may name a `"sync": false` password (a one-shot secret such as a 2FA password): sent only while it holds a value, named by its
 * label on both screens, stored sealed and device-only on the receiver (never synced nor backed up); your plugin clears it once
 * used. `keySecret` itself can never be a `"sync": false` password.
 *
 * `generateKey` (apiVersion 13, default false): Kino makes the `keySecret` value itself, 32 random bytes as 64 lower-case hex
 * characters, while that setting is empty: when the person switches the provider on, and when they press "Enviar configuración"
 * (before the values are read, so an empty key never hides that button). It is saved sealed like a typed password, never
 * logged and never drawn in your form; a value that exists is never replaced, and one received from another device replaces it.
 */
interface KinoManifestSync {
  mode?: "poll" | "realtime";
  pullEveryMs?: number;
  pushDebounceMs?: number;
  maxBlobBytes?: number;
  keySecret: string;
  provision: string[];
  generateKey?: boolean;
}
