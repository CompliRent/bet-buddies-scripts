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
import { get24HoursFromDate, getEndOfCurrentNFLWeek } from "./date-utils";
import dotenv from "dotenv";
dotenv.config();

type Scores = {
  homeScore: number;
  awayScore: number;
};

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
 * Fetch upcoming events from Sports Odds API
 * Only returns events that don't start today
 */
async function fetchUpcomingEvents(): Promise<Event[]> {
  console.log("Fetching events from Sports Odds API...");

  try {
    const startsAfter = get24HoursFromDate();
    const startsBefore = getEndOfCurrentNFLWeek();

    console.log(`Fetching events from ${startsAfter} to ${startsBefore}`);

    // Fetch events with a higher limit to get more data
    // Request moneyline, spread, and over/under odds
    const response = await sportsClient.events.get({
      leagueID: "NFL",
      oddsAvailable: true,
      oddID:
        "points-home-game-ml-home,points-away-game-ml-away,points-home-game-sp-home,points-away-game-sp-away,points-all-game-ou-over,points-all-game-ou-under",
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
      home_spread_value: number | null;
      home_spread_odds: number | null;
      away_spread_odds: number | null;
      ou_value: number | null;
      ou_over_odds: number | null;
      ou_under_odds: number | null;
    }
  | undefined {
  // Extract moneyline odds
  let homeMoneyline: number | null = null;
  let awayMoneyline: number | null = null;

  // Extract spread odds
  let homeSpreadValue: number | null = null;
  let homeSpreadOdds: number | null = null;
  let awaySpreadOdds: number | null = null;

  // Extract over/under odds
  let ouValue: number | null = null;
  let ouOverOdds: number | null = null;
  let ouUnderOdds: number | null = null;

  if (event.odds && typeof event.odds === "object") {
    for (const [oddID, odd] of Object.entries(event.odds)) {
      // Moneyline odds
      if (oddID === "points-home-game-ml-home" && odd.bookOdds) {
        homeMoneyline = Number(odd.bookOdds);
      }
      if (oddID === "points-away-game-ml-away" && odd.bookOdds) {
        awayMoneyline = Number(odd.bookOdds);
      }

      // Spread odds
      if (oddID === "points-home-game-sp-home" && odd.bookOdds) {
        homeSpreadOdds = Number(odd.bookOdds);
        homeSpreadValue = Number(odd.bookSpread);
      }
      if (oddID === "points-away-game-sp-away" && odd.bookOdds) {
        awaySpreadOdds = Number(odd.bookOdds);
      }

      // Over/under odds
      if (oddID === "points-all-game-ou-over" && odd.bookOdds) {
        ouOverOdds = Number(odd.bookOdds);
        ouValue = Number(odd.bookOverUnder);
      }
      if (oddID === "points-all-game-ou-under" && odd.bookOdds) {
        ouUnderOdds = Number(odd.bookOdds);
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
    home_spread_value: homeSpreadValue,
    home_spread_odds: homeSpreadOdds,
    away_spread_odds: awaySpreadOdds,
    ou_value: ouValue,
    ou_over_odds: ouOverOdds,
    ou_under_odds: ouUnderOdds,
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
    // Clear existing table
    console.log("Clearing existing upcoming_events...");
    const { error: deleteError } = await supabase.from("upcoming_events").delete().neq("event_id", ""); // Delete all rows

    if (deleteError) {
      throw new Error(`Failed to clear upcoming_events: ${deleteError.message}`);
    }
    console.log("Cleared upcoming_events table");

    // Fetch upcoming events
    const events = await fetchUpcomingEvents();

    if (events.length === 0) {
      console.log("No upcoming events found, skipping sync");
      return;
    }

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

      // can't use !! because 0 is a valid score
      if (homeScore != null && awayScore != null && ended) {
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
 * Determine if a bet won based on bet type, selection, and scores
 * Treats pushes (ties) as losses
 */
function calculateBetResult(
  betType: string,
  selection: string,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  spreadValue: number | null,
  totalValue: number | null
): boolean | null {
  if (betType === "moneyline") {
    const selectedHome = selection === homeTeamId;
    const selectedAway = selection === awayTeamId;

    if (selectedHome) {
      return homeScore > awayScore;
    } else if (selectedAway) {
      return awayScore > homeScore;
    }

    return null; // Invalid team selection
  } else if (betType === "spread") {
    if (!spreadValue) {
      return null; // Missing spread value
    }

    const selectedHome = selection === homeTeamId;
    const selectedAway = selection === awayTeamId;

    if (selectedHome) {
      // Home team bet: apply spread to home score
      // If spreadValue is -3, home needs to win by more than 3
      // homeScore + spreadValue > awayScore
      const homeScoreWithSpread = homeScore + spreadValue;
      // If homeScoreWithSpread > awayScore, bet wins
      // If equal, it's a push (treated as loss)
      return homeScoreWithSpread > awayScore;
    } else if (selectedAway) {
      const awayScoreWithSpread = awayScore - spreadValue;
      // If awayScoreWithSpread > homeScore, bet wins
      // If equal, it's a push (treated as loss)
      return awayScoreWithSpread > homeScore;
    }

    return null; // Invalid team selection
  } else if (betType === "over_under") {
    if (!totalValue) {
      return null; // Missing total value
    }

    const totalScore = homeScore + awayScore;
    const selectedOver = selection === "over";
    const selectedUnder = selection === "under";

    if (selectedOver) {
      // Over wins if total > totalValue, loses if equal (push) or less
      return totalScore > totalValue;
    } else if (selectedUnder) {
      // Under wins if total < totalValue, loses if equal (push) or more
      return totalScore < totalValue;
    }

    return null; // Invalid selection (should be "over" or "under")
  }

  return null; // Unknown bet type
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
        bet.bet_type,
        bet.selection,
        bet.home_team_id,
        bet.away_team_id,
        result.homeScore,
        result.awayScore,
        bet.spread_value,
        bet.total_value
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
