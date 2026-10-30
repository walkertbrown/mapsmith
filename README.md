# Mapsmith

Town, ship and dungeon maps from a seed, drawn right in your notes.

![A Mapsmith town on a river mouth with hills behind it, the temple picked and its card below](docs/demo.png)

Put a `mapsmith` block in a note and you get a walled town, a river village or a harbour city, with its streets, wards, bridges, gates, docks, fields and woods. The same seed always draws the same town, so a map in your campaign notes never changes under you.

Every map has numbered places: the market, the temple, the inn, the smithy, the harbour and more. Click a number, or the building it sits on, to see the place's name, who keeps it, what it's like and a hook to start trouble with. **Open its note** writes a note for that place, in a folder named after the town, so you can keep writing about it.

## The block

````
```mapsmith
seed: saltmarch
size: town
water: estuary
side: east
walls: yes
name: Saltmarch
```
````

| Key | What it does |
| --- | --- |
| `seed` | Any words. The same seed draws the same town. |
| `size` | `hamlet`, `village`, `town`, `large-town` or `city` |
| `water` | `none`, `river`, `coast`, `estuary` (a river into the sea) or `lake` |
| `side` | Where the sea or lake lies: `north`, `south`, `east` or `west` |
| `walls` | `yes` or `no`. Hamlets and villages never have walls. |
| `land` | `parchment` (the default) or `green`, for how the country around the town is painted |
| `terrain` | `flat` (the default), `hills` or `mountains`. Roads wind round high ground, rivers cut valleys through it, and mountains go to bare rock at the top. |
| `name` | The town's name. Leave it out and the seed picks one. |

The bar above the map changes size, water, terrain, walls and land, and **New town** rolls a new seed. Each of them rewrites the block, so what you see is always what the note says. The command **Insert a town map** adds a block with a fresh seed.

The map is drawn in the colours of your theme, light or dark.

## Ships

Add `map: ship` and the block draws a spaceship's deck plan instead: rooms, corridors, doors, airlocks, hatches and the fittings in each room, numbered like a town's places.

````
```mapsmith
map: ship
seed: saltmarch
size: freighter
mood: derelict
```
````

![A derelict freighter's upper deck, engineering picked and its card below](docs/ship.png)

| Key | What it does |
| --- | --- |
| `size` | `shuttle`, `corvette`, `freighter` or `station`. Freighters and stations have two decks. |
| `mood` | `intact`, a working ship with a crew aboard, or `derelict`, a wreck with a story of how it got that way, holes torn in the hull, hazards and salvage |
| `deck` | Which deck to draw, `1` or `2` |
| `explore` | Solo play, as on a dungeon (see Exploring alone below) |

Above the map is the ship's story, folded away until you open it. Click a room's number for what's in it; **Open its note** writes the room to a folder named after the ship. The bar changes size, deck and mood, and **New ship** rolls a new seed. The command **Insert a ship map** adds a ship block. **Explore** works on ships too: you come aboard through an airlock, or by the ladder from the deck before, and each compartment rolls what's aboard. Intact ships and derelicts have different lists.

## Dungeons

Add `map: dungeon` for a dungeon level: rooms joined by corridors, with plain doors, open arches, barred gates and the odd secret door (marked S), and fittings drawn in each room, from coffins and altars to racks and barrels.

````
```mapsmith
map: dungeon
seed: saltmarch
size: dungeon
kind: crypt
```
````

![A crypt with nine rooms, the founder's tomb picked and its card below](docs/dungeon.png)

| Key | What it does |
| --- | --- |
| `size` | `lair` (4 to 6 rooms), `dungeon` (8 to 10) or `deep` (13 to 16, with stairs going further down) |
| `kind` | `crypt`, family vaults under the ground, or `keep`, a fallen stronghold: buildings in a walled yard, a tower on each corner and a barred gate |
| `explore` | solo play: the numbers of the rooms you've been in, such as `1, 3, 4`, `on` to start, or `off` to show the whole map. The **Explore** button writes it for you |

Each room has a line on what's there, and some have a hazard or treasure; the room at the far end always has treasure. Above the map is the dungeon's story with a hook. **Open its note** writes a room to a folder named after the dungeon, and **New dungeon** rolls a new seed. The command **Insert a dungeon map** adds a dungeon block.

### Exploring alone

Press **Explore** to play a dungeon on your own. Only the way in can be seen (room 1 in a dungeon), with the corridors and open ground that lead out of it. Every other room stays dark. A question mark sits at each door into the dark; click it to go in, and that room, its number and its card appear. The card also says what you found inside: nothing, a sign of what's ahead, a trap, or something waiting for you, with the numbers growing in a deeper dungeon. Crypts and keeps have lists of their own, and a room always rolls the same thing, so it's still there when you come back. Secret doors stay hidden in this mode too. What you've explored is written into the block, so the note remembers how far you got. Press **Explore** again to see the whole map.

## Pro

Everything above is free. Mapsmith Pro is a one-time payment of $6 on itch, and it adds a **Save for virtual tabletop** button under every town, dungeon and ship. It writes a Universal VTT file (`.dd2vtt`) beside your note: the map as your players should see it, with no numbers and secret doors drawn as plain wall, plus the walls, doors, windows and lights already placed. In a town every building and the town wall are walls and the gates are doors, on a grid of five metres a square (ten on a large town or city). Roll20 imports it as it is, and Foundry reads it with the Universal Battlemap Importer module.

After you buy, copy your download page's address. Paste it into Mapsmith's settings under **Pro key** and press **Check**. Pro stays on in that vault from then on. Lost it? Type the email you bought with under **Lost your key?**.

## Privacy

Mapsmith has no accounts and collects nothing. Maps are drawn on your device from the seed. It goes online only when you press **Check** or **Mail my key** in its settings. Check sends the Pro key you pasted to this plugin's server (bulkhead.bananafest-destiny.com), which asks itch whether the key is real; the server keeps a hash of a good key, never the key. Mail my key sends the email you typed to the same server, which asks itch for that address's key and mails it there; it keeps only a hash of the address, so it mails no more than once an hour. Nothing else ever leaves your vault. Opening a room's note writes a new note, and saving for a virtual tabletop writes a `.dd2vtt` file beside the map's note.

## Licence

MIT
