import { describe, it, expect } from "vitest";
import {
  localDateTimeToUtcIso,
  normalizeRunnerEvent,
  type RunnerEvent,
} from "@/lib/ingest/normalize";

describe("localDateTimeToUtcIso", () => {
  it("converts a summer ET time to UTC (EDT, -4)", () => {
    const { iso, allDay } = localDateTimeToUtcIso("7/15/2026", "3:00 PM");
    // 3:00 PM EDT = 19:00 UTC
    expect(iso).toBe("2026-07-15T19:00:00.000Z");
    expect(allDay).toBe(false);
  });

  it("converts a winter ET time to UTC (EST, -5)", () => {
    const { iso, allDay } = localDateTimeToUtcIso("1/15/2026", "9:00 AM");
    // 9:00 AM EST = 14:00 UTC
    expect(iso).toBe("2026-01-15T14:00:00.000Z");
    expect(allDay).toBe(false);
  });

  it("handles noon and midnight cleanly", () => {
    // 12:00 PM (noon) EDT = 16:00 UTC
    expect(localDateTimeToUtcIso("7/1/2026", "12:00 PM").iso).toBe(
      "2026-07-01T16:00:00.000Z"
    );
    // 12:00 AM (midnight) EDT = 04:00 UTC same date
    expect(localDateTimeToUtcIso("7/1/2026", "12:00 AM").iso).toBe(
      "2026-07-01T04:00:00.000Z"
    );
  });

  it("treats empty time as all-day at 09:00 ET", () => {
    const { iso, allDay } = localDateTimeToUtcIso("7/15/2026", "");
    expect(allDay).toBe(true);
    // 09:00 EDT = 13:00 UTC
    expect(iso).toBe("2026-07-15T13:00:00.000Z");
  });

  it("throws on malformed date", () => {
    expect(() => localDateTimeToUtcIso("bogus", "3:00 PM")).toThrow(/Bad date/);
  });

  it("throws on malformed time", () => {
    expect(() => localDateTimeToUtcIso("7/15/2026", "later")).toThrow(
      /Bad time/
    );
  });
});

describe("normalizeRunnerEvent", () => {
  const base: RunnerEvent = {
    source: "test",
    title: "  Test Event  ",
    date: "7/15/2026",
    time: "3:00 PM",
    end_time: "5:00 PM",
    location: "Malcolm X Park, DC",
    host: "Some Org",
    rsvp_link: "https://example.com/rsvp",
    event_url: "https://example.com/event",
    image_url: "https://example.com/img.jpg",
    description: "Come out",
  };

  it("maps runner fields to the normalized payload shape", () => {
    const out = normalizeRunnerEvent(base, "overlay-abc");
    expect(out).toMatchObject({
      title: "Test Event",
      description: "Come out",
      starts_at: "2026-07-15T19:00:00.000Z",
      ends_at: "2026-07-15T21:00:00.000Z",
      all_day: false,
      timezone: "America/New_York",
      location_text: "Malcolm X Park, DC",
      location_type: "in_person",
      host_org: "Some Org",
      web_link: "https://example.com/rsvp",
      image_url: "https://example.com/img.jpg",
      overlay_calendar_id: "overlay-abc",
      event_type_id: null,
      accessibility: [],
      cost: null,
    });
  });

  it("prefers rsvp_link over event_url when both are present", () => {
    expect(normalizeRunnerEvent(base, null).web_link).toBe(
      "https://example.com/rsvp"
    );
  });

  it("falls back to event_url when rsvp_link is empty", () => {
    const ev: RunnerEvent = { ...base, rsvp_link: "" };
    expect(normalizeRunnerEvent(ev, null).web_link).toBe(
      "https://example.com/event"
    );
  });

  it("nulls empty strings for optional text fields", () => {
    const ev: RunnerEvent = {
      ...base,
      description: "   ",
      location: "",
      host: "",
      image_url: "",
    };
    const out = normalizeRunnerEvent(ev, null);
    expect(out.description).toBeNull();
    expect(out.location_text).toBeNull();
    expect(out.host_org).toBeNull();
    expect(out.image_url).toBeNull();
    expect(out.location_type).toBeNull();
  });

  it("guesses location_type from keywords", () => {
    expect(
      normalizeRunnerEvent({ ...base, location: "Zoom (link in RSVP)" }, null)
        .location_type
    ).toBe("online");
    expect(
      normalizeRunnerEvent({ ...base, location: "Hybrid — in-person + Zoom" }, null)
        .location_type
    ).toBe("hybrid");
    expect(
      normalizeRunnerEvent({ ...base, location: "Freedom Plaza" }, null)
        .location_type
    ).toBe("in_person");
  });

  it("returns null ends_at when end_time is missing or invalid", () => {
    expect(
      normalizeRunnerEvent({ ...base, end_time: "" }, null).ends_at
    ).toBeNull();
    expect(
      normalizeRunnerEvent({ ...base, end_time: "notatime" }, null).ends_at
    ).toBeNull();
  });

  it("marks all_day and sets a sane starts_at when time is empty", () => {
    const out = normalizeRunnerEvent({ ...base, time: "" }, null);
    expect(out.all_day).toBe(true);
    expect(out.starts_at).toBe("2026-07-15T13:00:00.000Z");
  });
});
