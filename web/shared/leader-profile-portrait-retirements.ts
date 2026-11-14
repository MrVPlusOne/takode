/**
 * Portrait ids that no longer exist, each with the portrait that replaces it. Leaders keep their
 * saved id, so every retired id must point at a portrait that still exists.
 *
 * - The first cat sets were saved as one id per sheet; each sheet id names the portrait that
 *   replaced the sheet's first cat, so it can come from another sheet of the same set.
 * - The Tako and Shmi sets were cut from 48 to 16 cats each, keeping one cat per pose or idea.
 *   A dropped cat is replaced by the kept cat of the same set whose pose or mood is closest.
 */
export const RETIRED_LEADER_PROFILE_PORTRAIT_REPLACEMENTS: Readonly<Record<string, string>> = {
  tako1: "tako1-01",
  tako2: "tako2-01",
  tako3: "tako1-01",
  shmi1: "shmi1-02",
  shmi2: "shmi2-16",
  shmi3: "shmi2-11",

  // Tako: plain fronts go to the front portrait, laughs to the laughing cat, laptops to the
  // terminal peek, thoughtful paws to the night thinker, sleepy ones to the blanket.
  "tako1-02": "tako1-01",
  "tako1-05": "tako2-09",
  "tako1-06": "tako2-01",
  "tako1-07": "tako1-04",
  "tako1-10": "tako2-01",
  "tako1-11": "tako3-02",
  "tako1-13": "tako2-12",
  "tako1-15": "tako2-09",
  "tako1-16": "tako1-04",
  "tako2-02": "tako1-01",
  "tako2-04": "tako2-09",
  "tako2-05": "tako1-09",
  "tako2-06": "tako3-02",
  "tako2-07": "tako1-04",
  "tako2-08": "tako1-14",
  "tako2-13": "tako2-01",
  "tako2-14": "tako1-04",
  "tako2-15": "tako2-09",
  "tako2-16": "tako2-01",
  "tako3-01": "tako1-01",
  "tako3-04": "tako2-12",
  "tako3-05": "tako2-01",
  "tako3-06": "tako2-09",
  "tako3-07": "tako1-04",
  "tako3-08": "tako2-03",
  "tako3-10": "tako1-01",
  "tako3-11": "tako3-02",
  "tako3-12": "tako2-09",
  "tako3-13": "tako1-01",
  "tako3-14": "tako2-03",
  "tako3-15": "tako1-01",
  "tako3-16": "tako1-04",

  // Shmi: computers go to the typing cat, glasses and detectives to the glasses thinker, laughs to
  // the cheering cat, sleepers to the bed, fronts and hugs to the heart, outfits to the cape.
  "shmi1-01": "shmi1-02",
  "shmi1-03": "shmi1-04",
  "shmi1-06": "shmi1-04",
  "shmi1-09": "shmi1-15",
  "shmi1-12": "shmi1-02",
  "shmi1-13": "shmi2-16",
  "shmi1-14": "shmi1-02",
  "shmi1-16": "shmi1-11",
  "shmi2-01": "shmi2-16",
  "shmi2-02": "shmi3-08",
  "shmi2-03": "shmi2-10",
  "shmi2-04": "shmi1-07",
  "shmi2-05": "shmi1-04",
  "shmi2-06": "shmi2-16",
  "shmi2-07": "shmi1-11",
  "shmi2-08": "shmi2-10",
  "shmi2-09": "shmi2-16",
  "shmi2-13": "shmi1-15",
  "shmi2-14": "shmi2-10",
  "shmi2-15": "shmi1-05",
  "shmi3-01": "shmi2-11",
  "shmi3-02": "shmi2-12",
  "shmi3-03": "shmi1-04",
  "shmi3-06": "shmi1-05",
  "shmi3-07": "shmi3-04",
  "shmi3-09": "shmi2-16",
  "shmi3-10": "shmi1-15",
  "shmi3-12": "shmi1-11",
  "shmi3-13": "shmi3-04",
  "shmi3-14": "shmi1-02",
  "shmi3-15": "shmi1-10",
  "shmi3-16": "shmi2-10",
};
