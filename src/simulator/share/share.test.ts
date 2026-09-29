import { describe, expect, it } from "vitest";
import { CROP_IDS, MUTATION_IDS } from "../../constants/cropMapping";
import { decodeDesign, encodeDesign, extractLayoutCode } from "../../utilities/designEncoding";
import { defaultGameData } from "../data/default";
import { LAYOUT_A_CODE, LAYOUT_B_CODE } from "../testHelpers";
import { layoutFromDecoded, layoutFromShareCode } from "./layoutFromShare";

const data = defaultGameData();

const countBy = (xs: { id: string }[]) => xs.reduce<Record<string, number>>((acc, x) => ((acc[x.id] = (acc[x.id] ?? 0) + 1), acc), {});

describe("share-code palette", () => {
  // Share codes store GLOBAL indices into CROP_IDS ++ MUTATION_IDS (base 36).
  // Reordering or inserting into these arrays silently changes the meaning of
  // every existing link. Append new ids at the end only.
  it("is frozen (append-only)", () => {
    expect([...CROP_IDS, ...MUTATION_IDS].join(",")).toBe(
      "wheat,potato,carrot,pumpkin,melon,cocoa_beans,sugar_cane,cactus,nether_wart,red_mushroom,brown_mushroom," +
        "moonflower,sunflower,wild_rose,fire,dead_plant,fermento," +
        "ashwreath,choconut,dustgrain,gloomgourd,lonelily,scourroot,shadevine,veilshroom,witherbloom,chocoberry," +
        "cindershade,coalroot,creambloom,duskbloom,thornshade,blastberry,cheesebite,chloronite,do_not_eat_shroom," +
        "fleshtrap,magic_jellybean,noctilume,snoozling,soggybud,chorus_fruit,plantboy_advance,puffercloud,shellfruit," +
        "startlevine,stoplight_petal,thunderling,turtlellini,zombud,all_in_aloe,devourer,glasscorn,godseed," +
        "jerryflower,phantomleaf,timestalk"
    );
  });

  it("covers every crop and mutation in the game data", () => {
    expect([...CROP_IDS].sort()).toEqual([...data.cropIds].sort());
    expect([...MUTATION_IDS].sort()).toEqual([...data.mutationIds].sort());
  });
});

describe("decoding the two real shares with the current palette", () => {
  it("Layout B: 16 magic_jellybean + 24 chloronite + 5 cindershade planted, 9 EMPTY chorus_fruit targets", () => {
    const { layout, issues } = layoutFromShareCode(LAYOUT_B_CODE, data);
    expect(issues).toEqual([]);
    expect(countBy(layout.plants.map((p) => ({ id: p.kindId })))).toEqual({ magic_jellybean: 16, chloronite: 24, cindershade: 5 });
    expect(countBy(layout.slots.map((s) => ({ id: s.mutationId })))).toEqual({ chorus_fruit: 9 });
  });

  it("Layout A: 82 planted cells, 18 empty targets of 8 kinds (the doc's table undercounts)", () => {
    const { layout, issues } = layoutFromShareCode(LAYOUT_A_CODE, data);
    expect(issues).toEqual([]);
    expect(layout.plants).toHaveLength(82);
    expect(layout.slots).toHaveLength(18);
    expect(countBy(layout.slots.map((s) => ({ id: s.mutationId })))).toEqual({
      coalroot: 4,
      chloronite: 4,
      thornshade: 2,
      witherbloom: 2,
      ashwreath: 2,
      cindershade: 2,
      scourroot: 1,
      veilshroom: 1,
    });
    const planted = countBy(layout.plants.map((p) => ({ id: p.kindId })));
    expect(planted.coalroot).toBe(13);
    expect(planted.ashwreath).toBe(14);
    expect(planted.scourroot).toBe(8);
    expect(planted.dead_plant).toBe(4);
    expect(planted.fire).toBe(2);
  });

  it("uppercase cells are EMPTY targets, lowercase cells are planted - never the other way round", () => {
    const decoded = decodeDesign(LAYOUT_B_CODE);
    expect(decoded.targets.every((t) => t.cropId === "chorus_fruit")).toBe(true);
    expect(decoded.inputs.some((t) => t.cropId === "chorus_fruit")).toBe(false);
  });

  it("round-trips through encodeDesign", () => {
    const decoded = decodeDesign(LAYOUT_A_CODE);
    const again = decodeDesign(encodeDesign(decoded.inputs, decoded.targets));
    expect(again).toEqual(decoded);
  });

  it("reports unknown and overlapping entries instead of fixing them", () => {
    const code = encodeDesign(
      [{ cropId: "noctilume", position: [0, 0] }, { cropId: "wheat", position: [1, 1] }],
      [{ cropId: "gloomgourd", position: [9, 9] }]
    );
    const { layout, issues } = layoutFromShareCode(code, data);
    expect(issues.some((m) => m.includes("overlaps"))).toBe(true);
    expect(layout.plants).toHaveLength(1);
  });
});

describe("decoded ground tiles", () => {
  it("maps bare-cell tiles into the simulator LayoutSpec without dropping explicit farmland", () => {
    const { layout, issues } = layoutFromDecoded({
      inputs: [], targets: [], groundTiles: [
        { ground: "sand", position: [2, 3] },
        { ground: "farmland", position: [0, 0] },
      ],
    }, data);
    expect(issues).toEqual([]);
    expect(layout.groundTiles).toEqual([
      { ground: "farmland", row: 0, col: 0 },
      { ground: "sand", row: 2, col: 3 },
    ]);
  });
});

describe("extractLayoutCode", () => {
  it("accepts share URLs, designer URLs and raw codes", () => {
    expect(extractLayoutCode(`https://api.skyshards.com/share/${LAYOUT_B_CODE}`)).toBe(LAYOUT_B_CODE);
    expect(extractLayoutCode(`https://greenhouse.skyshards.com/designer?layout=${LAYOUT_B_CODE}`)).toBe(LAYOUT_B_CODE);
    expect(extractLayoutCode(`  ${LAYOUT_B_CODE}  `)).toBe(LAYOUT_B_CODE);
  });
});
