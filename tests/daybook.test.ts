import { describe, it, expect } from "vitest";
import { DaybookComposition } from "@/lib/daybook/types";
import { validateDraft } from "@/lib/daybook/validation";
import { renderEmailHtml, renderForNotion } from "@/lib/daybook/render";

const validComp = DaybookComposition.parse({
  edition: "daybook",
  publication_date: "2026-09-22",
  subject: "DC Daybook — September 22, 2026",
  intro: "Tuesday briefing.",
  movement_calendar: [
    {
      title: "Housing rally",
      start: "2026-09-22T17:00:00-04:00",
      location: "Freedom Plaza",
    },
  ],
  white_house: [{ time: "10:15 AM ET", description: "POTUS Oval remarks" }],
  congress: [
    {
      chamber: "senate",
      committee: "Judiciary",
      title: "Nomination hearing",
      start: "2026-09-22T14:00:00-04:00",
    },
  ],
  scotus: [],
  dc_gov: [],
  alert_dc: [],
  weather_email_only: { summary: "Sunny", high_f: 82, low_f: 64 },
});

describe("DaybookComposition schema", () => {
  it("accepts a well-formed briefing", () => {
    expect(validComp.movement_calendar).toHaveLength(1);
  });
  it("rejects malformed date", () => {
    const r = DaybookComposition.safeParse({ ...validComp, publication_date: "9/22/26" });
    expect(r.success).toBe(false);
  });
});

describe("renderEmailHtml", () => {
  const html = renderEmailHtml(validComp);
  it("includes the movement item", () => {
    expect(html).toContain("Housing rally");
  });
  it("includes weather in daybook email", () => {
    expect(html).toContain("Sunny");
  });
  it("drops sections that are empty", () => {
    expect(html).not.toContain("Supreme Court");
    expect(html).not.toContain("AlertDC");
  });
});

describe("renderForNotion", () => {
  it("strips weather", () => {
    const notion = renderForNotion(validComp);
    // @ts-expect-error runtime shape check
    expect(notion.weather_email_only).toBeUndefined();
    expect(JSON.stringify(notion)).not.toContain("Sunny");
  });
});

describe("validateDraft", () => {
  const html = renderEmailHtml(validComp);
  it("passes for a clean draft", () => {
    const report = validateDraft({
      composition: validComp,
      html,
      subject: validComp.subject,
      archiveUrlResolves: true,
      movementCalendarSourceCount: 1,
    });
    expect(report.passed).toBe(true);
  });
  it("fails when subject omits date", () => {
    const report = validateDraft({
      composition: validComp,
      html,
      subject: "DC Daybook",
      archiveUrlResolves: true,
      movementCalendarSourceCount: 1,
    });
    expect(report.passed).toBe(false);
  });
  it("fails when movement count mismatches source", () => {
    const report = validateDraft({
      composition: validComp,
      html,
      subject: validComp.subject,
      archiveUrlResolves: true,
      movementCalendarSourceCount: 5,
    });
    expect(report.passed).toBe(false);
  });
  it("fails when placeholder leaks", () => {
    const bad = html.replace("Housing rally", "{{ event_title }}");
    const report = validateDraft({
      composition: validComp,
      html: bad,
      subject: validComp.subject,
      archiveUrlResolves: true,
      movementCalendarSourceCount: 1,
    });
    expect(report.passed).toBe(false);
  });
  it("fails when archive URL does not resolve", () => {
    const report = validateDraft({
      composition: validComp,
      html,
      subject: validComp.subject,
      archiveUrlResolves: false,
      movementCalendarSourceCount: 1,
    });
    expect(report.passed).toBe(false);
  });
});
