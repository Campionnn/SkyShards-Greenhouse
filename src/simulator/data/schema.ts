import { z } from "zod";

// The shape of data.json exactly as the backend writes it (snake_case).
// load.ts is the only place that maps it to the camelCase domain types.

const size = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const effectList = z.array(z.string());
const drops = z.record(z.number().nonnegative());

export const cropSchema = z.object({
  name: z.string(),
  size,
  ground: z.string(),
  growth_stages: z.number().int().nonnegative().nullable(),
  positive_buffs: effectList,
  negative_buffs: effectList,
  drops,
  sell_price: z.number().nonnegative(),
});

export const mutationSchema = z.object({
  name: z.string(),
  size,
  ground: z.string(),
  requirements: z.array(z.object({ crop: z.string(), count: z.number().int().positive() })),
  rarity: z.enum(["common", "uncommon", "rare", "epic", "legendary"]),
  growth_stages: z.number().int().nonnegative(),
  decay: z.number().nonnegative(),
  positive_buffs: effectList,
  negative_buffs: effectList,
  requires_watering: z.boolean(),
  drops,
  spawn_weight: z.number().nonnegative(),
  special: z.string().optional(),
  harvest_info: z.string().optional(),
  growing_info: z.string().optional(),
});

export const effectSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const gameDataSchema = z.object({
  crops: z.record(cropSchema),
  mutations: z.record(mutationSchema),
  effects: z.record(effectSchema),
});

export type GameDataJson = z.infer<typeof gameDataSchema>;
