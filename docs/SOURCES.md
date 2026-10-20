# Aktiver og kreditering

Spillet bruger faste røde og blå hold med selvvalgte navne. Klubdatabasen, eksterne klublogoer og importværktøjerne er fjernet.

## Bordmodel

Ønsket model: [Foosball Table](https://sketchfab.com/3d-models/foosball-table-1303a318d4584639acef729b9fd296fc), af **[owestgate](https://sketchfab.com/owestgate)**, udgivet under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

[Sketchfabs offentlige metadata](https://api.sketchfab.com/v3/models/1303a318d4584639acef729b9fd296fc) bekræftede titel, ophavsmand, CC Attribution og `faceCount: 11772` samt `isDownloadable: true`. Det er API'ets face count; den er ikke en selvstændig inspektion af en downloadet GLB. Det officielle download-endpoint svarede **401 Unauthorized** uden login. Der er derfor ikke hentet eller distribueret en original model, og dens mesh-struktur er ikke inspiceret.

Det medfølgende bord er en selvstændig geometrisk fallback bygget i Three.js, med egne bevægelige stænger, figurer og pointtællere. En legitimt downloadet originalmodel kan placeres på `public/models/foosball-table.glb`; se `public/models/README.md`. Ved brug skal modelkreditering og CC BY 4.0-link bevares, og eventuelle ændringer angives.

## Lydeffekter

- Dommerfløjte: [Referee whistle blow, gymnasium.wav](https://freesound.org/people/SpliceSound/sounds/218318/) af SpliceSound, CC0 1.0.
- Mål: [Crowd Cheer.wav](https://freesound.org/people/deleted_user_2104797/sounds/346685/) af deleted_user_2104797, CC0 1.0.
- Begge individuelle kildesider er kontrolleret 19. oktober 2026. Lokale filer er korte, normaliserede uddrag. Se `public/audio/LICENSES.md` for præcise tilpasninger og kildehash.
- Spark og bandetræf er spillets egen Web Audio-syntese.
