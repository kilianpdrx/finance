import { describe, it, expect } from "vitest";
import { projectionByHolding, holdingKey, type ProjectionMonth } from "./dividend-projection";

const PALETTE = ["c0", "c1", "c2", "c3"] as const;

function month(m: string, items: [string, string | null, number][]): ProjectionMonth {
  return { month: m, items: items.map(([ticker, name, amount_cents]) => ({ ticker, name, amount_cents })) };
}

describe("projectionByHolding", () => {
  it("makes one series per holding, largest first, named after the company", () => {
    const { series, rows } = projectionByHolding(
      [
        month("2026-12", [["AAPL", "Apple Inc.", 500], ["MC.PA", "LVMH", 1300]]),
        month("2027-01", [["AAPL", "Apple Inc.", 500]]),
        month("2027-02", []),
      ],
      PALETTE,
    );
    expect(series.map((s) => [s.label, s.tickers, s.color, s.total_cents])).toEqual([
      ["LVMH", ["MC.PA"], "c0", 1300],
      ["Apple Inc.", ["AAPL"], "c1", 1000],
    ]);
    // Synthetic keys: « MC.PA » as a dataKey would be read as a path by Recharts.
    expect(series.map((s) => s.key)).toEqual(["h0", "h1"]);
    expect(rows).toEqual([
      { month: "2026-12", h0: 1300, h1: 500 },
      { month: "2027-01", h0: 0, h1: 500 },
      { month: "2027-02", h0: 0, h1: 0 },
    ]);
  });

  it("adds up the same ticker held in two accounts", () => {
    const { series, rows } = projectionByHolding(
      [month("2026-12", [["MC.PA", "LVMH", 2600], ["mc.pa", "LVMH", 1300]])],
      PALETTE,
    );
    expect(series).toHaveLength(1);
    expect(series[0].total_cents).toBe(3900);
    expect(rows[0].h0).toBe(3900);
  });

  it("falls back to the ticker when there is no name", () => {
    const { series } = projectionByHolding([month("2026-12", [["VWCE.DE", null, 100], ["X", "  ", 50]])], PALETTE);
    expect(series.map((s) => s.label)).toEqual(["VWCE.DE", "X"]);
  });

  it("uses every colour once when the holdings fit", () => {
    const items: [string, string, number][] = [["A", "a", 40], ["B", "b", 30], ["C", "c", 20], ["D", "d", 10]];
    const { series } = projectionByHolding([month("2026-12", items)], PALETTE);
    expect(series.map((s) => s.color)).toEqual(["c0", "c1", "c2", "c3"]);
    expect(series.some((s) => s.other)).toBe(false);
  });

  it("folds the smallest into « Autres » with the last colour, never cycling", () => {
    const items: [string, string, number][] = [
      ["A", "a", 60], ["B", "b", 50], ["C", "c", 40], ["D", "d", 30], ["E", "e", 20], ["F", "f", 10],
    ];
    const { series, rows } = projectionByHolding([month("2026-12", items), month("2027-01", [["F", "f", 5]])], PALETTE);
    expect(series.map((s) => s.label)).toEqual(["a", "b", "c", "Autres (3)"]);
    expect(series.map((s) => s.color)).toEqual(["c0", "c1", "c2", "c3"]);
    expect(new Set(series.map((s) => s.color)).size).toBe(series.length);
    const others = series[3];
    expect(others).toMatchObject({ key: "other", other: true, tickers: ["D", "E", "F"], total_cents: 65 });
    expect(rows[0].other).toBe(60);
    expect(rows[1].other).toBe(5);
    // Nothing is lost: each month's rows add up to its items.
    expect(series.reduce((s, x) => s + (rows[0][x.key] as number), 0)).toBe(210);
  });

  it("breaks ties by name and ignores empty amounts", () => {
    const { series } = projectionByHolding(
      [month("2026-12", [["Z", "Zeta", 10], ["A", "Alpha", 10], ["N", "Nul", 0]])],
      PALETTE,
    );
    expect(series.map((s) => s.label)).toEqual(["Alpha", "Zeta"]);
  });

  it("has no series when nothing is projected", () => {
    expect(projectionByHolding([month("2026-12", [])], PALETTE)).toEqual({
      series: [],
      rows: [{ month: "2026-12" }],
    });
  });
});

describe("holdingKey", () => {
  it("is the ticker, case-insensitive", () => {
    expect(holdingKey({ ticker: " mc.pa ", name: "LVMH" })).toBe("MC.PA");
    expect(holdingKey({ ticker: "", name: "Fonds" })).toBe("FONDS");
  });
});
