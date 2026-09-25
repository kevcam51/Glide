# Smooth Training HQ — how the station art is made (S238)

Kevin wanted the HQ to look "almost identical" to StarNet: detailed, clear, almost 3D.
StarNet's pictures belong to its author and are not licensed with its MIT code, so none of
them are used here. What its repo *does* show is the method, and this is the same method:

1. **A structure guide from our own layout.** `drawStatic()` in `src/hqStation.js` renders the
   map with no desks and no lettering (the courtyard "ST" and the reception counter are
   filtered out), scaled to 2048×1536. That picture is the layout lock.
2. **Repaint it.** `generate.py` sends the guide plus `prompts/building.txt` to OpenAI's image
   model (`gpt-image-2`, the engine behind ChatGPT's images), billed to Glidna's own OpenAI
   account. The prompt keeps every room, hallway and door where the guide has it and leaves
   the middle of every room empty, because desks and people are drawn by the app.
3. **Sprites on a flat magenta background.** The crew (`prompts/crew.txt`), the owner
   (`prompts/owner.txt`, made from the crew sheet as a reference) and the desks
   (`prompts/props.txt`, `deskfront.txt`, `execfront.txt`, each made with an earlier sheet as a
   style reference) are generated on solid `#FF00FF`.
4. **Key and cut.** `key.py` turns the magenta into real transparency and removes the pink edge
   fringe; `sheet.py` cuts a 4×4 walk-cycle sheet into frames and packs an atlas (each facing
   scaled to the same height). The desks are cut from their sheet the same way and packed into
   one atlas; the rectangles live in `SPRITES.props` in `src/hqStation.js`.
5. **Ship small.** Everything is WebP in `src/hq-art/` (about 450 KB total), imported only by
   `src/HQStation.jsx`, so it rides the HQ's lazy chunk and no other account downloads it.

## Running it

```bash
# The key is read from Secret Manager into this process only and never printed.
export OPENAI_API_KEY="$(npx firebase functions:secrets:access OPENAI_API_KEY --project calorieiq-29762)"
python3 scripts/hq-art/generate.py --prompt-file scripts/hq-art/prompts/crew.txt \
  --out crew.png --size 1536x1536 --quality high
python3 scripts/hq-art/sheet.py crew.png crew-atlas.png 96
```

`generate.py` uses the Responses API in background mode and polls, because a high-quality
render takes one to two minutes and long single requests were being cut off on this network.
Pass `--ref <image>` (repeatable) to give the model a layout guide or a style reference.

## Costs (September 2026)

A high-quality 1536×1024 image is about $0.17 and 2048×1536 about $0.30; the first full set
(building, crew, owner, four desks and two front-facing desks, plus retries) cost about $2.

## Adding a room or a worker later

- **A new worker in an existing room:** no art needed. Add the seat in `src/hqOrg.js`, a spot
  in `SEAT_SPOTS`, and the desk is drawn from the same sheet.
- **A new room:** change the layout in `src/hqStation.js`, render a new guide, and repaint with
  `prompts/building.txt` plus the current `station-v1-2048.webp` as a second reference so the
  style carries over. Bump the file name (`station-v2-…`) so no browser keeps the old one.
- **A different look for a worker:** generate a new sheet with `prompts/owner.txt` as a pattern
  and the crew sheet as the reference.
