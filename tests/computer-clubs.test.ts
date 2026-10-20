import { describe, expect, it } from "vitest";
import { isClientEnvelope, NETWORK_CONFIG, PROTOCOL_VERSION } from "../network/MessageProtocol";
import { DEFAULT_TEAM_NAMES, getTeamIdentities, getTeamIdentity, isTeamName, normalizeTeamName, TEAM_NAME_MAX_LENGTH } from "../shared/teamIdentity";
import { INITIAL_MATCH } from "../shared/types";
import { now, session } from "./helpers/seatSession";

describe("fixed team identities and custom names", () => {
  it("uses red and blue kits for every human and computer seat, with no club choice", () => {
    const { manager, join, start, callbacks } = session();
    const captain = join("red", "attack");
    expect(manager.state.teamNames).toEqual(DEFAULT_TEAM_NAMES);
    expect(manager.state.players.some(player => player.computer && player.team === "red")).toBe(true);
    expect(manager.state.players.every(player => !player.clubId && !("randomClub" in player))).toBe(true);
    expect(manager.handle(captain.playerId, { type: "team-name", name: "  Sofaens mestre  " }, now).ok).toBe(true);
    expect(start(captain).ok).toBe(true);
    expect(callbacks.onStart.mock.lastCall?.[1]).toEqual(getTeamIdentities({ red: "Sofaens mestre" }));
    const teams = callbacks.onStart.mock.lastCall![1];
    expect(teams.red).toMatchObject({ id: "red", primaryColor: "#d9473f", secondaryColor: "#f1e9d7" });
    expect(teams.blue).toMatchObject({ id: "blue", name: "Blå", primaryColor: "#4383bb", secondaryColor: "#e6ddc6" });
    expect(teams.red.logo).toBeUndefined();
  });

  it("preserves custom names and fixed colors through computer settings, rematch and a new setup", () => {
    const { manager, join, start, callbacks } = session();
    const captain = join("blue");
    manager.handle(captain.playerId, { type: "team-name", name: "Blå lyn" }, now);
    manager.handle(captain.playerId, { type: "set-computer-level", team: "red", role: "attack", level: "advanced" }, now);
    expect(start(captain).ok).toBe(true);
    const firstTeams = callbacks.onStart.mock.lastCall?.[1];
    manager.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "finished", winner: "blue" });
    expect(manager.handle(captain.playerId, { type: "rematch" }, now).ok).toBe(true);
    expect(callbacks.onStart.mock.lastCall?.[1]).toEqual(firstTeams);
    manager.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "finished", winner: "blue" });
    expect(manager.handle(captain.playerId, { type: "new-match" }, now).ok).toBe(true);
    expect(manager.state.match.phase).toBe("lobby");
    expect(manager.state.teamNames).toEqual({ red: "Rød", blue: "Blå lyn" });
    expect(manager.handle(captain.playerId, { type: "team-name", name: "Nyt navn" }, now).ok).toBe(true);
    start(captain);
    expect(callbacks.onStart.mock.lastCall?.[1].blue).toEqual(getTeamIdentity("blue", "Nyt navn"));
  });

  it("keeps names on their side and lets only each side's captain change them", () => {
    const { manager, join } = session();
    const first = join("red"), second = join("red", "attack"), blue = join("blue");
    manager.handle(first.playerId, { type: "team-name", name: "Røde ræve" }, now);
    expect(manager.handle(second.playerId, { type: "team-name", name: "Forkert" }, now).code).toBe("captain-only");
    manager.handle(blue.playerId, { type: "team-name", name: "Blå bjørne" }, now);
    expect(manager.state.teamNames).toEqual({ red: "Røde ræve", blue: "Blå bjørne" });
    expect(manager.state.players.filter(player => player.team === "red" && !player.computer).map(player => player.teamCaptain)).toEqual([true, false]);
    const detached = manager.state;
    detached.teamNames.red = "Muteret";
    expect(manager.state.teamNames.red).toBe("Røde ræve");
  });

  it("retains a captain while changing its own rods and transfers it after changing sides", () => {
    const { manager, join } = session();
    const earlyPhone = join(), captain = join("red"), blue = join("blue");
    manager.handle(earlyPhone.playerId, { type: "reserve-seat", team: "red", role: "attack" }, now);
    manager.handle(captain.playerId, { type: "team-name", name: "Røde ræve" }, now);
    expect(manager.handle(captain.playerId, { type: "reserve-seat", team: "blue", role: "attack" }, now).ok).toBe(true);
    expect(manager.state.players.find(player => player.id === earlyPhone.playerId)?.teamCaptain).toBe(true);
    expect(manager.state.players.find(player => player.id === captain.playerId)?.teamCaptain).toBe(false);
    expect(manager.state.players.find(player => player.id === blue.playerId)?.teamCaptain).toBe(true);
    expect(manager.handle(captain.playerId, { type: "team-name", name: "Kan ikke overtage" }, now).code).toBe("captain-only");
    expect(manager.handle(earlyPhone.playerId, { type: "team-name", name: "Nye røde" }, now).ok).toBe(true);
    expect(manager.state.teamNames).toEqual({ red: "Nye røde", blue: "Blå" });
    manager.handle(blue.playerId, { type: "reserve-seat", team: "blue", role: "defense" }, now);
    expect(manager.state.players.find(player => player.id === captain.playerId)?.teamCaptain).toBe(true);
    expect(manager.handle(captain.playerId, { type: "team-name", name: "Nye blå" }, now).ok).toBe(true);
  });

  it("keeps captain rights and names during a reconnect reservation, then transfers after expiry", () => {
    const { manager, join } = session();
    const earlierPhone = join(), captain = join("red");
    manager.handle(earlierPhone.playerId, { type: "reserve-seat", team: "red", role: "attack" }, now);
    manager.handle(captain.playerId, { type: "team-name", name: "Røde ræve" }, now);
    manager.disconnect(captain.playerId, now + 1);
    expect(manager.handle(earlierPhone.playerId, { type: "team-name", name: "For tidligt" }, now + 2).code).toBe("captain-only");
    expect(manager.admit(captain.token, now + 3)).toMatchObject({ reconnected: true });
    expect(manager.state.players.find(player => player.id === captain.playerId)?.teamCaptain).toBe(true);
    expect(manager.state.teamNames.red).toBe("Røde ræve");
    manager.disconnect(captain.playerId, now + 4);
    const expiry = now + 4 + NETWORK_CONFIG.lobbyReservationTimeout;
    manager.touch(earlierPhone.playerId, expiry);
    manager.expire(expiry);
    expect(manager.state.players.some(player => player.id === captain.playerId)).toBe(false);
    expect(manager.state.players.find(player => player.id === earlierPhone.playerId)?.teamCaptain).toBe(true);
    expect(manager.state.teamNames.red).toBe("Røde ræve");
    expect(manager.admit(captain.token, expiry + 1)).toMatchObject({ code: "invalid-token" });
    expect(manager.handle(earlierPhone.playerId, { type: "team-name", name: "Efterfølgeren" }, expiry + 1).ok).toBe(true);
  });

  it("re-elects by team selection rather than phone admission after a captain leaves", () => {
    const { manager, join } = session();
    const firstPhone = join(), secondPhone = join(), thirdPhone = join("red");
    manager.handle(secondPhone.playerId, { type: "reserve-seat", team: "red", role: "attack" }, now);
    manager.handle(thirdPhone.playerId, { type: "reserve-seat", team: "red", role: "defense" }, now);
    manager.handle(firstPhone.playerId, { type: "reserve-seat", team: "red", role: "defense" }, now);
    expect(manager.state.players.find(player => player.id === secondPhone.playerId)?.teamCaptain).toBe(true);
    expect(manager.state.players.find(player => player.id === firstPhone.playerId)?.teamCaptain).toBe(false);
  });

  it("accepts 25 Unicode codepoints, normalizes names and rejects oversized or forged updates on the server", () => {
    const { manager, join, start } = session();
    const captain = join("red");
    const maximum = "⚽".repeat(TEAM_NAME_MAX_LENGTH);
    expect(manager.handle(captain.playerId, { type: "team-name", name: maximum }, now).ok).toBe(true);
    expect(manager.state.teamNames.red).toBe(maximum);
    const emoji = "😀".repeat(TEAM_NAME_MAX_LENGTH);
    expect(emoji.length).toBe(50);
    expect(manager.handle(captain.playerId, { type: "team-name", name: emoji }, now).ok).toBe(true);
    for (const message of [
      { type: "team-name", name: `${emoji}x` },
      { type: "team-name", name: "x".repeat(26) },
      { type: "team-name", name: "Navn\nmed linje" },
      { type: "team-name", name: null },
      { type: "team-name", name: "Andet hold", team: "blue" },
      { type: "team-name", name: "Farver", primaryColor: "#000000" },
      { type: "select-club", clubId: "arsenal" },
      { type: "new-club" },
    ]) expect(manager.handle(captain.playerId, message, now).code).toBe("invalid-message");
    expect(manager.state.teamNames.red).toBe(emoji);
    expect(manager.handle(captain.playerId, { type: "team-name", name: "  Cafe\u0301  " }, now).ok).toBe(true);
    expect(manager.state.teamNames.red).toBe("Café");
    manager.handle(captain.playerId, { type: "team-name", name: " " }, now);
    expect(manager.state.teamNames.red).toBe("Rød");
    start(captain);
    expect(manager.handle(captain.playerId, { type: "team-name", name: "For sent" }, now).code).toBe("locked");
  });

  it("centralizes detached identities and Unicode name validation", () => {
    expect(PROTOCOL_VERSION).toBe(3);
    expect(isClientEnvelope({ type: "hello", version: 2 })).toBe(false);
    expect(isClientEnvelope({ type: "hello", version: 3 })).toBe(true);
    expect(isTeamName("😀".repeat(25))).toBe(true);
    expect(isTeamName("😀".repeat(26))).toBe(false);
    expect(isTeamName("A\u0000B")).toBe(false);
    expect(normalizeTeamName("  Cafe\u0301  ")).toBe("Café");
    const identity = getTeamIdentity("red", "Sofaens mestre");
    identity.primaryColor = "#000000";
    expect(getTeamIdentity("red").primaryColor).toBe("#d9473f");
  });
});
