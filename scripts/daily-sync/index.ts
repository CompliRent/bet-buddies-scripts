/**
 * Daily Sync Job
 *
 * This script runs once per day to:
 * 1. Clear and repopulate upcoming_events table with events that don't start today
 * 2. Fetch results for events missing results and update the database
 */

import { createClient } from "@supabase/supabase-js";
import SportsGameOdds from "sports-odds-api";
import { Event } from "sports-odds-api/resources/events";

type Scores = {
  homeScore: number;
  awayScore: number;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPORTS_API_KEY = process.env.SPORTS_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SPORTS_API_KEY) {
  console.error("Missing required environment variables:");
  if (!SUPABASE_URL) console.error("  - SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) console.error("  - SUPABASE_SERVICE_ROLE_KEY");
  if (!SPORTS_API_KEY) console.error("  - SPORTS_API_KEY");
  process.exit(1);
}

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sportsClient = new SportsGameOdds({
  apiKeyHeader: SPORTS_API_KEY,
});

/**
 * Get 24 hours from now in ISO 8601 format
 */
function get24HoursFromDate(date: Date = new Date()): string {
  const tomorrow = new Date(date.getTime() + DAY_IN_MS);
  return tomorrow.toISOString();
}

/**
 * Get the following Wednesday at 8 AM UTC in ISO 8601 format
 * If today is Wednesday before 8 AM, returns today at 8 AM
 * Otherwise returns the next Wednesday at 8 AM
 */
function getFollowingWednesday8AM(date: Date = new Date()): string {
  const currentDay = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // Calculate days until next Wednesday at 8 AM
  // Wednesday is day 3 (0-indexed)
  let daysUntilWednesday: number;

  if (currentDay < 3) {
    // Before Wednesday, get this week's Wednesday
    daysUntilWednesday = 3 - currentDay;
  } else {
    // Wednesday 8 AM or later, or after Wednesday - get next week's Wednesday
    // Formula: (7 - currentDay) + 3
    // Example: Thursday (4) -> (7-4)+3 = 6 days to next Wednesday
    daysUntilWednesday = 7 - currentDay + 3;
  }

  // Create date for Wednesday at 8 AM UTC
  const wednesday = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + daysUntilWednesday,
      8, // 8 AM
      0, // 0 minutes
      0, // 0 seconds
      0 // 0 milliseconds
    )
  );

  return wednesday.toISOString();
}

/**
 * Fetch upcoming events from Sports Odds API
 * Only returns events that don't start today
 */
async function fetchUpcomingEvents(): Promise<Event[]> {
  console.log("Fetching events from Sports Odds API...");

  try {
    const startsAfter = get24HoursFromDate();
    const startsBefore = getFollowingWednesday8AM();

    console.log(`Fetching events from ${startsAfter} to ${startsBefore}`);

    // Fetch events with a higher limit to get more data
    const response = await sportsClient.events.get({
      leagueID: "NFL",
      oddsAvailable: true,
      oddID: "points-home-game-ml-home,points-away-game-ml-away",
      startsAfter,
      startsBefore,
      limit: 100,
    });

    const events = response.data || [];

    console.log(`Fetched ${events.length} upcoming events (excluding today's games)`);
    return events;
  } catch (error) {
    console.error("Error fetching events from Sports Odds API:", error);
    throw error;
  }
}

/**
 * Transform API event to database row format
 */
function transformEventToRow(event: Event):
  | {
      event_id: string;
      home_team_id: string;
      away_team_id: string;
      start_date: string;
      home_moneyline: number | null;
      away_moneyline: number | null;
    }
  | undefined {
  // Extract moneyline odds
  let homeMoneyline: number | null = null;
  let awayMoneyline: number | null = null;

  if (event.odds && typeof event.odds === "object") {
    for (const [oddID, odd] of Object.entries(event.odds)) {
      if (oddID === "points-home-game-ml-home" && odd.bookOdds) {
        homeMoneyline = Number(odd.bookOdds);
      }
      if (oddID === "points-away-game-ml-away" && odd.bookOdds) {
        awayMoneyline = Number(odd.bookOdds);
      }
    }
  }

  const returnObject = {
    event_id: event.eventID!,
    home_team_id: event.teams?.home?.teamID!,
    away_team_id: event.teams?.away?.teamID!,
    start_date: event.status?.startsAt!,
    home_moneyline: homeMoneyline,
    away_moneyline: awayMoneyline,
  };

  // only return if all values are defined
  if (Object.values(returnObject).every((value) => value !== undefined && value !== null)) {
    return returnObject;
  }
}

/**
 * Clear and repopulate upcoming_events table
 */
async function syncUpcomingEvents(): Promise<void> {
  console.log("\nStarting sync of upcoming_events...");

  try {
    // Fetch upcoming events
    const events = await fetchUpcomingEvents();

    if (events.length === 0) {
      console.log("No upcoming events found, skipping sync");
      return;
    }

    // Clear existing table
    console.log("Clearing existing upcoming_events...");
    const { error: deleteError } = await supabase.from("upcoming_events").delete().neq("event_id", ""); // Delete all rows

    if (deleteError) {
      throw new Error(`Failed to clear upcoming_events: ${deleteError.message}`);
    }
    console.log("Cleared upcoming_events table");

    // Transform and insert new events
    const rows = events.map(transformEventToRow).filter((event) => !!event);

    rows.forEach((row, idx) => console.log(`row ${idx}: ${row.away_team_id} at ${row.home_team_id}`));

    console.log(`Inserting ${rows.length} events into upcoming_events...`);
    const { error: insertError } = await supabase.from("upcoming_events").insert(rows);

    if (insertError) {
      throw new Error(`Failed to insert events: ${insertError.message}`);
    }

    console.log(`Successfully synced ${rows.length} upcoming events`);
  } catch (error) {
    console.error("Error syncing upcoming events:", error);
    throw error;
  }
}

/**
 * Fetch results for multiple events from Sports Odds API
 */
async function fetchEventResults(eventIds: string[]): Promise<Map<string, Scores>> {
  const results = new Map<string, Scores>();

  eventIds = eventIds.filter((id) => id !== null && id !== undefined);

  if (eventIds.length === 0) {
    return results;
  }

  try {
    // Fetch all events in one call using comma-separated eventIDs
    const response = await sportsClient.events.get({
      leagueID: "NFL",
      eventIDs: eventIds.join(","),
      ended: true,
      limit: 100,
    });

    const events = response.data || [];

    for (const event of events) {
      if (!event.eventID) continue;

      // Extract scores if available
      const eventWithScores = event;
      const homeScore = event?.teams?.home?.score;
      const awayScore = event?.teams?.away?.score;
      const ended = event.status?.ended ?? false;

      if (!!homeScore && !!awayScore && ended) {
        results.set(event.eventID, {
          homeScore,
          awayScore,
        });
      }
    }

    console.log(`Fetched results for ${results.size} out of ${eventIds.length} events`);
    return results;
  } catch (error) {
    console.error(`Error fetching results for events:`, error);
    return results;
  }
}

/**
 * Determine if a bet won based on selected team and scores
 */
function calculateBetResult(
  selectedTeamId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number
): boolean | null {
  const selectedHome = selectedTeamId === homeTeamId;
  const selectedAway = selectedTeamId === awayTeamId;

  if (selectedHome) {
    return homeScore > awayScore;
  } else if (selectedAway) {
    return awayScore > homeScore;
  }

  return null; // Invalid team selection
}

/**
 * Update results for events missing results
 */
async function syncEventResults(): Promise<void> {
  console.log("\nStarting sync of event results...");

  try {
    // Find all bets where result is null
    const { data: betsWithoutResults, error: fetchError } = await supabase.from("bets").select("*").is("result", null);

    if (fetchError) {
      throw new Error(`Failed to fetch bets: ${fetchError.message}`);
    }

    if (!betsWithoutResults || betsWithoutResults.length === 0) {
      console.log("No bets missing results");
      return;
    }

    console.log(`Found ${betsWithoutResults.length} bets missing results`);

    // Get unique event IDs
    const eventIds = [...new Set(betsWithoutResults.map((bet) => bet.event_id))];
    console.log(`Fetching results for ${eventIds.length} unique events...`);

    // Fetch all results in one API call
    const eventResults = await fetchEventResults(eventIds);

    // Update bets with results
    let updatedCount = 0;
    for (const bet of betsWithoutResults) {
      const result = eventResults.get(bet.event_id);

      if (!result) {
        continue; // Skip if event hasn't ended or result unavailable
      }

      const betResult = calculateBetResult(
        bet.selected_team_id,
        bet.home_team_id,
        bet.away_team_id,
        result.homeScore,
        result.awayScore
      );

      if (betResult === null) {
        continue; // Can't determine result
      }

      const { error: updateError } = await supabase.from("bets").update({ result: betResult }).eq("id", bet.id);

      if (updateError) {
        console.error(`Error updating bet ${bet.id}:`, updateError.message);
      } else {
        updatedCount++;
      }
    }

    console.log(`Updated ${updatedCount} bets with results`);
  } catch (error) {
    console.error("Error syncing event results:", error);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log("Starting daily sync job...");
  console.log(`Date: ${new Date().toISOString()}`);

  try {
    // Step 1: Sync upcoming events
    await syncUpcomingEvents();

    // Step 2: Sync event results
    await syncEventResults();

    console.log("\nDaily sync completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\nDaily sync failed:", error);
    process.exit(1);
  }
}

// Run the script
main();
