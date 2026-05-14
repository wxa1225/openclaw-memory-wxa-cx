// Tests for Feishu content importer

import { getHalfLifeForCategory } from "../lib/feishu-importer";

describe("Feishu importer", () => {
  describe("getHalfLifeForCategory", () => {
    it("returns correct half-life for decision", () => {
      expect(getHalfLifeForCategory("decision")).toBe(14);
    });

    it("returns correct half-life for api", () => {
      expect(getHalfLifeForCategory("api")).toBe(21);
    });

    it("returns correct half-life for process", () => {
      expect(getHalfLifeForCategory("process")).toBe(10);
    });

    it("returns correct half-life for security", () => {
      expect(getHalfLifeForCategory("security")).toBe(30);
    });

    it("returns correct half-life for experience", () => {
      expect(getHalfLifeForCategory("experience")).toBe(7);
    });

    it("returns default half-life for unknown category", () => {
      expect(getHalfLifeForCategory("unknown")).toBe(14);
    });
  });
});
