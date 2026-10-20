# Valgfri originalmodel

Spillet fungerer uden eksterne modeldownloads med sit geometriske Three.js-bord.

Den ønskede model er **Foosball Table** af **owestgate**:

- Model: https://sketchfab.com/3d-models/foosball-table-1303a318d4584639acef729b9fd296fc
- Ophavsmand: https://sketchfab.com/owestgate
- Licens: https://creativecommons.org/licenses/by/4.0/
- Officielle metadata: https://api.sketchfab.com/v3/models/1303a318d4584639acef729b9fd296fc

Metadata kontrolleret 17. oktober 2026: 11.772 faces, CC Attribution, kan downloades. Selve download-endpointet krævede login (401). Ingen originalmodel eller teksturer er derfor leveret her, og modellens interne meshstruktur er endnu ikke verificeret.

Download gennem Sketchfabs almindelige downloadfunktion med en konto, og konvertér om nødvendigt til en selvstændig GLB med indlejrede teksturer. Placér filen som:

```text
public/models/foosball-table.glb
```

Indlæseren undersøger filen automatisk og bruger kun separat navngivne statiske meshes, hvis navne matcher `frame`, `cabinet`, `leg` eller `tablebody`. Navne med `player`, `rod`, `handle`, `counter`, `pitch` eller `field` udelukkes. Modellen skaleres til bordets længde og placeres under den rekonstruerede spilleflade. Hvis disse dele ikke kan findes, beholdes fallback-bordet. Serveren skal sende GLB med eksempelvis `model/gltf-binary` eller `application/octet-stream` som Content-Type.

Efter lokal inspektion skal bordrammen passe til spillets X-længde / Y-højde / Z-bredde; omdøb og orientér om nødvendigt delene i et 3D-værktøj. Kinematiske stænger, figurer, bold og tællere styres af spillets egne objekter. En vilkårlig, uinspiceret GLB kan ikke antages at matche fysikkens dimensioner.

Bevar denne kreditering i spillet og dokumentationen, hvis modellen bruges:

“Foosball Table” af owestgate, Sketchfab, CC BY 4.0. Tilpasninger: skalering/orientering og eventuel udskiftning af bevægelige dele til Nem Bold.
