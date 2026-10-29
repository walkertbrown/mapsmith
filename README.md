# Mapsmith

Town maps from a seed, drawn right in your notes.

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
| `name` | The town's name. Leave it out and the seed picks one. |

The bar above the map changes size, water, walls and land, and **New town** rolls a new seed. Each of them rewrites the block, so what you see is always what the note says. The command **Insert a town map** adds a block with a fresh seed.

The map is drawn in the colours of your theme, light or dark.

## Privacy

Mapsmith makes no network requests. Everything is drawn on your device from the seed.

## Licence

MIT
