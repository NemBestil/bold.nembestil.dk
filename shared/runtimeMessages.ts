/** Runtime notices stay canonical on the wire. Each screen translates them at
 * render time, so changing one device's language cannot change another's. */
export type GameLocale = "da" | "en" | "tr";
type Translation = Readonly<{ en: string; tr: string; da?: string }>;

export function normalizeGameLocale(locale?: string): GameLocale {
  const language = locale?.toLowerCase().split(/[-_]/, 1)[0];
  return language === "da" || language === "tr" ? language : "en";
}

const entries: readonly (readonly [string, string, string])[] = [
  ["Sessionen er lukket.", "The session is closed.", "Oturum kapatıldı."],
  ["Din tidligere plads er udløbet. Forbind igen for at vælge en ny plads.", "Your previous seat has expired. Reconnect to choose a new seat.", "Önceki yerinizin süresi doldu. Yeni bir yer seçmek için yeniden bağlanın."],
  ["Denne spiller er allerede forbundet.", "This player is already connected.", "Bu oyuncu zaten bağlı."],
  ["Alle pladser ved bordet er optaget af spillere.", "All seats at the table are taken.", "Masadaki tüm yerler dolu."],
  ["Kampen er i gang. Brug den oprindelige telefon til at genoprette forbindelsen.", "The match is in progress. Reconnect using your original phone.", "Maç devam ediyor. Yeniden bağlanmak için aynı telefonu kullanın."],
  ["Forbindelsen blev afbrudt. Vent på alle telefoner; den første controller kan så fortsætte kampen.", "The connection was lost. Wait for all phones to reconnect; the first controller can then resume the match.", "Bağlantı kesildi. Tüm telefonların yeniden bağlanmasını bekleyin; ardından ilk kontrolcü maçı devam ettirebilir."],
  ["Ugyldig besked.", "Invalid message.", "Geçersiz mesaj."],
  ["Spilleren er ikke forbundet.", "The player is not connected.", "Oyuncu bağlı değil."],
  ["Holdets pladser er optaget.", "This team's seats are taken.", "Bu takımın yerleri dolu."],
  ["Computerniveauet kan ændres før kampen eller under en pause.", "You can change the computer difficulty before the match or while paused.", "Bilgisayarın zorluk seviyesini maçtan önce veya maç duraklatıldığında değiştirebilirsiniz."],
  ["Denne plads styres af en spiller.", "A player controls this seat.", "Bu yeri bir oyuncu kontrol ediyor."],
  ["Holdnavnet vælges før kampen.", "Choose the team name before the match.", "Takım adını maçtan önce seçin."],
  ["Den første spiller på holdet vælger holdnavnet.", "The first player on the team chooses its name.", "Takıma katılan ilk oyuncu takımın adını seçer."],
  ["Kampen er allerede startet.", "The match has already started.", "Maç zaten başladı."],
  ["Vælg hold, før du melder klar.", "Choose a team before marking yourself ready.", "Hazır olduğunuzu belirtmeden önce bir takım seçin."],
  ["Kampen er ikke aktiv.", "The match is not active.", "Maç aktif değil."],
  ["Denne stang styres af din medspiller.", "Your teammate controls this rod.", "Bu çubuğu takım arkadaşınız kontrol ediyor."],
  ["Input er forældet.", "This input is outdated.", "Bu kontrol girdisi güncel değil."],
  ["Bump er forældet.", "This bump request is outdated.", "Bu sarsma isteği güncel değil."],
  ["Bump kræver, at bolden næsten ligger stille, og at pausen mellem bump er udløbet.", "You can bump only when the ball is nearly still and the bump cooldown has ended.", "Masayı yalnızca top neredeyse duruyorken ve sarsmalar arasındaki bekleme süresi dolduğunda sarsabilirsiniz."],
  ["Kun lobbyadministratoren kan ændre fælles indstillinger.", "Only the lobby administrator can change shared settings.", "Ortak ayarları yalnızca lobi yöneticisi değiştirebilir."],
  ["Pladser vælges på controlleren; grafik vælges på hver skærm.", "Choose seats on the controller and graphics on each screen.", "Yerler kontrolcüden, grafik ayarları ise her ekrandan ayrı seçilir."],
  ["Alle telefoner skal være forbundet og have valgt en plads.", "All phones must be connected and have a seat selected.", "Tüm telefonlar bağlı olmalı ve bir yer seçmiş olmalıdır."],
  ["Den første controller genoptager kampen.", "The first controller resumes the match.", "Maçı ilk kontrolcü devam ettirir."],
  ["Kampen er ikke slut endnu.", "The match has not ended yet.", "Maç henüz bitmedi."],
  ["Afslut kampen, før der startes en ny kamp.", "Finish the current match before starting a new one.", "Yeni bir maça başlamadan önce mevcut maçı bitirin."],
  ["Der er ingen aktiv kamp at pause.", "There is no active match to pause.", "Duraklatılacak aktif bir maç yok."],
  ["Sæt kampen på pause, før den forlades.", "Pause the match before leaving it.", "Maçtan ayrılmadan önce maçı duraklatın."],
  ["Antal spillere og computer vælges i lobbyen før kampen.", "Choose the player count and computer settings in the lobby before the match.", "Oyuncu sayısını ve bilgisayar ayarlarını maçtan önce lobide seçin."],
  ["Spilindstillingerne er ugyldige.", "The match settings are invalid.", "Maç ayarları geçersiz."],
  ["Indstillinger kan ændres før kampen eller under en pause.", "You can change settings before the match or while paused.", "Ayarları maçtan önce veya maç duraklatıldığında değiştirebilirsiniz."],
  ["Pladser vælges før kampen.", "Choose seats before the match.", "Yerleri maçtan önce seçin."],
  ["Pladsen er allerede taget af en anden spiller.", "Another player has already taken this seat.", "Bu yeri başka bir oyuncu aldı."],
  ["Den første controller starter kampen.", "The first controller starts the match.", "Maçı ilk kontrolcü başlatır."],
  ["Alle tilsluttede telefoner skal vælge en ledig plads først.", "Every connected phone must choose an available seat first.", "Önce bağlı her telefonun boş bir yer seçmesi gerekir."],
  ["PeerJS Cloud svarer ikke. Kontrollér internetforbindelsen. Prøver igen…", "PeerJS Cloud is not responding. Check your internet connection. Retrying…", "PeerJS Cloud yanıt vermiyor. İnternet bağlantınızı kontrol edin. Yeniden deneniyor…"],
  ["Hosten er ikke tilgængelig. Hold host-siden åben på den store skærm.", "The host is unavailable. Keep the host page open on the large screen.", "Ana cihaza ulaşılamıyor. Ana cihaz sayfasını büyük ekranda açık tutun."],
  ["Browseren understøtter ikke WebRTC. Brug en nyere browser.", "Your browser does not support WebRTC. Use a newer browser.", "Tarayıcınız WebRTC'yi desteklemiyor. Daha güncel bir tarayıcı kullanın."],
  ["Forbindelsen blev afbrudt. Prøver igen automatisk.", "The connection was lost. Retrying automatically.", "Bağlantı kesildi. Otomatik olarak yeniden deneniyor."],
  ["Signaleringsforbindelsen genoprettes…", "Reconnecting to the signaling service…", "Sinyalleşme hizmetine yeniden bağlanılıyor…"],
  ["Netværksmodulet kunne ikke indlæses. Prøver igen…", "The network module could not load. Retrying…", "Ağ modülü yüklenemedi. Yeniden deneniyor…"],
  ["Sessionslinket er ugyldigt. Scan QR-koden på host-skærmen igen.", "The session link is invalid. Scan the QR code on the host screen again.", "Oturum bağlantısı geçersiz. Ana cihazın ekranındaki QR kodunu yeniden tarayın."],
  ["Forbindelsen genoprettes automatisk. Kampen venter på dig.", "Reconnecting automatically. The match is waiting for you.", "Otomatik olarak yeniden bağlanılıyor. Maç sizi bekliyor."],
  ["Forbinder til bordet…", "Connecting to the table…", "Masaya bağlanılıyor…"],
  ["Forbindelseslinket mangler en gyldig session. Scan QR-koden på bordets skærm.", "The connection link has no valid session. Scan the QR code on the table's screen.", "Bağlantıda geçerli bir oturum yok. Masanın ekranındaki QR kodunu tarayın."],
  ["Signaleringsforbindelsen genoprettes. Eksisterende spilforbindelser kan fortsætte.", "Reconnecting to the signaling service. Existing game connections can continue.", "Sinyalleşme hizmetine yeniden bağlanılıyor. Mevcut oyun bağlantıları devam edebilir."],
  ["Netværksinvitationen blev lukket. Åbn den igen for at forbinde flere telefoner.", "The network invitation was closed. Open it again to connect more phones.", "Ağ daveti kapatıldı. Daha fazla telefon bağlamak için yeniden açın."],
  ["PeerJS Cloud svarer ikke. Kontrollér internetforbindelsen, og prøv igen.", "PeerJS Cloud is not responding. Check your internet connection and try again.", "PeerJS Cloud yanıt vermiyor. İnternet bağlantınızı kontrol edip yeniden deneyin."],
  ["Signaleringsserveren svarede ikke.", "The signaling server did not respond.", "Sinyalleşme sunucusu yanıt vermedi."],
  ["Netværksinvitationen blev lukket.", "The network invitation was closed.", "Ağ daveti kapatıldı."],
  ["Vent på, at host-sessionen er forbundet.", "Wait for the host session to connect.", "Ana cihazın oturuma bağlanmasını bekleyin."],
  ["Der blev sendt for mange beskeder. Forbind igen.", "Too many messages were sent. Reconnect.", "Çok fazla mesaj gönderildi. Yeniden bağlanın."],
  ["Bord og controller bruger forskellige udgaver. Åbn forsiden igen og del det nye link.", "The table and controller use different versions. Open the home page again and share the new link.", "Masa ve kontrolcü farklı sürümler kullanıyor. Ana sayfayı yeniden açıp yeni bağlantıyı paylaşın."],
  ["Ugyldig netværksbesked.", "Invalid network message.", "Geçersiz ağ mesajı."],
  ["Forbindelsen blev ikke godkendt.", "The connection was not approved.", "Bağlantı onaylanmadı."],
  ["Adgang afvist.", "Access denied.", "Erişim reddedildi."],
  ["Forbindelsen er allerede godkendt.", "The connection is already approved.", "Bağlantı zaten onaylandı."],
  ["Denne skærm viser kampen. Brug en telefon til at spille.", "This screen displays the match. Use a phone to play.", "Bu ekran maçı gösterir. Oynamak için bir telefon kullanın."],
  ["Beskeden blev afvist.", "The message was rejected.", "Mesaj reddedildi."],
  ["Browseren understøtter ikke WebRTC. Brug en nyere Safari, Chrome, Firefox eller Edge.", "Your browser does not support WebRTC. Use an up-to-date Safari, Chrome, Firefox or Edge.", "Tarayıcınız WebRTC'yi desteklemiyor. Güncel bir Safari, Chrome, Firefox veya Edge kullanın."],
  ["PeerJS Cloud kunne ikke kontaktes. Kontrollér internetforbindelsen.", "Could not reach PeerJS Cloud. Check your internet connection.", "PeerJS Cloud'a ulaşılamadı. İnternet bağlantınızı kontrol edin."],
  ["Sessions-id er allerede i brug. Genindlæs siden for at oprette en ny session.", "This session ID is already in use. Reload the page to create a new session.", "Bu oturum kimliği zaten kullanılıyor. Yeni bir oturum oluşturmak için sayfayı yenileyin."],
  ["Der opstod en forbindelsesfejl. Kontrollér netværket, og prøv igen.", "A connection error occurred. Check your network and try again.", "Bağlantı hatası oluştu. Ağınızı kontrol edip yeniden deneyin."],
  ["Browseren understøtter ikke sikker oprettelse af sessions-id.", "Your browser cannot securely create a session ID.", "Tarayıcınız güvenli bir oturum kimliği oluşturamıyor."],
  ["TURN unavailable", "The TURN relay is unavailable.", "TURN aktarma sunucusuna ulaşılamıyor."],
  ["Invalid TURN configuration", "The TURN configuration is invalid.", "TURN yapılandırması geçersiz."],
  ["Gør jer klar", "Get ready", "Hazır olun"],
  ["Kampen er sat på pause", "The match is paused", "Maç duraklatıldı"],
  ["Kampen fortsætter", "The match is resuming", "Maç devam ediyor"],
  ["Bolden serveres", "The ball is being served", "Top oyuna sokuluyor"],
  ["Kampens mål", "Match highlights", "Maçın golleri"],
  ["Hele kampen", "Full match", "Maçın tamamı"],
  ["Det sidste sekund · Slowmotion", "The final second · Slow motion", "Son saniye · Ağır çekim"],
  ["De sidste berøringer", "The final touches", "Son dokunuşlar"],
  ["Rødt hold", "Red team", "Kırmızı takım"],
  ["Blåt hold", "Blue team", "Mavi takım"],
  ["rødt hold", "red team", "kırmızı takım"],
  ["blåt hold", "blue team", "mavi takım"],
  ["Ny bold om", "Next ball in", "Yeni top için"],
  ["Bolden er ude", "The ball is out", "Top dışarıda"],
  ["Replayfilen er for stor.", "The replay file is too large.", "Tekrar dosyası çok büyük."],
  ["Replayfilen er tom eller for stor.", "The replay file is empty or too large.", "Tekrar dosyası boş veya çok büyük."],
  ["Denne browser kan ikke åbne komprimerede replays. Prøv en nyere browser.", "This browser cannot open compressed replays. Try a newer browser.", "Bu tarayıcı sıkıştırılmış tekrarları açamıyor. Daha güncel bir tarayıcı deneyin."],
  ["Replayfilen kunne ikke pakkes ud.", "The replay file could not be decompressed.", "Tekrar dosyası sıkıştırmadan çıkarılamadı."],
  ["Replayfilen indeholder ikke gyldige replaydata.", "The replay file does not contain valid replay data.", "Tekrar dosyası geçerli tekrar verileri içermiyor."],
  ["Filen indeholder ikke en færdig kamp.", "The file does not contain a completed match.", "Dosya tamamlanmış bir maç içermiyor."],
  ["Replayet kunne ikke åbnes. Vælg en replayfil fra Nem Bold.", "The replay could not be opened. Choose a replay file from Nem Bold.", "Tekrar açılamadı. Nem Bold'dan bir tekrar dosyası seçin."],
  ["Der er endnu ikke en færdig kamp at gemme.", "There is no completed match to save yet.", "Henüz kaydedilecek tamamlanmış bir maç yok."],
  ["Replayet kunne ikke gemmes. Prøv igen.", "The replay could not be saved. Try again.", "Tekrar kaydedilemedi. Yeniden deneyin."],
  ["Begynder", "Beginner", "Başlangıç"],
  ["Almindelig", "Normal", "Normal"],
  ["Øvet", "Advanced", "İleri"],
  ["Mennesker", "Players", "Oyuncular"],
  ["Computer", "Computer", "Bilgisayar"],
  ["CPU i forsvar", "Computer defense", "Bilgisayar savunmada"],
  ["CPU i angreb", "Computer attack", "Bilgisayar hücumda"],
  ["Alle fire stænger", "All four rods", "Dört çubuğun tamamı"],
  ["Forsvar · målmand og forsvar", "Defense · goalkeeper and defense", "Savunma · kaleci ve savunma"],
  ["Angreb · midtbane og angreb", "Attack · midfield and attack", "Hücum · orta saha ve hücum"],
  ["Vælg et hold", "Choose a team", "Bir takım seçin"],
  ["Computer mod computer", "Computer vs computer", "Bilgisayara karşı bilgisayar"],
  ["Målmand", "Goalkeeper", "Kaleci"],
  ["Forsvar", "Defense", "Savunma"],
  ["Midtbane", "Midfield", "Orta saha"],
  ["Angreb", "Attack", "Hücum"],
  ["På iPhone kan du vælge Del → Tilføj til hjemmeskærm og åbne Nem Bold derfra for fuldskærm.", "On iPhone, choose Share → Add to Home Screen, then open Nem Bold from there for fullscreen.", "iPhone'da Paylaş → Ana Ekrana Ekle'yi seçin, ardından tam ekran için Nem Bold'u oradan açın."],
  ["Fuldskærm aktiveres, når du gør dig klar. Hvis browseren forlader den, gendannes den ved næste tryk.", "Fullscreen starts when you get ready. If the browser exits fullscreen, your next tap restores it.", "Hazır olduğunuzda tam ekran açılır. Tarayıcı tam ekrandan çıkarsa sonraki dokunuşunuzda yeniden açılır."],
  ["Tryk på controlleren eller fuldskærmsikonet for at vende tilbage til fuldskærm.", "Tap the controller or fullscreen icon to return to fullscreen.", "Tam ekrana dönmek için kontrolcüye veya tam ekran simgesine dokunun."],
  ["Fuldskærm er aktiv. Hvis browseren forlader den, gendannes den ved næste tryk.", "Fullscreen is active. If the browser exits fullscreen, your next tap restores it.", "Tam ekran açık. Tarayıcı tam ekrandan çıkarsa sonraki dokunuşunuzda yeniden açılır."],
  ["Fuldskærm er ikke tilgængelig i denne browser.", "Fullscreen is unavailable in this browser.", "Bu tarayıcıda tam ekran kullanılamıyor."],
  ["Linket kunne ikke kopieres. Scan QR-koden for at forbinde til bordet.", "The link could not be copied. Scan the QR code to connect to the table.", "Bağlantı kopyalanamadı. Masaya bağlanmak için QR kodunu tarayın."],
  ["Bordet kunne ikke åbnes.", "The table could not be opened.", "Masa açılamadı."],
  ["Forbindelsen til de andre telefoner kunne ikke åbnes.", "The connection to the other phones could not be opened.", "Diğer telefonlarla bağlantı kurulamadı."],
  ["Bordet kunne ikke åbnes på denne enhed.", "The table could not be opened on this device.", "Bu cihazda masa açılamadı."],
];

const messages = new Map<string, Translation>(entries.map(([da, en, tr]) => [da, { en, tr }]));
messages.set("connecting", { da: "Forbinder…", en: "Connecting…", tr: "Bağlanılıyor…" });
messages.set("reconnecting", { da: "Forbinder igen…", en: "Reconnecting…", tr: "Yeniden bağlanılıyor…" });
messages.set("connected", { da: "Forbundet", en: "Connected", tr: "Bağlandı" });
messages.set("error", { da: "Forbindelsesfejl", en: "Connection error", tr: "Bağlantı hatası" });

const replayDetails: Readonly<Record<string, readonly [string, string]>> = {
  format: ["format", "biçim"], formatversion: ["format version", "biçim sürümü"], dato: ["date", "tarih"],
  hold: ["teams", "takımlar"], holdnavn: ["team name", "takım adı"], indstillinger: ["settings", "ayarlar"],
  "antal spillere": ["player count", "oyuncu sayısı"], computermodstander: ["computer opponent", "bilgisayar rakip"],
  "målgrænse": ["goal target", "gol hedefi"], grafik: ["graphics", "grafikler"], "boldens fart": ["ball speed", "top hızı"],
  "rotationsdæmpning": ["rotation damping", "dönüş sönümlemesi"], bumpstyrke: ["bump strength", "sarsma gücü"],
  holdstyring: ["team controls", "takım kontrolleri"], computerstyring: ["computer controls", "bilgisayar kontrolleri"],
  computerniveau: ["computer difficulty", "bilgisayar zorluk seviyesi"], computerniveauer: ["computer difficulties", "bilgisayar zorluk seviyeleri"],
  rotation: ["rotation", "dönüş"], "målposition": ["goal pose", "gol konumu"], "måltid": ["goal time", "gol zamanı"],
  bold: ["ball", "top"], boldposition: ["ball position", "top konumu"], boldrotation: ["ball rotation", "top dönüşü"],
  "stænger": ["rods", "çubuklar"], stang: ["rod", "çubuk"], stangposition: ["rod position", "çubuk konumu"], stangvinkel: ["rod angle", "çubuk açısı"],
  optagelse: ["recording", "kayıt"], varighed: ["duration", "süre"], billedinterval: ["frame interval", "kare aralığı"],
  billeder: ["frames", "kareler"], "mål": ["goals", "goller"], billedtid: ["frame time", "kare zamanı"], boldrunde: ["rally", "oyun bölümü"],
  "billedrækkefølge": ["frame order", "kare sırası"], starttid: ["start time", "başlangıç zamanı"], sluttid: ["end time", "bitiş zamanı"],
  "målnummer": ["goal number", "gol numarası"], "målstart": ["goal clip start", "gol klibi başlangıcı"], "målslutning": ["goal clip end", "gol klibi bitişi"],
  "målboldrunde": ["goal rally", "golün oyun bölümü"], "målrækkefølge": ["goal order", "gol sırası"],
  "målhold": ["scoring team", "gol atan takım"], "målstilling": ["score", "skor"],
};

const iphoneHint = "På iPhone kan du vælge Del → Tilføj til hjemmeskærm og åbne Nem Bold derfra for fuldskærm.";
for (const [prefix, en, tr] of [
  ["Browseren understøtter ikke fuldskærm her.", "Your browser does not support fullscreen here.", "Tarayıcınız burada tam ekranı desteklemiyor."],
  ["Fuldskærm kunne ikke aktiveres. Prøv fuldskærmsikonet igen.", "Fullscreen could not be started. Try the fullscreen icon again.", "Tam ekran açılamadı. Tam ekran simgesini yeniden deneyin."],
] as const) {
  messages.set(prefix, { en, tr });
  messages.set(`${prefix} ${iphoneHint}`, { en: `${en} ${messages.get(iphoneHint)!.en}`, tr: `${tr} ${messages.get(iphoneHint)!.tr}` });
}

/** Translate complete messages only. Captured team names are opaque user data:
 * never recursively translate words inside a name, even if they match a notice. */
export function translateGameText(text: string, requestedLocale?: string): string {
  const locale = normalizeGameLocale(requestedLocale);
  const exact = messages.get(text);
  if (exact) return locale === "da" ? exact.da ?? text : exact[locale];
  if (locale === "da" || !text) return text;

  const invalidReplay = /^Replayfilen er ugyldig \(([^()]+)\)\.$/u.exec(text);
  if (invalidReplay) {
    const detail = Object.hasOwn(replayDetails, invalidReplay[1]!) ? replayDetails[invalidReplay[1]!] : undefined;
    return locale === "tr"
      ? `Tekrar dosyası geçersiz${detail ? ` (${detail[1]})` : ""}.`
      : `The replay file is invalid${detail ? ` (${detail[0]})` : ""}.`;
  }
  const goal = /^Mål til (.+)!$/su.exec(text);
  const winner = /^(.+) vinder!$/su.exec(text);
  // Arbitrary names can make the two legacy grammars ambiguous. Preserve the
  // original instead of changing part of a name; goal/result UI names are
  // rendered separately from these generic notices.
  if (goal && winner) return text;
  if (goal) return locale === "tr" ? `${goal[1]} gol attı!` : `Goal for ${goal[1]}!`;
  if (winner) return locale === "tr" ? `${winner[1]} kazandı!` : `${winner[1]} wins!`;
  const rods = /^(\d+) stænger$/u.exec(text);
  if (rods) return locale === "tr" ? `${rods[1]} çubuk` : `${rods[1]} ${rods[1] === "1" ? "rod" : "rods"}`;
  const versusComputer = /^(\d+) telefon(?:er)? mod computer · (Begynder|Almindelig|Øvet)$/u.exec(text);
  if (versusComputer) {
    const count = versusComputer[1]!, level = messages.get(versusComputer[2]!)![locale];
    return locale === "tr" ? `${count} telefon bilgisayara karşı · ${level}` : `${count} ${count === "1" ? "phone" : "phones"} vs computer · ${level}`;
  }
  const shared = /^(\d+) telefon(?:er)? · delt med computer$/u.exec(text);
  if (shared) return locale === "tr" ? `${shared[1]} telefon · bilgisayarla paylaşılıyor` : `${shared[1]} ${shared[1] === "1" ? "phone" : "phones"} · shared with computer`;
  const phones = /^(\d+) telefon(?:er)?$/u.exec(text);
  if (phones) return locale === "tr" ? `${phones[1]} telefon` : `${phones[1]} ${phones[1] === "1" ? "phone" : "phones"}`;
  return text;
}
