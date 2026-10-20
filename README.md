# Nem Bold

3D-bordfodbold på computer eller telefon. Spil alene på telefonen, brug den som vært for vennerne, eller brug en stor skærm med telefoner som håndtag. Bygget med Nuxt 4, Nuxt UI 4, TypeScript, Three.js, Rapier 3D og PeerJS. Spillet har lydeffekter og kan udgives som statiske filer.

## Sprog

Nuxt i18n leverer dansk, engelsk og tyrkisk. Enheden bruger det første understøttede sprog i browserens prioriterede liste og ellers engelsk. Flaget i toppen åbner sprogvælgeren; et manuelt valg gemmes i cookien `nem-bold-language` og har forrang ved næste besøg. Hver skærm vælger sit eget sprog, også mens kampen kører. URL og session ændres ikke ved sprogskift.

Fælles UI-tekster findes i `i18n/messages/{core,ui,controller}.ts`. Nuxt genererer statiske sprogkataloger, og en tidlig klientplugin bevarer enhedens valg under hydrering af det engelske HTML. Netværks- og kampbeskeder oversættes lokalt ved visning gennem `shared/runtimeMessages.ts`; egne holdnavne og replaydata bevares. Tekster, dynamiske værdier, browserprioritet og sprogskift kontrolleres automatisk.

## Installation og udvikling

Brug en moderne Node.js-version, der understøttes af Nuxt 4, gerne Node 24 LTS, og npm.

```sh
npm install
npm run dev
```

Åbn adressen vist i terminalen. Skal telefoner forbinde til et lokalt udviklingsbord, åbnes værten via computerens LAN-adresse, eksempelvis `http://192.168.1.20:3000`. Adresselinjen, kopilinket og QR-koden bruger samme origin. `localhost` på telefonen betyder telefonen selv.

1. Åbn forsiden uden et sessionslink for at oprette et bord. Browserens adresse bevares, så den kan deles som link til spillets forside. QR-koden og “Kopiér forbindelseslink” indeholder sessions-id'et og forbinder til det aktuelle bord.
2. En ekstra computer, der åbner linket, viser samme bord med hostens positioner, kamera, replay og point. Den tager ingen spillerplads og kører ingen fysik. Den oprindelige side er stadig den eneste vært og skal holdes åben.
3. En telefon, der åbner linket, bliver controller. Åbnes forsiden direkte på telefonen, opretter den selv bordet og bliver den første controller.
4. Hver controller vælger rødt eller blåt forsvar og/eller angreb. Begge halvdele på samme hold kan vælges; andres pladser kan ikke overtages. En ledig halvdel viser sit computerniveau: Let, Medium eller Svær.
5. Den første controller starter kampen. Ubesatte roller bliver computere. Alle tilsluttede telefoner skal have valgt en plads; der er ingen separate klarmeldinger. Den første controller vælger også først til 3/5/10 mål og boldhastighed fra 0,5× til 2× med 1× som standard. Rotationsdæmpning og bumpstyrke bruger faste standarder.
6. Den første controller, der vælger et hold, er holdkaptajn og kan give det et navn på op til 25 Unicode-tegn. Standardnavnene er **Rød** og **Blå**. Medspillere og computerhalvdele deler holdets navn og faste røde/blå spilledragter. Navne bevares ved omkamp.

Computeren har et lokalt grafikvalg, ud over lyd og fuldskærm. **Simpel grafik** bruger højst 1× pixelratio og ingen skygger; **God grafik** bruger højst 1,7× med skygger. Pixelratio begrænses til skærmens egen tæthed. Valget gemmes på enheden.

På en almindelig desktop tilpasser hostens lobby og kamp sig vinduets bredde og højde uden scroll på siden. I lave vinduer placeres QR-koden ved siden af introduktionen og spillerkortene ved siden af hinanden. Udviklingstilstandens ekstra testpanel har fortsat sit eget længere layout.

På startskærmens bord spiller to computere på Begynder en stille demokamp, mens telefonerne tilmelder sig. Kun bordets fysiske pointtællere følger målene; begge nulstilles, når et hold når fem. Kameraet fortsætter sin rolige rundtur uden boldzoom, målreplay, nedtællinger eller rystelser. En fastlåst eller undsluppet bold erstattes automatisk. Demokampen stopper, når den rigtige kamp starter, og vender tilbage ved retur til lobbyen. Den holder pause, når browserfanen er skjult.

Internet kræves ved indlæsning af det offentlige website og ved multiplayer-forbindelse gennem PeerJS Cloud, også på LAN. En allerede indlæst lokal singleplayerkamp bruger ingen signaling eller forbindelse til en ekstra skærm. Telefon og host kan være på forskellige netværk; Cloudflare TURN kan videresende trafikken, når en direkte forbindelse ikke lykkes. Samme lokale netværk uden klientisolering giver normalt den bedste respons. HTTP på LAN er til grundlæggende udvikling; brug HTTPS til normal udgivelse og skærmens wake lock.

## Spil og controller

Hold telefonen i landskabsformat. Controlleren bruger samme 3D-bord, teksturer, belysning og bold som hosten, set lodret ovenfra med et fast, ortografisk kamera. Kameraet følger ikke bolden og zoomer ikke under almindeligt spil. Under målreplay skifter telefonen til samme perspektiviske 3D-kamera som hosten, og vender derefter tilbage til fast top-down. Bander, begge mål og alle otte stænger er synlige. Dine egne spillere er tydelige; modstanderens er semitransparente. Visningen modtager hostens faktiske positioner, også under replay, så du kan spille med blikket på telefonen. Hvert af dine touchområder styrer én af dine egne stænger: målmand, forsvar, midtbane eller angreb. Swipe op/ned for at flytte stangen, og til siderne for at rotere. Diagonale bevægelser gør begge dele. Flere fingre kan styre forskellige stænger samtidigt. Efter slip fortsætter rotationen kort med inerti, hvorefter spillernes fodvægt trækker stangen tilbage til nærmeste neutrale position inden for cirka tre sekunder. Mens fingeren holder stangen, modvirker denne tilbageføring ikke styringen. Lodret bevægelse følger fingerens afstand på det viste bord ved standardfølsomheden og stopper ved stangens grænse. Hurtige strøg registreres straks, også hvis hele berøringen er kortere end ét fysiktrin; et hurtigt strøg hen over andre egne, ledige stænger kan også give dem momentum. Afbrudte berøringer udløser ikke ekstra spark.

Forsvar styrer målmand og forsvar; angreb styrer midtbane og angreb. Vælger du begge halvdele af samme farve, styrer du alle fire stænger. Controlleren viser kun dine egne touchområder. Manglende halvdele styres automatisk af computeren; en ny tilmelding ændrer aldrig en eksisterende spillers valgte stænger.

Computeren bruger hostens almindelige stanginput og rigtige boldfysik. Let skifter højst stang én gang i sekundet og styrer højst én stang. Medium har mindst 0,5 sekund mellem skift og én aktiv stang. Svær har mindst 0,25 sekund mellem skift og højst to aktive stænger. Faste sigtefejl, en dødzone og begrænset acceleration dæmper små, nervøse sidebevægelser. Et helt computerhold med samme niveau deler stangbudget; halvdele med forskellige niveauer har hver deres computer. Samme styring bruges i demoen. Computeren flytter ikke bolden direkte og står stille under pause, nedtælling og replay.

Hvis en computer klemmer bolden ned med sin egen fod, registrerer den den fysiske fastklemning. Efter 0,25 sekund med næsten stillestående bold vender den stangen og fortsætter rundt til et træf fra den modsatte side. Den holder stangen på samme sted under forsøget; almindelig reaktionstid og stangskift udsætter ikke denne reaktion. En løs, stillestående bold udløser ikke denne særlige manøvre.

Telefonværtens bord tegnes med op til 60 billeder i sekundet; en ekstern controller tegner på hver skærmopdatering. Hostens visningsstrøm sender op til 60 opdateringer i sekundet, mens løbende stanginput fortsat bruger 30; slip og afsluttende skud sendes straks. Hostens fysik beregnes fortsat 120 gange i sekundet uafhængigt af visningen.

Controllerens personlige grafikvalg gemmes på enheden. Standard er **Almindelig grafik** med pixelratio højst 1 og uden dynamiske skygger. Replays skifter automatisk til **God grafik**, med pixelratio op til 1,5 og skygger, og bevarer kvaliteten ved pause under replay. Slås **God grafik** til i controllerindstillingerne, gælder den også under almindeligt spil. Kampens fælles indstillinger ændrer ikke enhedens grafikvalg.

En ekstern controllers 3D-visning indlæses først, når kampen starter. En buffer på 25 ms med en jævn afspilningsklokke udligner variation i pakkernes ankomst. Bold og eksterne stænger tegnes mellem allerede modtagne positioner på samme tidslinje. Egne stænger følger lokale pointerbevægelser uden at vente på netværket; mens fingeren holder stangen, overskriver hostens forsinkede positioner ikke visningen. Den lokale stangbevægelse bruger de samme grænser, accelerationer og dæmpninger som hosten. Efter slip bevares et kort forspring, hvorefter position og rotation glider tilbage til hostens visning.

Boldens position og rotation kommer udelukkende fra hosten. Controlleren interpolerer mellem modtagne frames, men laver ingen lokal boldfysik, skudforudsigelse, ekstrapolation eller efterfølgende indhentning af en forudsagt bold. Ved manglende pakker stopper visningen ved senest modtagne position. Faseskift, ny bold og replayklip nulstiller bufferen, så den ikke tegner en bevægelse mellem adskilte hændelser. Kun egne stænger forudsiges; deres forspring efter slip tilpasses målt netværksforsinkelse og visningsbufferen. Pause, replay, ny bold, tabt forbindelse og ændrede spillerpladser rydder stangforudsigelser. Telefonværten bruger allerede den lokale, autoritative fysik og kører derfor ikke en ekstra forudsigelse. Under almindeligt spil tilpasses kameraets udsnit kun, når skærmens størrelse ændres. Spil direkte på telefonen er beskrevet nedenfor.

Visningsframes leveres direkte til afspilningsbufferen uden en Vue-opdatering for hver pakke. Nye modparter bruger en separat WebRTC-datakanal uden rækkefølgekrav eller genafsendelser; overbelastning kasserer snapshots frem for at opbygge en kø. En bekræftet handshake aktiverer kanalen. Ældre modparter eller en utilgængelig ekstrakanal bruger den oprindelige transport. Kampstatus, input, lyd og heartbeat bliver på den pålidelige kanal. En deterministisk [benchmark](docs/controller-stream-benchmark.json) sammenligner rå 30/60 Hz med den korte afspilningsbuffer; den er en simulation og ikke en telefonmåling.

Vandret swipe har den nye, omvendte standardretning. Indstillingen **Vend vandret swipe-retning** ændrer kun rotationen mellem målene; op/ned flytter altid stangen i samme retning som fingeren. Ældre gemte indstillinger får den nye standard én gang, mens følsomheder bevares. Derefter gemmes den valgte retning som normalt.

Blåt holds paneler er spejlet: angreb, midtbane, forsvar og målmand. Stængernes fysiske ID'er følger med, så panelerne stadig styrer de rigtige stænger. Holdene beholder deres faste røde og blå farver. Standardnavnene følger skærmens sprog; kaptajnens egne navne bevares.

Langs begge langsider stiger spillefladen fra sidelinjen til banden med præcis 2 cm. De fire hjørner har brede trekantede ramper på 48 cm med en maksimal højde på 2,2 cm. Den synlige bane og Rapier-kollisionen bruger samme sammenhængende flade. En hvilende bold i det yderste hjørne ruller diagonalt mod forsvaret på cirka to sekunder. En bold, som Rapier har lagt i hvile på en hævet del af banen, vækkes, så tyngdekraften kan føre den ned igen uden ekstra skub. En sovende bold på den flade bane påvirkes ikke. Midten og gulvet gennem målene forbliver flade. Målmandens midte kan bevæge sig 25 cm til hver side, svarende til 2 cm uden for hver målpost; de øvrige stængers vandring bevares.

Spillerens fod har en superellipse med eksponent 4 set ovenfra, med en fladere midte og rundede sider. Den synlige fod og Rapier-kollisionen bruger samme profil og afrunding. Ved et faktisk fodtræf er superellipsens normal udgangspunkt for skuddets vandrette retning: midtertræf går lige, og træf mod siderne får gradvist større vinkel. Fodens faktiske bevægelsesretning blandes delvist ind, så både rotation og sidebevægelse kan styre bolden mere arkadeagtigt. En stille fod giver ingen bevægelsesbonus. Nedslag på en jordnær bold bremser stangen ved kontakten og standser boldens bevægelse. Foden kan trækkes tilbage for at frigøre bolden. Et reelt sideværts ryk med en fastklemt bold giver ét rullende skub langs stangens akse: 1,2 gange bevægelsens fart, højst 0,8 m/s, med et lille indadgående bidrag mod stangen. Impulsen gentages ikke, før bolden har forladt foden. Controllerens holdte stang bruger samme lokale kontaktbegrænsning uden at simulere bolden.

Ved boldhastighed 1× er boldens almindelige maksimumfart banens længde delt med 2,5 sekunder: 2,8 / 2,5 = 1,12 m/s. Slideren skalerer grundgrænsen til 0,56–2,24 m/s og serveringen tilsvarende. Et aktivt fodtræf kan lægge boldens faktiske indgangsfart oveni den valgte grundgrænse; ved 1× giver 0,8 m/s indgangsfart eksempelvis et loft på 1,92 m/s. Bolden beholder det optjente loft gennem det efterfølgende forløb. Når den falder ned under grundfarten, bliver klemt fast eller gives op igen, nulstilles loftet. Bander og passive stænger giver ingen ny fartbonus, og et vedvarende kontaktpunkt kan ikke lægge fart til gentagne gange. Spin begrænses tilsvarende ved boldens radius. Sænkes slideren, gælder det lavere loft straks; en højere indstilling tilføjer ikke i sig selv fart til den eksisterende bold. Restitution og dæmpning bremser naturligt bolden; servering bruger 0,8 m/s ved 1×.

En stang, som ingen holder, giver efter ved et faktisk boldtræf: spilleren kan drejes af boldens momentum, mens bolden mister fart. En hurtig bold kan løfte den løse fod og fortsætte forbi med mindre fart. Stangens sideposition bevares; den drejer om sin normale akse og falder derefter tilbage med den sædvanlige tyngde og dæmpning. En aktivt holdt stang forbliver under spillerens kontrol. Sammenstødsdrevet bevægelse giver ingen ny arkadeskudbonus.

Banderne på langsiderne og ved målene er 48 cm høje. Yderspillernes rækkevidde er trukket 3,5 cm ind, så der er mindst 8,4 cm fri passage langs hver langside til boldens diameter på 6,6 cm. Målmanden beholder sin kortere bevægelse ved målet.

Slipper du en stang med spillerne på hovedet mellem 170° og 190°, bliver de stående i den vinkel, indtil stangen berøres igen. Aktive rotationer og et allerede sluppet spin kan stadig passere gennem området. Uden for området vender spillerne normalt tilbage med fødderne nedad.

Ved kampstart, genoptagelse og omkamp forsøger controlleren at gå i fuldskærm og låse landskabsformat fra det samme tryk. Hvis browseren eller telefonen forlader fuldskærm, går næste tryk på et stangområde tilbage i fuldskærm, hvor API'et understøttes. En diskret knap kan også bruges. Screen Wake Lock holder skærmen vågen under kamp, hvor HTTPS, browseren og batteripolitikken tillader det. På iPhone uden browser-fuldskærm kan controlleren tilføjes til hjemmeskærmen; indstillingerne viser vejledningen. Systemets valg om at forlade fuldskærm kan ikke tilsidesættes uden et nyt brugertryk.

Ved scoring vises holdets navn, teksten **scorede!** og holdets røde eller blå markering i 1,6 sekund på alle skærme. Derefter vises et målreplay af de sidste to registrerede spillerberøringer og det sidste sekund af den optagede bevægelse før målet. Tomme mellemrum mellem berøringer klippes væk. Bevægelsen retimes til cirka otte sekunder, højst otte; meget korte mål får et kortere replay uden frosne fyldbilleder. Det sidste sekund af kildeoptagelsen afspilles tre gange langsommere end berøringsklippene. I de sidste to sekunder af selve afspilningen zoomer kameraet yderligere ind, mens bold og aktivt mål bliver i billedet. Det gælder også telefonens perspektiviske replay; reduceret bevægelse beholder et roligt udsnit.

Fysikken står stille under replayet, og målet tælles kun én gang. Derefter vises en 3–2–1-nedtælling, før en ny bold gives op. Efter sejrsmålets målannoncering vises **KAMPENS MÅL**: alle kampens mål i rækkefølge, inklusive sejrsmålet, fra den fælles kampoptagelse. Hver sekvens viser op til fire sekunder før målet, med slowmotion i det sidste sekund, målbeskeden og jubellyden ved scoringen samt en kort fade mellem klippene. Visningen viser den historiske stilling og eksempelvis **MÅL 2 / 5**. Slutstillingen og vinderen i den rigtige kamp bevares.

På værten, også når telefonen selv er vært, kan man pause replayet, slå **Spring mellem mål** fra og trække frem og tilbage i hele kampens tidslinje. De farvede områder markerer målsekvenserne; nummererede knapper søger til starten af målsekvenserne, så optakten kan afspilles. Selv når optakten starter ved det foregående måls tidspunkt, vælges den nye bold og ikke den tidligere målvisning. En søgning pauser afspilningen og vælger hele kampen. **Vis resultat** vender tilbage til slutstillingen; derfra kan hele kampen eller alle mål afspilles igen. Controllerne ser samme replay, men styringen af tidslinjen ligger hos værten. Optagelsen bliver i den aktuelle værtsside indtil ny kamp eller genindlæsning. **Download replay** gemmer hele den færdige kamp som gzip-komprimeret JSON (eller almindelig JSON i ældre browsere). **Afspil replay** i bunden åbner `/replay` i en separat fane, hvor filen indlæses lokalt uden en netværkssession. Filen indeholder holdnavne, faste farver, oprindelige kampindstillinger, mål og optagede bevægelser; ingen controlleridentiteter eller genforbindelsestokens.

Kampoptagelsen gemmer positioner ved 30 Hz i højst cirka 3,2 MB pakket hukommelse. Ved usædvanligt lange kampe reduceres frekvensen gradvist, mens begyndelse og slutning bevares. Pauser, nedtællinger og allerede viste replays indgår ikke i tidslinjen. Serveringer, søgninger og klipskift afbryder interpolation, så bolden ikke tegnes mellem adskilte positioner. Den fulde optagelse sendes ikke over netværket; kun den aktuelle visningspose og replaystatus deles.

De to bander nærmest kameraet er semitransparente: én langside og én målside. Valget følger kameraets position hele vejen rundt om bordet; de to fjerne sider er solide. I lobbyen panorerer kameraet langsomt omkring bordet, med cirka 90 sekunder pr. omgang. Når kampen starter, glider det til spillekameraet. Kameraet følger bolden med glidende bevægelser, viser hele banen ved midten og zoomer tættere på bold og mål ved enderne. Reduceret bevægelse beholder det rolige, brede udsnit. Serveringshullerne har fysiske klapper: kun indgangshullet åbner ved servering og lukker, så snart bolden er helt inde på banen.

BUMP er tilgængelig under aktivt spil, når boldens samlede hastighed højst er 0,075 m/s, og den fælles cooldown er udløbet. Både knappen og værten håndhæver begrænsningen. Pause, personlige følsomheder og fælles indstillinger kan betjenes fra telefonerne. Point tælles på selve 3D-bordet og øverst på controlleren. Når kampen er slut, kan alle menneskelige spillere vælge omkamp eller vende tilbage til klubvalget.

Et forbindelsestab pauser kampen og bevarer point/hold. Lad den samme controllerside forbinde igen; sessionens reconnect-token gemmes lokalt på telefonen. Når alle telefoner er forbundet igen, kan den første controller genoptage kampen efter nedtælling. Heartbeat sendes hvert 2. sekund, forbindelsen betragtes som tabt efter 9 sekunder, og en lobbyplads frigives efter 15 sekunders fravær. Under en kamp beskyttes spillerpladserne af deres tokens. Et delt sessionslink overtager aldrig værtsrollen. Hvis den oprindelige vært lukkes eller genindlæses, skal der oprettes et nyt bord fra forsiden uden sessionsparameter.

## Spil direkte på telefonen

På telefonen vælger man **Opret spil** fra forsiden, uanset om man vil spille mod computeren eller invitere andre. Telefonen er vært og første administrator og kan vælge en halvdel eller et helt hold. Et kompakt invitationskort øverst i opsætningen viser tekst til venstre og QR-koden til højre. Browserens adresse bevares; invitationens QR-kode og “Kopiér forbindelseslink” indeholder sessions-id'et. **Tilslut eksisterende spil** åbner en dialog, der forklarer, at man skal scanne værtens QR-kode eller åbne forbindelseslinket.

Åbnes et eksisterende sessionslink på telefonen, tilsluttes den direkte som controller. En computer med samme link bliver tilskuerskærm. En touchskærm på en Windows-PC gør ikke computeren til en telefon; iPad med desktopbrugeragent genkendes som mobil enhed.

Telefonværten bruger én fysik og ét WebGL-bord. Netværksinvitationen åbnes automatisk, og en fejl i signaling vises uden at ødelægge den lokale spiller eller det lokale bord.

Telefonen skal holde spilsiden åben som vært; ved baggrund/skærmskift pauser kampen. Det offentlige website skal først være indlæst. Projektet installerer ikke en serviceworker og lover derfor ikke offline genindlæsning.

## Lyde

Sparkets lydstyrke følger den fysiske relative kollisionsfart. Et blødt træf giver en lav lyd, et hårdt træf en kraftigere. Bander har en separat kort lyd, mål giver 2,7 sekunders publikumshujen, og kampens første opgivelse har en dommerfløjte. Fysikken udløser ingen nye kontaktlyde under replay eller pause.

Browseren kræver et brugertryk for at åbne lyd. Brug lydknappen på hosten; telefonværtens tryk på Start kampen åbner lyden. Eksterne controllere starter uden lyd og kan aktivere den i deres personlige indstillinger, så flere telefoner ikke automatisk spiller de samme lyde sammen. Pause, mute og lukning rydder aktive lydkilder op. Der er ingen baggrundsmusik.

Fløjte og hujen er CC0-optagelser, klippet til korte lokale filer. Spark og bander skabes med Web Audio. Kilder, licens og tilpasninger står i [lydlicenserne](public/audio/LICENSES.md).

## Udvikling og kontrol

To computervinduer med samme sessionslink kan bruges til at kontrollere værts- og tilskuervisningen. Telefoner bruges til at afprøve de rigtige controllerpladser og touchbevægelser. Automatiske kontroller:

```sh
npm test
npm run typecheck
npm run build
```

Automatiske tests dækker de centrale regler og netværkets autoritative validering. Browser- og enhedstest skal også gennemføres ved ændringer af input, fysik eller rendering; se checklisten nedenfor. En grøn enhedstest er ikke en måling af fysisk multitouch eller 60 FPS på moderat hardware.

PeerJS-kampforløbet med to controllere er tidligere afprøvet i browseren. Den stille demokamp på startskærmen er også browserafprøvet. Det nye controllerflow med pladsvalg og kampstart samt en ekstra tilskuerskærm er afprøvet med rigtige PeerJS-forbindelser i browseren. Afprøvning på fysiske telefoner mangler fortsat. Se [verifikation og resterende enhedstest](docs/VERIFICATION.md).

## Build og deployment

### SEO og delingsgrafik

`@nuxtjs/seo` genererer canonical-links, sitemap, robots.txt og strukturerede data med `https://bold.nembestil.dk` som det officielle domæne. Forsiden og Om-siden leveres som færdig HTML; spillet indlæses via `ClientOnly`. Sessionsparametre indgår ikke i canonical-adresser, og `/controller` er udeladt fra sitemap og markeret `noindex`.

Facebook og X bruger `public/og/nem-bold.png` (1200 × 630). Layoutkilden er `scripts/social-preview.vue.template`: kopiér den midlertidigt til `app/pages/__social-preview.vue`, åbn siden lokalt og gem de øverste 1200 × 630 pixels. Fjern den midlertidige side før build. Billedet viser det faktiske Three.js-bord og kræver ingen billedtjeneste i produktion.

Faviconet består af originale logoformer på `#121812`. Kør `node scripts/generate-brand-assets.mjs` efter ændringer i logoet for at regenerere SVG, ICO, PNG og Apple touch icon. Nuxt SEO er sat op efter [modulets vejledning](https://nuxtseo.com/docs/nuxt-seo/guides/using-the-modules); dynamisk OG-generering, AI Ready og Skew Protection er slået fra i dette statiske spil.

Projektets statiske spilfiler hostes på Cloudflare Pages som `nemfuss` med produktionsdomænet **https://bold.nembestil.dk** og Pages-adressen https://nemfuss.pages.dev. En Pages Function udsteder midlertidige TURN-adgangsoplysninger. Wrangler er installeret lokalt; konfigurationen ligger i `wrangler.jsonc`.

Deploy fra projektmappen:

```sh
npx wrangler login
npm run deploy
```

`deploy` bygger først sitet og uploader derefter `.output/public` til produktionsbranchen `main`. Der kræves ikke et Git-repository. Login er kun nødvendigt, når den lokale Cloudflare-session mangler eller er udløbet. Kontoen er Bitnissen ApS.

For at afprøve de genererede filer med Cloudflares lokale Pages-server:

```sh
npm run build
npm run preview:pages
```

Domænet er tilføjet under **Pages → nemfuss → Custom domains**, med CNAME fra `bold.nembestil.dk` til `nemfuss.pages.dev`. HTTPS og den aktuelle produktionsversion er kontrolleret på domænet. Efterfølgende deployments bruger samme domæne.

Generisk lokal forhåndsvisning:

```sh
npm run build
npm run preview
```

`build` kører Nuxts statiske generering. Pages-deployment fra projektmappen medtager også `functions/api/ice-servers.ts`. Der er ingen Node.js-server, database eller dedikeret gameplayserver i produktion. Nuxt har genererede ruter til `/`, `/controller` og `/about`; platformen skal servere ruternes `index.html` eller have SPA-fallback til roden. Bevar queryparametrene på controller-ruten. Ved upload af kun `.output/public` til anden statisk hosting fungerer direkte multiplayer fortsat, men Cloudflare TURN kræver også credential-endpointet.

Udgiv ved domænets rod, medmindre Nuxts base-URL og alle offentlige aktivstier er tilpasset. WebRTC og PeerJS Cloud skal være tilgængelige fra host og telefoner. Stramme firewalls/NAT eller gæstenetværk kan forhindre direkte forbindelser; Cloudflare TURN tilbyder UDP, TCP og TLS som alternative ruter. Projektet har ikke en selvhostet signalingserver. Browserens fuldskærm kræver normalt et klik; spillet fungerer også i et almindeligt browservindue.

### Cloudflare TURN

Begge enheder henter deres egne midlertidige ICE-adgangsoplysninger fra `POST /api/ice-servers`. PeerJS bruger `iceTransportPolicy: "all"`, så browseren kan vælge en direkte forbindelse og bruge relay, når det er nødvendigt. Spillets fysik forbliver hos hosten. TURN-tjenesten erstatter ikke PeerJS Cloud til signalering.

Opret en dedikeret TURN-nøgle under **Cloudflare → Realtime → TURN**, og gem dens ID som `TURN_KEY_ID` i `wrangler.jsonc`. Gem nøglens tilhørende API-token som en Pages-secret:

```sh
npx wrangler pages secret put TURN_KEY_API_TOKEN --project-name nemfuss
```

Brug tokenet til den dedikerede TURN-nøgle, ikke et generelt konto-token. Secret skal være sat inden deployment; den må aldrig ligge i offentlige Nuxt-variabler eller browserkode. Preview-deployments kræver deres egen secret-konfiguration. [Cloudflares vejledning](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

Til lokal afprøvning kopieres `.dev.vars.example` til den ignorerede `.dev.vars`, og begge værdier udfyldes dér. Kør `npm run build` og `npm run preview:pages`. Almindelig Nuxt-udvikling og `npm run preview` kører kun spillet uden Pages Function og bruger derfor direkte forbindelser. `npm run types:cloudflare` regenererer servertyperne; `npm run typecheck` kontrollerer både Nuxt og Pages Function.

Hvert sæt midlertidige adgangsoplysninger er gyldigt i 24 timer og fornyes fem minutter før udløb. Nye forbindelser og eksisterende WebRTC-konfigurationer opdateres uden at genstarte spillet. Ved fejl beholdes stadig gyldige oplysninger, og der forsøges igen efter et minut. Manglende eller udløbne oplysninger giver STUN-baserede direkte forbindelser, så lokal multiplayer fortsat kan bruges. Den lokale singleplayer-host kalder aldrig endpointet.

Endpointet accepterer kun samme-origin POST med appens header, sender `Cache-Control: no-store` og returnerer aldrig den permanente nøgle. Det er et offentligt, anonymt spil: origin-kontrollen er ikke brugerautentifikation. Ved offentlig drift bør credential-endpointet ratebegrænses i Cloudflare, og TURN-forbruget følges i Realtime-dashboardet.

For at kontrollere relay skal en separat WebRTC-test bruge `iceTransportPolicy: "relay"`, udveksle data begge veje og bekræfte `relay` i det valgte kandidatpar via `getStats()`. Produktionsspillet skal fortsat bruge `all`. Afprøv derefter spillet med host på Wi-Fi og en telefon på mobilnet for at vurdere den faktiske respons.

## Holdnavne

Holdene bruger altid faste røde og blå farver. Kaptajnen er den første, der vælger holdet, uanset hvornår telefonen tilsluttede sig. Kun kaptajnen kan ændre navnet i lobbyen; tomt input gendanner **Rød** eller **Blå**. Serveren håndhæver højst 25 Unicode-tegn. Der bruges ingen klubdatabase eller eksterne klublogoer.

## Bordmodel

Spillet leveres med en komplet geometrisk fallback. Den ønskede [Sketchfab-model af owestgate](https://sketchfab.com/3d-models/foosball-table-1303a318d4584639acef729b9fd296fc) er verificeret som CC BY 4.0, men det officielle download kræver autentifikation. Placering og krav til senere integration er beskrevet i [modelvejledningen](public/models/README.md). Fysik og gameplay er uafhængige af en ekstern model.

## Projektstruktur

```text
app/              Nuxt-sider, host/lobby og mobilcontroller
game/             3D-rendering, Rapier-fysik og kampregler
network/          PeerJS, beskedprotokol og autoritativ session
shared/types.ts   Delte TypeScript-kontrakter og lobbyindstillinger
shared/           Holdnavne, replayfiler og delte kontrakter
scripts/          Målinger og egne grafikaktiver
public/           Egne grafikaktiver, lyde og valgfri bordmodel
tests/            Automatiske tests af regler og validering
docs/             Kilder, licenser og kreditering
```

Gameplaytal og borddimensioner ligger centralt i `game/GameConfig.ts`; standard-lobbyindstillinger ligger i `shared/types.ts`. Engine og netværksregler er adskilt fra Vue. Browserressourcer initialiseres kun på klienten og ryddes op ved afmontering.

## Manuel accepttest

Følgende skal kontrolleres på rigtig hardware før en offentlig 1.0-kvalitetsgodkendelse:

- Direkte oprettelse på telefonen, automatisk delbart link, lokal pause/omkamp og en ekstra telefon på samme bord.
- Fire valgbare halvdele, begge halvdele på én controller og korrekte computere på alle ubesatte pladser.
- Lyd på Safari/Chrome efter brugertryk: forskel på bløde/hårde spark, bander, 2,7 sekunders jubel og ét kampstartfløjt.
- Mobilens perspektiviske replay og automatisk tilbagevenden til fast top-down; cirka otte sekunders bevægelse, ekstra zoom de sidste to afspilningssekunder og reduceret bevægelse.
- Kampmontage med alle mål én gang i rækkefølge, korte sorte overgange på host og telefon, uændret slutstilling og pause/genoptagelse midt i en overgang.
- Én til fire telefoner scanner samme QR, tager egne pladser og starter fra første controller; prøv også to telefoner med begge halvdele på hver sin side.
- Én og to telefoner mod computeren på alle tre niveauer, pause/genoptagelse og omkamp uden en computer-klarmelding.
- Medspillere deler klub og får hver deres to stænger; de kan ikke styre hinandens stænger.
- Samtidig reservation, frigivelse af en halvdel, klubkaptajn og administratoroverdragelse.
- iPhone Safari og Android Chrome i landskab/portræt, safe areas, pointercancel og flere fingre.
- Langsom rotation, hurtige spins, meget korte strøg hen over stænger, modsat swipe og tilbagefald til neutral inden cirka tre sekunder efter slip.
- Lodret fingerbevægelse svarer til spillernes bevægelse på bordet, også tæt på en kant og efter en ny berøring; afbrudt multitouch giver intet ekstra spark.
- Vandret inversion med samme lodrette retning i begge indstillinger; ny standardretning og bevarede følsomheder ved opdatering.
- Superellipsefodens lige midtertræf og gradvist større vinkler mod begge kanter, roligere skud og nedadgående stop med efterfølgende frigørelse.
- Host i almindelige desktopvinduer på eksempelvis 1024×600, 1366×650, 1440×800 og 1920×1080 uden scroll på siden.
- Klubvælgerens standard Tilfældig og alle 86 farvekendte klubber i alfabetiske landegrupper; kun holdets første spiller kan ændre klub. Computerklubben vælges fra samme globale udvalg og bliver stabil i lobbyen.
- Mobilens top-down-bane, tydelig bold i begge mål/bander, gennemsigtige modstandere og kontrol med blikket på telefonen.
- Hostens fulde udsnit ved midten, nærbillede i begge ender og hurtige tværpas uden tab af bolden.
- Mål i begge ender, ingen dobbelte mål, tællernes animation og 3/5/10 måls omkampe.
- Bolden ruller naturligt ned fra begge sidebakker på 2 cm og alle fire brede trekantshjørner på 2,2 cm, også efter fysikhvile; fladt målindløb og målmandens vandring på ±25 cm.
- Fysisk servering fra begge huller, hop, høje bolde, bold ude og automatisk genservering.
- BUMP kun ved næsten stillestående bold samt fælles cooldown.
- Slutreplay med historisk score og målnummer; pause, målmarkører, fri søgning, hele kampen, genafspilning og oprydning ved omkamp.
- Delingslink åbnet på ekstra computere med samme bold, stænger, kamera, point og replay; ingen ekstra vært eller controllerplads.
- To transparente bander gennem hele kameraets rundtur.
- Computerens rolige acceleration og stangskift ved 1 / 0,5 / 0,25 sekund på de tre niveauer.
- Pause/genoptag, tab af netværk, automatisk reconnect og bevaret pointstilling.
- Host-faneblad i baggrunden, skift af grafikniveau og mange kampe uden stigende ressourceforbrug.
- FPS på måludstyr, LAN-isolation/firewalls og statisk HTTPS-hosting med direkte controller-links.

Disse fysiske enhedstests er ikke automatisk udført af projektets enhedstest.

## Non-profit og kreditering

Nem Bold er et gratis, uofficielt og non-profit hobbyprojekt udviklet udelukkende for sjov. Holdene har egne navne og faste røde og blå farver.

Ønsket ekstern bordmodel: owestgate (CC BY 4.0); den leverede geometriske fallback er projektets eget arbejde. [Aktiver og kreditering](docs/SOURCES.md).
