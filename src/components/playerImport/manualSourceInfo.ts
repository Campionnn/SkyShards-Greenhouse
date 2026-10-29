/**
 * Extra tooltip text for the import's "Not in the API" sources (ManualSources.tsx), keyed by the
 * server's source id (SkyShards-API fortune/manual.py). The server's own `hint` (with the player's
 * numbers) is shown first; these lines add how the source works and how to get it.
 *
 * Source: hypixelskyblock.minecraft.wiki (Account & Profile Upgrades, Rosewater Flask, Mooshroom Cow
 * Pet, Garden Chips, Earthworm / Firefly / Lunar Moth / Mite Shard, Atmospheric Filter, Magic 8 Ball,
 * Crop Fever, Pesthunter Phillip, Harvest Harbinger Potion, Century Cake, Celestial Mason Jar, Melon
 * Juice Mixin, Doug, Zorro's Cape, Anita's Artifact), checked Oct 2026.
 */

const CHIP_RARITY =
  "Rarity goes up by consuming more of the same chip (Rare 1, Epic 5, Legendary 21 in total) and caps the level: Rare 10, Epic 15, Legendary 20. Levels cost Sowdust. Check /chips for your rarity.";

export const MANUAL_SOURCE_INFO: Record<string, readonly string[]> = {
  gardenFortuneUpgrade: [
    "Bought from Elizabeth in the Community Center (Account & Profile Upgrades → Account Upgrades). Tiers are free but take time: 3, 5, 7, 10, 12, 15, 18, 21, 25 and 30 days (146 days for all 10), or skip the wait with Gems.",
    "Up to +40 Farming Fortune on The Garden. Account-wide: it applies to all your profiles.",
  ],
  rosewaterFlasks: [
    "Craft a Rosewater Flask (Wild Rose VI collection). It fills after 300 hours of aging, twice as fast in a Time Pocket. Filled flasks are also on the Bazaar.",
    "Drinking one also adds +4 growth stages to the Greenhouse crops in your plot. 2-hour cooldown between flasks.",
  ],
  mooshroomStrength: [
    "Mooshroom Cow perk, Rare or better: +0.7 Farming Fortune per X Strength, rounded down. X falls with pet level: Rare 39.9 → 30, Epic/Legendary 39.8 → 20 at level 100.",
    "Enter the Strength from your SkyBlock menu with your farming setup on. Defaults to a realistic max of 1,780.",
  ],
  cropshotRarity: [
    "Up to +30 / +60 / +100 Farming Fortune (Rare / Epic / Legendary). Bought from SkyMart for 500 Copper; Jeff gives you one free.",
    CHIP_RARITY,
  ],
  rarefinderRarity: [
    "Up to +15 / +30 / +50 Overbloom (Rare / Epic / Legendary). A rare drop while farming crops (0.0005% base chance).",
    CHIP_RARITY,
  ],
  evergreenRarity: [
    "Up to 20% / 37.5% / 60% more base crops in the Greenhouse (Rare / Epic / Legendary). Drops from the Greenhouse Harvest Bounty (3%).",
    CHIP_RARITY,
  ],
  hyperchargeRarity: [
    "Up to +30% / +60% / +100% (Rare / Epic / Legendary). Boosts Atmospheric Filter, Celestial Mason Jar, Chocolate Century Cake, Crop Fever, Magic 8 Ball, Melon Juice Mixin, Pesthunter Phillip and the Slug Pet.",
    "Does not boost Anita's accessories, the Earthworm Shard, Fortunate Feasting, the Harvest Harbinger Potion, Refined Dark Cacao Truffles or the Overdrive Chip.",
    "Rare reward from Garden Visitor offers (2%).",
    CHIP_RARITY,
  ],
  overdriveRarity: [
    "Up to +50 / +90 / +140 crop fortune (Rare / Epic / Legendary) for the active crop of a Jacob's Farming Contest. Bought from Anita for 2 Gold Medals. Not boosted by Hypercharge.",
    CHIP_RARITY,
  ],
  solarLunar: [
    "Attribute shards, max level 10 (+50 Farming Fortune each). Firefly Shard: Solar Power, daytime. Lunar Moth Shard: Lunar Power, night. Pick the one for when you farm.",
  ],
  infiltration: [
    "Earthworm Shard attribute (max level 10, +30). Counts only while the Garden plot you're in has a pest. Not boosted by Hypercharge.",
  ],
  atmosphericFilter: [
    "Rare accessory, dropped by the Mite pest (0.5%). Only Spring gives Farming Fortune. Summer: +20 Farming Wisdom. Autumn: pests spawn more often. Winter: +5% Visitor Copper.",
    "The Mite Shard's Filter Upgrade makes it 2% stronger per level (max +20%). Boosted by Hypercharge.",
  ],
  magic8Ball: [
    "Epic accessory from the Dark Auction. It picks one of 5 answers for each SkyBlock season. Only \"It is certain.\" gives Farming Fortune; the others give Foraging Fortune, Mining Fortune, Sea Creature Chance or Strength.",
    "Boosted by Hypercharge.",
  ],
  cropFever: [
    "Ultimate enchantment for farming tools (I–V). Each crop broken has a 0.001% chance per level to start it. For 60 seconds you get the bonus and a chance at extra enchanted crops. The level only changes how often it starts.",
    "Boosted by Hypercharge.",
  ],
  pesthunterPhillip: [
    "Garden NPC (Garden level 5). Turn in pests from your vacuum for +5 Farming Fortune each, up to 40 pests (+200). Lasts 30 minutes, or 60 with Finnegan's Pest Eradicator perk.",
    "Boosted by Hypercharge.",
  ],
  harvestHarbinger: [
    "A reward from the Garden visitor Maeve; also on the Auction House. Not boosted by Hypercharge (the wiki calls this likely a bug).",
  ],
  centuryCake: [
    "The Year 200 Century Cake: from Simon every 100 SkyBlock years, the Raffle of the Century or cake bundles. Place it on a private island and eat it.",
    "The 48 hours count offline, and you can eat it again to reset the timer. Boosted by Hypercharge.",
  ],
  masonJar: [
    "Legendary mixin, crafted from 4 Feast Flasks (Harvest Feast milestones) or bought on the Bazaar. Also gives Magic Find, Mining Fortune and Foraging Fortune.",
    "Lasts as long as the God Potion it is brewed into. Drinking it directly needs an active God Potion and Booster Cookie. Boosted by Hypercharge.",
  ],
  melonJuice: [
    "Rare mixin, crafted from 16 Melon Juice and 2 Soggybud. Melon Juice is the Harvest Feast rare crop from Melon.",
    "Lasts as long as the God Potion it is brewed into. The wiki says Hypercharge boosts it since a fix on Oct 28, 2026.",
  ],
  fortunateFeasting: [
    "Tiers I–V cost 50 / 100 / 150 / 200 / 250 Carnival Tokens at Doug. Not boosted by Hypercharge.",
    "The Harvest Feast runs from Early to Late Autumn each SkyBlock year, about 31 hours. Finnegan's Grand Feast perk makes it last all year.",
  ],
  zorroContest: [
    "All of Zorro's Cape's stats double during Jacob's Farming Contest: up to 66 → 132 Farming Fortune fully upgraded. Bought from the Chocolate Shop.",
  ],
  anitaAccessory: [
    "Anita's Talisman / Ring / Artifact: +5 / +15 / +25 crop fortune for one contest crop, shown in your calendar. Bought from Anita with medals and Jacob's Tickets. Not boosted by Hypercharge.",
  ],
};
