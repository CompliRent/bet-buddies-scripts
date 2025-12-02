import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { get24HoursFromDate, getEndOfCurrentNFLWeek } from "./date-utils";

describe("get24HoursFromDate", () => {
  it("returns exactly 24 hours after the given date", () => {
    const base = new Date("2025-11-24T08:30:00.000Z");
    const result = new Date(get24HoursFromDate(base));

    assert.equal(result.toISOString(), "2025-11-25T08:30:00.000Z");
  });
});

describe("getEndOfCurrentNFLWeek", () => {
  it("returns this week's Wednesday at 8 AM when base is before Tuesday", () => {
    const base = new Date("2025-11-24T10:00:00.000Z"); // Monday
    const result = new Date(getEndOfCurrentNFLWeek(base));

    assert.equal(result.toISOString(), "2025-11-26T08:00:00.000Z"); // Wednesday of same week
  });

  it("returns next week's Wednesday at 8 AM when base is Tuesday", () => {
    const base = new Date("2025-11-25T08:30:00.000Z"); // Tuesday
    const result = new Date(getEndOfCurrentNFLWeek(base));

    assert.equal(result.toISOString(), "2025-12-03T08:00:00.000Z");
  });

  it("returns next week's Wednesday at 8 AM when base is earlier on Wednesday", () => {
    const base = new Date("2025-11-26T07:00:00.000Z"); // Wednesday before 8 AM
    const result = new Date(getEndOfCurrentNFLWeek(base));

    assert.equal(result.toISOString(), "2025-12-03T08:00:00.000Z");
  });

  it("returns next week's Wednesday at 8 AM when base is later on Wednesday", () => {
    const base = new Date("2025-11-26T09:00:00.000Z"); // Wednesday after 8 AM
    const result = new Date(getEndOfCurrentNFLWeek(base));

    assert.equal(result.toISOString(), "2025-12-03T08:00:00.000Z"); // Next Wednesday
  });

  it("returns next week's Wednesday at 8 AM when base is Friday", () => {
    const base = new Date("2025-11-28T08:00:00.000Z"); // Friday
    const result = new Date(getEndOfCurrentNFLWeek(base));

    assert.equal(result.toISOString(), "2025-12-03T08:00:00.000Z"); // Next Wednesday
  });
});
