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

Above the map is the ship's story, folded away until you open it. Click a room's number for what's in it; **Open its note** writes the room to a folder named after the ship. The bar changes size, deck and mood, and **New ship** rolls a new seed. The command **Insert a ship map** adds a ship block.

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
| `kind` | `crypt`, family vaults under the ground, or `keep`, a fallen stronghold |

Each room has a line on what's there, and some have a hazard or treasure; the room at the far end always has treasure. Above the map is the dungeon's story with a hook. **Open its note** writes a room to a folder named after the dungeon, and **New dungeon** rolls a new seed. The command **Insert a dungeon map** adds a dungeon block.

## Privacy

Mapsmith makes no network requests. Everything is drawn on your device from the seed.

## Licence

MIT
