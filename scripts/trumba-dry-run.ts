/**
 * Dry-run: fetch the Trumba iCal feed, parse it, and print a summary.
 * Usage: npx tsx scripts/trumba-dry-run.ts
 */
import {
  TRUMBA_ICS_URL,
  parseTrumbaFeed,
  filterUpcoming,
} from "../src/lib/trumba-import";

async function main() {
  console.log(`Fetching ${TRUMBA_ICS_URL}…`);
  const res = await fetch(TRUMBA_ICS_URL);
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const ics = await res.text();
  console.log(`Got ${ics.length.toLocaleString()} bytes`);

  const all = parseTrumbaFeed(ics);
  const upcoming = filterUpcoming(all);
  const past = all.length - upcoming.length;

  console.log(`\nParsed: ${all.length} events (${upcoming.length} upcoming, ${past} past)\n`);

  // Category breakdown
  const byCategory = new Map<string, number>();
  for (const e of upcoming) {
    const c = e.category ?? "(no category)";
    byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
  }
  console.log("Upcoming events by category:");
  for (const [c, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${c}`);
  }

  // Event Type breakdown
  const byType = new Map<string, number>();
  for (const e of upcoming) {
    const t = e.event_type_name ?? "(unset)";
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  console.log("\nUpcoming events by event_type_name:");
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${t}`);
  }

  // Field-populated summary
  const withImage = upcoming.filter((e) => e.image_url).length;
  const withCost = upcoming.filter((e) => e.cost).length;
  const withHost = upcoming.filter((e) => e.host_org).length;
  const withWebLink = upcoming.filter((e) => e.web_link).length;
  const allDay = upcoming.filter((e) => e.all_day).length;

  console.log("\nField coverage (upcoming):");
  console.log(`  image_url  ${withImage}/${upcoming.length}`);
  console.log(`  cost       ${withCost}/${upcoming.length}`);
  console.log(`  host_org   ${withHost}/${upcoming.length}`);
  console.log(`  web_link   ${withWebLink}/${upcoming.length}`);
  console.log(`  all_day    ${allDay}/${upcoming.length}`);

  // Location type breakdown
  const byLoc = new Map<string, number>();
  for (const e of upcoming) {
    const l = e.location_type ?? "(unknown)";
    byLoc.set(l, (byLoc.get(l) ?? 0) + 1);
  }
  console.log("\nLocation types (upcoming):");
  for (const [l, n] of [...byLoc.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${l}`);
  }

  // Show 3 sample rows
  console.log("\nSample rows:");
  for (const e of upcoming.slice(0, 3)) {
    console.log(JSON.stringify(e, null, 2));
    console.log("---");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
