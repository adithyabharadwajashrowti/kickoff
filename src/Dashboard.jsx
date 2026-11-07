
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import SecureAccount from "./SecureAccount";
import "./App.css";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "community", label: "Potato FC", icon: "🥔" },
  { id: "games", label: "Find a game", icon: "⚽" },
  { id: "my-games", label: "My games", icon: "▣" },
  { id: "turfs", label: "Find a turf", icon: "⌖" },
  { id: "profile", label: "My profile", icon: "◉" },
];

const POTATO_NEIGHBORHOODS = [
  "Koramangala",
  "HSR Layout",
  "BTM Layout",
  "JP Nagar",
  "Jayanagar",
  "Banashankari",
  "Electronic City",
  "Sarjapur Road",
  "Kumaraswamy Layout",
  "Nearby South Bengaluru",
];

function localDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Weekly templates always point to the next calendar week (Mon–Sun).
function nextWeekdayISO(offsetFromMonday) {
  const now = new Date();
  const daysUntilNextMonday = ((8 - now.getDay()) % 7) || 7;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  monday.setDate(monday.getDate() + daysUntilNextMonday);
  monday.setDate(monday.getDate() + offsetFromMonday);

  return localDateISO(monday);
}

const WEEKLY_RUNS = [
  {
    id: "wed-verve-5v5",
    day: "Wednesday",
    date: nextWeekdayISO(2),
    title: "Potato FC · Wednesday 5v5",
    venueName: "Verve Play",
    format: "5-a-side",
    formatLabel: "5v5",
    maxPlayers: 10,
    playoUrl: "https://go.playo.app/PLAYOO/G1jN7",
    accent: "lime",
  },
  {
    id: "thu-play-matrix-9v9",
    day: "Thursday",
    date: nextWeekdayISO(3),
    title: "Potato FC · Thursday 9v9",
    venueName: "Play Matrix",
    format: "9-a-side",
    formatLabel: "9v9",
    maxPlayers: 18,
    playoUrl: "https://go.playo.app/PLAYOO/WytL8",
    accent: "gold",
  },
  {
    id: "fri-verve-5v5",
    day: "Friday",
    date: nextWeekdayISO(4),
    title: "Potato FC · Friday 5v5",
    venueName: "Verve Play",
    format: "5-a-side",
    formatLabel: "5v5",
    maxPlayers: 10,
    playoUrl: "https://go.playo.app/PLAYOO/9PmLf",
    accent: "blue",
  },
  {
    id: "sun-verve-5v5",
    day: "Sunday",
    date: nextWeekdayISO(6),
    title: "Potato FC · Sunday 5v5",
    venueName: "Verve Play",
    format: "5-a-side",
    formatLabel: "5v5",
    maxPlayers: 10,
    playoUrl: "https://go.playo.app/PLAYOO/EJWnc",
    accent: "violet",
  },
];

const SKILL_LEVELS = [
  "Beginner",
  "Intermediate",
  "Amateur",
  "Professional",
];

const POSITIONS = [
  "Goalkeeper",
  "Defender",
  "Midfielder",
  "Forward",
  "Flexible / Any",
];

export default function Dashboard({ user, onLogout }) {
  const [page, setPage] = useState("home");

  const [games, setGames] = useState([]);
  const [venues, setVenues] = useState([]);
  const [participantCounts, setParticipantCounts] = useState({});
  const [myGameIds, setMyGameIds] = useState([]);
  const [gameRoster, setGameRoster] = useState({});
  const [paymentRequests, setPaymentRequests] = useState([]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All games");

  const [showForm, setShowForm] = useState(false);
  const [gameDraftTemplate, setGameDraftTemplate] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [joiningGameId, setJoiningGameId] = useState(null);
  const [reviewingRequestId, setReviewingRequestId] = useState(null);
  const [cancellingGameId, setCancellingGameId] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [paymentGame, setPaymentGame] = useState(null);
  const [freeJoinGame, setFreeJoinGame] = useState(null);
  const [selectedMatchSkillLevel, setSelectedMatchSkillLevel] =
    useState("Beginner");
  const [paymentSlots, setPaymentSlots] = useState(1);
  const [upiReference, setUpiReference] = useState("");

  const [clock, setClock] = useState(Date.now());

  const [playerProfile, setPlayerProfile] = useState({
    full_name:
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "",
    skill_level: "",
    primary_position: "",
    secondary_position: "",
    preferred_foot: "Right",
    jersey_number: "",
    bio: "",
  });

  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Guest accounts cannot be recovered after logout, so they cannot host games.
  const isGuestAccount = Boolean(user.is_anonymous);

  const authFallbackName =
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "";

  const displayName =
    playerProfile.full_name?.trim() ||
    authFallbackName ||
    "Player";

  const profileComplete = Boolean(
    profileLoaded &&
    profileSaved &&
    playerProfile.full_name?.trim() &&
    playerProfile.skill_level &&
    playerProfile.primary_position
  );

  const initials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  // ------------------------------------------------------------
  // LOAD DASHBOARD DATA
  // ------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const now = new Date().toISOString();

      const [
        gamesResult,
        venuesResult,
        membershipsResult,
        requestsResult,
        profileResult,
      ] = await Promise.all([
        supabase
          .from("games")
          .select("*")
          .eq("status", "open")
          .is("cancelled_at", null)
          .gte("ends_at", now)
          .order("starts_at", { ascending: true }),

        supabase
          .from("venues")
          .select("id, name, city, address")
          .eq("status", "active")
          .order("name"),

        supabase
          .from("game_participants")
          .select("game_id, status")
          .eq("player_id", user.id)
          .eq("status", "joined"),

        supabase
          .from("game_payment_requests")
          .select(
            "id, game_id, player_id, amount_paise, slots_count, match_skill_level, upi_reference, status, created_at, review_note"
          )
          .order("created_at", { ascending: false })
          .limit(200),

        supabase
          .from("profiles")
          .select(
            "id, full_name, skill_level, primary_position, secondary_position, preferred_foot, jersey_number, bio"
          )
          .eq("id", user.id)
          .maybeSingle(),
      ]);

      if (gamesResult.error) throw gamesResult.error;
      if (venuesResult.error) throw venuesResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      if (requestsResult.error) throw requestsResult.error;
      if (profileResult.error) throw profileResult.error;

      // Player profile
      const loadedProfile = profileResult.data;

      if (loadedProfile) {
        setPlayerProfile({
          full_name: loadedProfile.full_name || "",
          skill_level: loadedProfile.skill_level || "",
          primary_position: loadedProfile.primary_position || "",
          secondary_position: loadedProfile.secondary_position || "",
          preferred_foot: loadedProfile.preferred_foot || "Right",
          jersey_number: loadedProfile.jersey_number ?? "",
          bio: loadedProfile.bio || "",
        });

        setProfileSaved(true);
      } else {
        setPlayerProfile({
          full_name: authFallbackName,
          skill_level: "",
          primary_position: "",
          secondary_position: "",
          preferred_foot: "Right",
          jersey_number: "",
          bio: "",
        });

        setProfileSaved(false);
      }

      setProfileLoaded(true);

      const loadedGames = gamesResult.data || [];

      setGames(loadedGames);
      setVenues(venuesResult.data || []);

      setMyGameIds(
        (membershipsResult.data || []).map((item) => item.game_id)
      );

      // Load names for players who have submitted payment requests.
      const rawPaymentRequests = requestsResult.data || [];

      const requestPlayerIds = [
        ...new Set(
          rawPaymentRequests
            .map((request) => request.player_id)
            .filter(Boolean)
        ),
      ];

      let requestProfilesById = {};

      if (requestPlayerIds.length > 0) {
        const {
          data: requestProfiles,
          error: requestProfilesError,
        } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", requestPlayerIds);

        if (requestProfilesError) throw requestProfilesError;

        requestProfilesById = Object.fromEntries(
          (requestProfiles || []).map((profile) => [
            profile.id,
            profile,
          ])
        );
      }

      setPaymentRequests(
        rawPaymentRequests.map((request) => ({
          ...request,
          player_name:
            requestProfilesById[request.player_id]?.full_name || null,
        }))
      );

      // Load confirmed participants and their stored team assignments.
      if (loadedGames.length > 0) {
        const {
          data: participants,
          error: participantError,
        } = await supabase
          .from("game_participants")
          .select(
            "game_id, player_id, status, slots_count, match_skill_level, team_color"
          )
          .in(
            "game_id",
            loadedGames.map((game) => game.id)
          )
          .eq("status", "joined");

        if (participantError) throw participantError;

        const participantRows = participants || [];
        const counts = {};

        for (const participant of participantRows) {
          counts[participant.game_id] =
            (counts[participant.game_id] || 0) +
            Number(participant.slots_count || 1);
        }

        setParticipantCounts(counts);

        const profileIds = [
          ...new Set(
            participantRows
              .map((row) => row.player_id)
              .filter(Boolean)
          ),
        ];

        if (profileIds.length > 0) {
          const { data: profileRows, error: rosterError } =
            await supabase
              .from("profiles")
              .select(
                "id, full_name, skill_level, primary_position, secondary_position"
              )
              .in("id", profileIds);

          if (rosterError) throw rosterError;

          const profilesById = Object.fromEntries(
            (profileRows || []).map((profile) => [
              profile.id,
              profile,
            ])
          );

          const roster = {};

          for (const participant of participantRows) {
            const profile = profilesById[participant.player_id];

            if (!roster[participant.game_id]) {
              roster[participant.game_id] = [];
            }

            roster[participant.game_id].push({
              id: participant.player_id,
              full_name: profile?.full_name || "Player",
              skill_level:
                participant.match_skill_level ||
                profile?.skill_level ||
                "Profile pending",
              match_skill_level:
                participant.match_skill_level ||
                profile?.skill_level ||
                "Beginner",
              primary_position:
                profile?.primary_position || "Position pending",
              secondary_position:
                profile?.secondary_position || "",
              team_color: participant.team_color || null,
              slots_count: Number(participant.slots_count || 1),
            });
          }

          setGameRoster(roster);
        } else {
          setGameRoster({});
        }
      } else {
        setParticipantCounts({});
        setGameRoster({});
      }
    } catch (err) {
      console.error("KICKOFF data loading error:", err);
      setError(
        err.message || "We couldn't load the latest information."
      );
    } finally {
      setLoading(false);
    }
  }, [user.id, authFallbackName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Remove expired or cancelled games from the visible dashboard.
  useEffect(() => {
    const expiryTimer = window.setInterval(() => {
      const nowMs = Date.now();

      setClock(nowMs);

      setGames((currentGames) =>
        currentGames.filter((game) => {
          if (game.cancelled_at) return false;

          const endMs = new Date(game.ends_at).getTime();

          // Don't silently remove a game with a missing or invalid end date.
          return !Number.isFinite(endMs) || endMs > nowMs;
        })
      );
    }, 15000);

    return () => window.clearInterval(expiryTimer);
  }, []);

  // ------------------------------------------------------------
  // DERIVED DATA / HELPERS
  // ------------------------------------------------------------

  const venueFor = (game) =>
    venues.find((venue) => venue.id === game.venue_id) ||
    (game.venue_name
      ? { name: game.venue_name, city: "", address: "" }
      : null);

  const myGames = useMemo(
    () =>
      games.filter(
        (game) =>
          myGameIds.includes(game.id) ||
          game.organiser_id === user.id
      ),
    [games, myGameIds, user.id]
  );

  const visibleGames = useMemo(
    () =>
      games.filter((game) => {
        const venue = venueFor(game);

        const text =
          `${game.title} ${venue?.name || ""} ${
            venue?.city || ""
          } ${game.format || ""}`.toLowerCase();

        const matchesSearch = text.includes(search.toLowerCase());
        const count = participantCounts[game.id] || 0;

        const matchesFilter =
          filter === "All games" ||
          (filter === "Spots available" &&
            count < game.max_players) ||
          (filter === "My games" &&
            myGameIds.includes(game.id)) ||
          (filter === "Organised by me" &&
            game.organiser_id === user.id);

        return matchesSearch && matchesFilter;
      }),
    [
      games,
      venues,
      search,
      filter,
      participantCounts,
      myGameIds,
      user.id,
    ]
  );

  function displayDate(value, options = {}) {
    return new Date(value).toLocaleDateString("en-IN", {
      weekday: options.weekday || "short",
      day: "numeric",
      month: "short",
      ...(options.year ? { year: "numeric" } : {}),
    });
  }

  function displayTime(value) {
    return new Date(value).toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // One logout handler is shared by sidebar, mobile header and profile.
  async function handleLogout() {
    if (typeof onLogout !== "function") {
      setError(
        "Logout is not configured. Please refresh and try again."
      );
      return;
    }

    if (
      isGuestAccount &&
      !window.confirm(
        "You're on a guest account. If you log out, you can never get back into it, and your profile and games stay on the old account. Log out anyway?"
      )
    ) {
      return;
    }

    setLoggingOut(true);
    setError("");
    setNotice("");

    try {
      await onLogout();
    } catch (err) {
      console.error("KICKOFF logout error:", err);
      setError(
        err?.message || "Unable to log out. Please try again."
      );
    } finally {
      setLoggingOut(false);
    }
  }

  // ------------------------------------------------------------
  // CREATE GAME
  // ------------------------------------------------------------

  function openCreateGame() {
    if (isGuestAccount) {
      setShowForm(false);
      setPage("profile");
      setError("");
      setNotice(
        "To host games, secure your account with an email and password first (see below)."
      );
      return false;
    }

    setShowForm(true);
    return true;
  }

  async function createGame(event) {
    event.preventDefault();

    if (isGuestAccount) {
      openCreateGame();
      return;
    }

    if (!profileComplete) {
      setPage("profile");
      setNotice(
        "Complete your player card first, then publish your match."
      );
      setError("");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const form = new FormData(event.currentTarget);

      const start = new Date(
        `${form.get("date")}T${form.get("time")}:00`
      );

      const duration = Number(form.get("duration"));
      const priceRupees = Number(form.get("price"));
      const maxPlayers = Number(form.get("total"));

      if (
        !Number.isFinite(start.getTime()) ||
        start.getTime() <= Date.now()
      ) {
        throw new Error("Choose a future date and kick-off time.");
      }

      if (
        !Number.isSafeInteger(priceRupees) ||
        priceRupees < 0 ||
        priceRupees > 100000
      ) {
        throw new Error("Enter a valid price in whole rupees.");
      }

      if (
        !Number.isInteger(maxPlayers) ||
        maxPlayers < 2 ||
        maxPlayers > 50
      ) {
        throw new Error(
          "Player capacity must be between 2 and 50."
        );
      }

      const title = String(form.get("title") || "").trim();
      const venueName = String(form.get("venue_name") || "").trim();
      const hostUpiId = String(
        form.get("host_upi_id") || ""
      ).trim();

      if (!title) {
        throw new Error("Enter a name for your game.");
      }

      if (!venueName) {
        throw new Error("Enter the venue name.");
      }

      if (priceRupees > 0 && !hostUpiId) {
        throw new Error(
          "Enter the host UPI ID for a paid game."
        );
      }

      if (hostUpiId.length > 100) {
        throw new Error(
          "The host UPI ID must be 100 characters or fewer."
        );
      }

      const { data, error: createError } = await supabase
        .from("games")
        .insert({
          organiser_id: user.id,
          venue_id: null,
          venue_name: venueName,
          host_upi_id: priceRupees > 0 ? hostUpiId : null,
          title,
          starts_at: start.toISOString(),
          ends_at: new Date(
            start.getTime() + duration * 60000
          ).toISOString(),
          format: form.get("format"),
          price_per_player_paise: priceRupees * 100,
          max_players: maxPlayers,
          status: "open",
        })
        .select()
        .single();

      if (createError) throw createError;

      // Add the organiser as the first participant.
      const { error: participantError } = await supabase
        .from("game_participants")
        .insert({
          game_id: data.id,
          player_id: user.id,
          status: "joined",
          slots_count: 1,
          match_skill_level:
            playerProfile.skill_level || "Beginner",
        });

      if (participantError) {
        console.error(
          "Organizer participant entry failed:",
          participantError
        );

        setNotice(
          "Game created, but your organiser entry could not be saved."
        );
      } else {
        setNotice(
          "Your game is live. Get your squad together! ⚽"
        );
      }

      setShowForm(false);
      setGameDraftTemplate(null);
      setPage("games");
      setFilter("All games");
      setSearch("");

      await loadData();
    } catch (err) {
      console.error("KICKOFF create-game error:", err);
      setError(
        err.message || "We couldn't create your game."
      );
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------------------------
  // PLAYER PROFILE
  // ------------------------------------------------------------

  async function savePlayerProfile(event) {
    event.preventDefault();

    setProfileSaving(true);
    setError("");
    setNotice("");

    try {
      const form = new FormData(event.currentTarget);

      const fullName = String(
        form.get("full_name") || ""
      ).trim();

      const skillLevel = String(
        form.get("skill_level") || ""
      );

      const primaryPosition = String(
        form.get("primary_position") || ""
      );

      const secondaryPosition = String(
        form.get("secondary_position") || ""
      );

      const preferredFoot = String(
        form.get("preferred_foot") || "Right"
      );

      const jerseyRaw = String(
        form.get("jersey_number") || ""
      ).trim();

      const bio = String(form.get("bio") || "").trim();

      if (fullName.length < 2 || fullName.length > 60) {
        throw new Error(
          "Enter your name using 2–60 characters."
        );
      }

      if (!SKILL_LEVELS.includes(skillLevel)) {
        throw new Error("Choose your current playing level.");
      }

      if (!POSITIONS.includes(primaryPosition)) {
        throw new Error("Choose your main playing position.");
      }

      const jerseyNumber = jerseyRaw ? Number(jerseyRaw) : null;

      if (
        jerseyNumber !== null &&
        (!Number.isInteger(jerseyNumber) ||
          jerseyNumber < 0 ||
          jerseyNumber > 99)
      ) {
        throw new Error(
          "Jersey number must be between 0 and 99."
        );
      }

      if (bio.length > 240) {
        throw new Error(
          "Keep your player intro under 240 characters."
        );
      }

      const payload = {
        id: user.id,
        full_name: fullName,
        display_name: fullName,
        skill_level: skillLevel,
        primary_position: primaryPosition,
        secondary_position: secondaryPosition || null,
        preferred_foot: preferredFoot,
        jersey_number: jerseyNumber,
        bio: bio || null,
        updated_at: new Date().toISOString(),
      };

      const { data, error: profileError } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" })
        .select(
          "id, full_name, skill_level, primary_position, secondary_position, preferred_foot, jersey_number, bio"
        )
        .single();

      if (profileError) throw profileError;

      setPlayerProfile({
        full_name: data.full_name,
        skill_level: data.skill_level,
        primary_position: data.primary_position,
        secondary_position: data.secondary_position || "",
        preferred_foot: data.preferred_foot || "Right",
        jersey_number: data.jersey_number ?? "",
        bio: data.bio || "",
      });

      setProfileLoaded(true);
      setProfileSaved(true);
      setNotice(
        "Player card saved. You’re ready to join the squad. ⚽"
      );

      await loadData();
    } catch (err) {
      console.error("KICKOFF profile save error:", err);
      setError(
        err.message || "Couldn't save your player card."
      );
    } finally {
      setProfileSaving(false);
    }
  }

  // ------------------------------------------------------------
  // JOIN / PAYMENT FLOWS
  // ------------------------------------------------------------

  async function joinGame(game) {
    setNotice("");
    setError("");

    if (game.organiser_id === user.id) {
      setNotice("You're the organiser of this game.");
      return;
    }

    if (myGameIds.includes(game.id)) {
      setNotice(
        "You're already listed as a participant in this game."
      );
      return;
    }

    if (!profileComplete) {
      setPage("profile");
      setNotice(
        "Finish your player card — name, skill level and position are needed to join."
      );
      setError("");
      return;
    }

    if (
      (participantCounts[game.id] || 0) >= game.max_players
    ) {
      setError("This game is full.");
      return;
    }

    if (Number(game.price_per_player_paise || 0) > 0) {
      if (!game.host_upi_id || !game.host_upi_id.trim()) {
        setError(
          "The host has not added a UPI ID for this paid game yet."
        );
        return;
      }

      setPaymentGame(game);
      setPaymentSlots(1);
      setSelectedMatchSkillLevel(
        playerProfile.skill_level || "Beginner"
      );
      setUpiReference("");
      return;
    }

    setSelectedMatchSkillLevel(
      playerProfile.skill_level || "Beginner"
    );

    setFreeJoinGame(game);
  }

  async function confirmFreeJoin(event) {
    event.preventDefault();

    if (!freeJoinGame) return;

    if (!SKILL_LEVELS.includes(selectedMatchSkillLevel)) {
      setError("Choose your playing level for this match.");
      return;
    }

    setJoiningGameId(freeJoinGame.id);
    setError("");
    setNotice("");

    try {
      const { error: joinError } = await supabase.rpc(
        "join_game_with_level",
        {
          p_game_id: freeJoinGame.id,
          p_skill_level: selectedMatchSkillLevel,
        }
      );

      if (joinError) throw joinError;

      const joinedTitle = freeJoinGame.title;

      setFreeJoinGame(null);

      await loadData();

      setNotice(
        `You're in for ${joinedTitle}! Potato FC will balance the Black and White teams automatically.`
      );
    } catch (err) {
      console.error("KICKOFF join-game error:", err);
      setError(
        err.message || "Couldn't join this game. Please try again."
      );

      await loadData();
    } finally {
      setJoiningGameId(null);
    }
  }

  async function submitPaymentRequest(event) {
    event.preventDefault();

    if (!paymentGame) return;

    setJoiningGameId(paymentGame.id);
    setError("");
    setNotice("");

    try {
      const slotCount = Number(paymentSlots);

      if (
        !Number.isInteger(slotCount) ||
        slotCount < 1 ||
        slotCount > 50
      ) {
        throw new Error(
          "Choose a valid number of slots (1–50)."
        );
      }

      const reference = upiReference.trim();

      if (reference.length < 4 || reference.length > 100) {
        throw new Error(
          "Enter the UPI transaction reference (4–100 characters)."
        );
      }

      const remaining =
        Number(paymentGame.max_players) -
        (participantCounts[paymentGame.id] || 0);

      if (slotCount > remaining) {
        throw new Error(
          `Only ${Math.max(remaining, 0)} slot(s) currently remain.`
        );
      }

      if (!SKILL_LEVELS.includes(selectedMatchSkillLevel)) {
        throw new Error(
          "Choose your playing level for this match."
        );
      }

      const { error: submitError } = await supabase.rpc(
        "submit_game_payment",
        {
          p_game_id: paymentGame.id,
          p_upi_reference: reference,
          p_slots_count: slotCount,
          p_skill_level: selectedMatchSkillLevel,
        }
      );

      if (submitError) throw submitError;

      setPaymentGame(null);
      setPaymentSlots(1);
      setUpiReference("");

      setNotice(
        `Payment request submitted as ${selectedMatchSkillLevel}. The host must verify the payment before approving your slots.`
      );

      await loadData();
    } catch (err) {
      console.error("KICKOFF payment request error:", err);
      setError(
        err.message || "Couldn't submit your payment request."
      );
    } finally {
      setJoiningGameId(null);
    }
  }

  // ------------------------------------------------------------
  // ORGANISER APPROVAL / CANCELLATION
  // ------------------------------------------------------------

  async function reviewPaymentRequest(request, approve) {
    setReviewingRequestId(request.id);
    setError("");
    setNotice("");

    const resolvedStatus = approve ? "APPROVED" : "REJECTED";

    try {
      const { error: reviewError } = await supabase.rpc(
        "review_game_payment",
        {
          p_request_id: request.id,
          p_approve: approve,
          p_note: null,
        }
      );

      if (reviewError) throw reviewError;

      // Remove the request from the pending list immediately.
      setPaymentRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, status: resolvedStatus }
            : item
        )
      );

      await loadData();

      // Keep the resolved status if the refresh briefly returns stale data.
      setPaymentRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, status: resolvedStatus }
            : item
        )
      );

      setNotice(
        approve
          ? "Payment approved and the requested slots are now joined."
          : "Payment request rejected."
      );
    } catch (err) {
      console.error("KICKOFF payment review error:", err);
      setError(
        err.message || "Couldn't review this payment request."
      );
    } finally {
      setReviewingRequestId(null);
    }
  }

  async function cancelGame(game) {
    if (game.organiser_id !== user.id) {
      setError("Only the organiser can cancel this game.");
      return;
    }

    const confirmed = window.confirm(
      `Cancel "${game.title}"?\n\n` +
      "The match will disappear from active listings and pending payment requests will be rejected. " +
      "Any money already paid through UPI must be refunded separately."
    );

    if (!confirmed) return;

    setCancellingGameId(game.id);
    setError("");
    setNotice("");

    try {
      const { error: cancelError } = await supabase.rpc(
        "cancel_game",
        { p_game_id: game.id }
      );

      if (cancelError) throw cancelError;

      setGames((current) =>
        current.filter((item) => item.id !== game.id)
      );

      setPaymentRequests((current) =>
        current.map((request) =>
          request.game_id === game.id &&
          String(request.status || "").toUpperCase() === "PENDING"
            ? { ...request, status: "REJECTED" }
            : request
        )
      );

      setNotice(
        `"${game.title}" has been cancelled successfully.`
      );

      await loadData();
    } catch (err) {
      console.error("KICKOFF cancel-game error:", err);
      setError(
        err.message || "Couldn't cancel this game."
      );
    } finally {
      setCancellingGameId(null);
    }
  }

  // ------------------------------------------------------------
  // SHARING / CLIPBOARD
  // ------------------------------------------------------------

  function startFromTemplate(template) {
    setError("");
    setNotice("");
    if (!openCreateGame()) return;
    setGameDraftTemplate(template);
  }

  async function shareText(textToShare) {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Potato FC · KICKOFF",
          text: textToShare,
          url: window.location.href,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          `${textToShare}\n\nJoin Potato FC on KICKOFF: ${window.location.href}`
        );

        setNotice(
          "Potato FC details copied. Share them with the squad."
        );
      } else {
        setNotice(textToShare);
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        setError(
          "Couldn't share from this browser. Copy the details from the screen instead."
        );
      }
    }
  }

  async function copyHostUpi(upiId) {
    try {
      await navigator.clipboard.writeText(upiId);
      setNotice(
        "Host UPI ID copied. Pay in your UPI app, then return here."
      );
    } catch {
      setNotice(
        `Copy this host UPI ID manually: ${upiId}`
      );
    }
  }

  // ------------------------------------------------------------
  // GAME CARD
  // ------------------------------------------------------------

  function GameCard({ game, index = 0 }) {
    const venue = venueFor(game);
    const count = participantCounts[game.id] || 0;
    const full = count >= game.max_players;
    const joined = myGameIds.includes(game.id);
    const organizer = game.organiser_id === user.id;
    const isJoining = joiningGameId === game.id;

    const gameHasStarted =
      new Date(game.starts_at).getTime() <= clock;

    const myLatestRequest = paymentRequests.find(
      (request) =>
        request.game_id === game.id &&
        request.player_id === user.id
    );

    const paymentPending =
      String(myLatestRequest?.status || "").toUpperCase() ===
      "PENDING";

    const roster = gameRoster[game.id] || [];

    const blackTeam = roster.filter(
      (player) => player.team_color === "BLACK"
    );

    const whiteTeam = roster.filter(
      (player) => player.team_color === "WHITE"
    );

    const unassignedTeam = roster.filter(
      (player) =>
        !["BLACK", "WHITE"].includes(player.team_color)
    );

    return (
      <article className="game-card" key={game.id}>
        <div className={`game-art art-${index % 4}`}>
          <span className="game-format">
            {game.format || "Football"}
          </span>

          <div className="pitch-markings">
            <span />
          </div>

          <span className="art-ball">⚽</span>

          <span className="game-date-pill">
            {displayDate(game.starts_at)}
          </span>
        </div>

        <div className="game-details">
          <div className="game-card-kicker">
            <span className="status-dot" />
            {gameHasStarted
              ? "MATCH IN PROGRESS"
              : "OPEN MATCH"}
          </div>

          <h3>{game.title}</h3>

          <p className="venue-line">
            ⌖ {venue?.name || "Venue to be confirmed"}
            {venue?.city ? ` · ${venue.city}` : ""}
          </p>

          <div className="game-time">
            <span>◷</span>
            {displayTime(game.starts_at)} –{" "}
            {displayTime(game.ends_at)}
          </div>

          <div className="game-meta">
            <span>
              ♟ {count}/{game.max_players} slots
            </span>

            <span>
              {full
                ? "Full"
                : `${game.max_players - count} spots left`}
            </span>
          </div>

          <div className="spots-track">
            <div
              className="spots-fill"
              style={{
                width: `${Math.min(
                  100,
                  (count / game.max_players) * 100
                )}%`,
              }}
            />
          </div>

          {roster.length > 0 && (
            <div className="balanced-team-board">
              <div className="balanced-team-heading">
                <div>
                  <div className="section-eyebrow">
                    POTATO FC TEAM PICKER
                  </div>
                  <strong>Balanced teams</strong>
                </div>

                <span>
                  {roster.length} player
                  {roster.length === 1 ? "" : "s"}
                </span>
              </div>

              <p className="balanced-team-note">
                Teams rebalance automatically by the level each
                player selects for this match.
              </p>

              <div className="balanced-teams">
                {[
                  {
                    color: "BLACK",
                    title: "BLACK TEAM",
                    kit: "black",
                    players: blackTeam,
                  },
                  {
                    color: "WHITE",
                    title: "WHITE TEAM",
                    kit: "white",
                    players: whiteTeam,
                  },
                ].map((team) => (
                  <section
                    className={`balanced-team balanced-team-${team.kit}`}
                    key={team.color}
                  >
                    <div className="balanced-team-title">
                      <span
                        className={`team-kit team-kit-${team.kit}`}
                      >
                        ◉
                      </span>

                      <strong>{team.title}</strong>

                      <small>
                        {team.players.reduce(
                          (sum, player) =>
                            sum + Number(player.slots_count || 1),
                          0
                        )}{" "}
                        slots
                      </small>
                    </div>

                    {team.players.length > 0 ? (
                      <div className="balanced-team-players">
                        {team.players.map((player) => (
                          <div
                            className="balanced-team-player"
                            key={player.id}
                          >
                            <span className="balanced-player-name">
                              {player.full_name}
                            </span>

                            <span className="balanced-player-meta">
                              {player.match_skill_level ||
                                player.skill_level}
                              {" · "}
                              {player.primary_position}
                            </span>

                            {Number(player.slots_count || 1) > 1 && (
                              <span className="balanced-player-slots">
                                ×{player.slots_count} slots
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="balanced-team-empty">
                        Waiting for players
                      </div>
                    )}
                  </section>
                ))}
              </div>

              {unassignedTeam.length > 0 && (
                <div className="team-unassigned">
                  <strong>Team assignment pending</strong>

                  <span>
                    {unassignedTeam
                      .map((player) => player.full_name)
                      .join(", ")}
                  </span>

                  <small>
                    Refresh after the team-balancing migration
                    has been applied.
                  </small>
                </div>
              )}
            </div>
          )}

          <div className="game-footer">
            <div className="price">
              <strong>
                ₹
                {(
                  (game.price_per_player_paise || 0) / 100
                ).toLocaleString("en-IN")}
              </strong>

              <small> / slot</small>
            </div>

            <button
              className={`game-action ${
                joined || organizer ? "game-action-muted" : ""
              }`}
              disabled={
                organizer ||
                isJoining ||
                paymentPending ||
                (!joined && (full || gameHasStarted))
              }
              onClick={() => joinGame(game)}
            >
              {isJoining
                ? "Submitting…"
                : organizer
                ? "Your game"
                : joined
                ? "✓ Joined"
                : paymentPending
                ? "Awaiting host approval"
                : gameHasStarted
                ? "Match started"
                : full
                ? "Game full"
                : Number(game.price_per_player_paise || 0) > 0
                ? String(
                    myLatestRequest?.status || ""
                  ).toUpperCase() === "REJECTED"
                  ? "Retry payment request"
                  : "Pay & request slots ↗"
                : "Join game ↗"}
            </button>
          </div>

          <div className="game-card-extra-actions">
            <button
              type="button"
              className="text-action"
              onClick={() =>
                shareText(
                  `${game.title} · ${displayDate(game.starts_at, {
                    weekday: "long",
                  })} ${displayTime(game.starts_at)} · ${
                    venue?.name || "Venue to be confirmed"
                  } · ${game.format || "Football"}`
                )
              }
            >
              ↗ Share match
            </button>

            {organizer && page === "my-games" && (
              <button
                type="button"
                className="cancel-game-button"
                disabled={cancellingGameId === game.id}
                onClick={() => cancelGame(game)}
              >
                {cancellingGameId === game.id
                  ? "Cancelling…"
                  : "× Cancel game"}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  function goTo(nextPage) {
    setPage(nextPage);
    setNotice("");
    setError("");
    setSearch("");
    setFilter("All games");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  const pageTitle = {
    home: "Your pitch. Your people.",
    community: "Potatoes, assemble.",
    games: "Find your next game.",
    "my-games": "Your football calendar.",
    turfs: "Find your next turf.",
    profile: "Your player card.",
  }[page];

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------

  return (
    <div className="kickoff-app">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => goTo("home")}
          aria-label="KICKOFF home"
        >
          <span className="brand-mark">
            K<span>•</span>
          </span>

          <span className="brand-word">
            KICK<span>OFF</span>
          </span>
        </button>

        <div className="sidebar-label">PLAY</div>

        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`side-link ${
                page === item.id ? "active" : ""
              }`}
              onClick={() => goTo(item.id)}
            >
              <span className="side-icon">{item.icon}</span>
              <span>{item.label}</span>

              {item.id === "my-games" && myGames.length > 0 && (
                <span className="nav-count">{myGames.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-promo">
          <div className="promo-ball">⚽</div>
          <strong>Game on.</strong>
          <p>Good people. Great football. No excuses.</p>

          <button onClick={openCreateGame}>
            + Create a game
          </button>
        </div>

        <div className="sidebar-user">
          <div className="avatar">{initials || "P"}</div>

          <div className="sidebar-user-text">
            <strong>{displayName}</strong>
            <span>Player account</span>
          </div>

          <button
            className="logout-icon"
            title="Log out"
            disabled={loggingOut}
            onClick={handleLogout}
          >
            ↗
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="mobile-header">
          <button
            className="brand"
            onClick={() => goTo("home")}
          >
            <span className="brand-mark">
              K<span>•</span>
            </span>

            <span className="brand-word">
              KICK<span>OFF</span>
            </span>
          </button>

          <button
            className="mobile-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out…" : "Log out ↗"}
          </button>
        </header>

        <main className="main-content">
          <div className="page-topline">
            <div className="breadcrumb">
              KICKOFF <span>/</span>{" "}
              {NAV_ITEMS.find((item) => item.id === page)
                ?.label.toUpperCase() || "HOME"}
            </div>

            <div className="topline-right">
              <span className="live-indicator" />
              BENGALURU · FOOTBALL COMMUNITY
            </div>
          </div>

          {profileLoaded && !profileComplete && page !== "profile" && (
            <div className="profile-setup-banner">
              <span className="profile-setup-banner-icon">◉</span>
              <div>
                <strong>Complete your player card</strong>
                <p>
                  Add your name, skill level and position before
                  joining a match.
                </p>
              </div>
              <button onClick={() => goTo("profile")}>
                Set up profile ↗
              </button>
            </div>
          )}

          {/* HOME */}
          {page === "home" && (
            <>
              <section className="welcome-hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span className="live-indicator" />
                    YOUR NEXT MATCH STARTS HERE
                  </div>

                  <h1>
                    Football is better
                    <br />
                    <span>together.</span>
                  </h1>

                  <p>
                    Find your squad, discover local games and get
                    back on the pitch. Your next great match is
                    closer than you think.
                  </p>

                  <div className="hero-actions">
                    <button
                      className="lime-button"
                      onClick={() => goTo("games")}
                    >
                      Find a game <span>↗</span>
                    </button>

                    <button
                      className="outline-button"
                      onClick={openCreateGame}
                    >
                      ＋ Organise a match
                    </button>
                  </div>

                  <div className="hero-proof">
                    <span>✳</span> Welcome back, {displayName}
                  </div>
                </div>

                <div className="hero-art">
                  <div className="hero-ring ring-one" />
                  <div className="hero-ring ring-two" />
                  <div className="hero-ring ring-three" />

                  <div className="hero-stamp">
                    KICK
                    <br />
                    OFF<span>®</span>
                  </div>

                  <div className="hero-football">⚽</div>

                  <div className="hero-floating hero-float-top">
                    <span>✦</span>
                    <div>
                      <b>Find your people</b>
                      <small>Meet your next squad</small>
                    </div>
                  </div>

                  <div className="hero-floating hero-float-bottom">
                    <span>↗</span>
                    <div>
                      <b>Make it happen</b>
                      <small>One game at a time</small>
                    </div>
                  </div>
                </div>

                <div className="hero-index">
                  01 <span>/</span> 05
                </div>
              </section>

              <section className="quick-stats">
                <div>
                  <span className="stat-symbol">⚽</span>
                  <div>
                    <strong>{games.length}</strong>
                    <small>Upcoming games</small>
                  </div>
                </div>

                <div>
                  <span className="stat-symbol">⌖</span>
                  <div>
                    <strong>{venues.length}</strong>
                    <small>Active venues</small>
                  </div>
                </div>

                <div>
                  <span className="stat-symbol">♟</span>
                  <div>
                    <strong>{myGames.length}</strong>
                    <small>Your matches</small>
                  </div>
                </div>

                <div className="stats-note">
                  <span className="live-indicator" />
                  LIVE FROM THE COMMUNITY
                </div>
              </section>

              <section className="potato-home-card">
                <div className="potato-home-copy">
                  <span className="potato-kicker">
                    YOUR SOUTH BENGALURU FOOTBALL CIRCLE
                  </span>

                  <h2>
                    Meet <span>Potato FC.</span>
                  </h2>

                  <p>
                    One community for the Potatoes from Koramangala,
                    HSR, BTM, JP Nagar, Jayanagar, Banashankari,
                    Electronic City, Sarjapur Road, Kumaraswamy
                    Layout and everywhere nearby.
                  </p>

                  <div className="potato-home-actions">
                    <button
                      className="lime-button"
                      onClick={() => goTo("community")}
                    >
                      Open community ↗
                    </button>

                    <button
                      className="outline-button"
                      onClick={() =>
                        shareText(
                          "Potato FC — South Bengaluru football community. Weekly runs: Wednesday Verve Play 5v5, Thursday Play Matrix 9v9, Friday Verve Play 5v5 and Sunday Verve Play 5v5."
                        )
                      }
                    >
                      Invite a Potato ↗
                    </button>
                  </div>
                </div>

                <div className="potato-home-badge">
                  <span>🥔</span>
                  <strong>POTATO FC</strong>
                  <small>South Bengaluru · Est. by the squad</small>
                </div>
              </section>

              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <div className="section-eyebrow">
                      THE COMMUNITY
                    </div>

                    <h2>
                      Games worth showing up for<span>.</span>
                    </h2>

                    <p>
                      Real matches, real players. Find a spot and
                      get involved.
                    </p>
                  </div>

                  <button
                    className="view-all"
                    onClick={() => goTo("games")}
                  >
                    All games ↗
                  </button>
                </div>

                {loading ? (
                  <div className="empty-panel">
                    Loading games from the KICKOFF community…
                  </div>
                ) : (
                  <div className="games-grid">
                    {games.slice(0, 3).map((game, index) => (
                      <GameCard
                        key={game.id}
                        game={game}
                        index={index}
                      />
                    ))}

                    {games.length === 0 && (
                      <div className="empty-panel">
                        <span>⚽</span>
                        <h3>Be the first to kick off.</h3>
                        <p>
                          No upcoming games yet. Create one and
                          bring your squad together.
                        </p>

                        <button
                          className="lime-button"
                          onClick={openCreateGame}
                        >
                          Create the first game ↗
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          {/* POTATO FC COMMUNITY */}
          {page === "community" && (
            <section className="content-section page-section potato-community-page">
              <div className="potato-community-hero">
                <div className="potato-community-hero-copy">
                  <div className="section-eyebrow">
                    KICKOFF CLUBHOUSE · SOUTH BENGALURU
                  </div>

                  <h1>
                    Potatoes, <span>assemble.</span>
                  </h1>

                  <p>
                    A community-first home for the people who make
                    the game happen. Find your run, meet the squad,
                    and keep the weekly football ritual alive.
                  </p>

                  <div className="potato-community-stats">
                    <span>
                      <strong>4</strong> weekly runs
                    </span>
                    <span>
                      <strong>{games.length}</strong> active KICKOFF games
                    </span>
                    <span>
                      <strong>{myGames.length}</strong> in your calendar
                    </span>
                  </div>
                </div>

                <div className="potato-community-mark">
                  🥔
                  <small>NO POTATO LEFT BEHIND</small>
                </div>
              </div>

              <div className="potato-section-heading">
                <div>
                  <div className="section-eyebrow">
                    THE HOME TURF CIRCLE
                  </div>

                  <h2>
                    South Bengaluru, <span>one squad.</span>
                  </h2>

                  <p>
                    Open to Potatoes from these neighbourhoods
                    and nearby areas.
                  </p>
                </div>

                <button
                  className="outline-button"
                  onClick={() =>
                    shareText(
                      "Join Potato FC, the South Bengaluru football community on KICKOFF. Everyone from Koramangala, HSR, BTM, JP Nagar, Jayanagar, Banashankari, Electronic City, Sarjapur Road, Kumaraswamy Layout and nearby areas is welcome."
                    )
                  }
                >
                  Invite community ↗
                </button>
              </div>

              <div className="neighborhood-chips">
                {POTATO_NEIGHBORHOODS.map((area) => (
                  <span key={area}>{area}</span>
                ))}
              </div>

              <div className="potato-section-heading schedule-heading">
                <div>
                  <div className="section-eyebrow">
                    NEXT WEEK · WEEKLY ROUTINE
                  </div>

                  <h2>
                    Four chances to <span>get a game in.</span>
                  </h2>

                  <p>
                    Dates roll forward every week. Times, booking
                    and price must be confirmed by the organiser
                    before a live KICKOFF match is published.
                  </p>
                </div>
              </div>

              <div className="weekly-run-grid">
                {WEEKLY_RUNS.map((run) => (
                  <article
                    className={`weekly-run-card run-${run.accent}`}
                    key={run.id}
                  >
                    <div className="weekly-run-top">
                      <span className="weekly-run-day">{run.day}</span>
                      <span className="weekly-run-format">
                        {run.formatLabel}
                      </span>
                    </div>

                    <div className="weekly-run-date">
                      {new Date(
                        `${run.date}T12:00:00`
                      ).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </div>

                    <h3>{run.venueName}</h3>

                    <p className="weekly-run-subtitle">
                      Potato FC · {run.formatLabel} football
                    </p>

                    <div className="weekly-run-detail">
                      <span>⌖</span>
                      {run.venueName === "Verve Play"
                        ? "Jayanagar"
                        : "Padmanabhanagar"}
                    </div>

                    <div className="weekly-run-detail">
                      <span>◷</span>
                      Kick-off time to be set
                    </div>

                    <div className="weekly-run-detail">
                      <span>₹</span>
                      Price to be confirmed by organiser
                    </div>

                    <button
                      className="lime-button weekly-run-cta"
                      onClick={() => startFromTemplate(run)}
                    >
                      Set up in KICKOFF ↗
                    </button>

                    <a
                      className="weekly-run-reference"
                      href={run.playoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Original session reference ↗
                    </a>
                  </article>
                ))}
              </div>

              <div className="potato-community-notes">
                <div>
                  <span>01</span>
                  <strong>Player card first</strong>
                  <p>
                    Keep your level and position current so
                    organisers know how to balance the squad.
                  </p>
                </div>

                <div>
                  <span>02</span>
                  <strong>Clear headcount</strong>
                  <p>
                    Join in KICKOFF so everyone can see the live
                    number of slots claimed.
                  </p>
                </div>

                <div>
                  <span>03</span>
                  <strong>Show up for the squad</strong>
                  <p>
                    If plans change, tell the organiser early.
                    Payment and cancellation rules stay visible
                    on each match.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* FIND A GAME */}
          {page === "games" && (
            <section className="content-section page-section">
              <div className="section-heading">
                <div>
                  <div className="section-eyebrow">
                    GET IN THE GAME
                  </div>

                  <h1>
                    {pageTitle}<span>.</span>
                  </h1>

                  <p>
                    Browse upcoming community matches and claim
                    your spot.
                  </p>
                </div>

                <button
                  className="lime-button"
                  onClick={openCreateGame}
                >
                  ＋ Create game
                </button>
              </div>

              <div className="toolbar">
                <label className="search-control">
                  <span>⌕</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search matches, formats or venues…"
                  />
                </label>

                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option>All games</option>
                  <option>Spots available</option>
                  <option>My games</option>
                  <option>Organised by me</option>
                </select>
              </div>

              {notice && (
                <div className="feedback success">
                  {notice}
                  <button onClick={() => setNotice("")}>×</button>
                </div>
              )}

              {error && (
                <div className="feedback failure">
                  {error}
                  <button onClick={() => setError("")}>×</button>
                </div>
              )}

              {loading ? (
                <div className="empty-panel">Loading matches…</div>
              ) : (
                <div className="games-grid">
                  {visibleGames.map((game, index) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      index={index}
                    />
                  ))}

                  {visibleGames.length === 0 && (
                    <div className="empty-panel">
                      <span>⌕</span>
                      <h3>No matches found.</h3>
                      <p>
                        Try another search or create a game for
                        your community.
                      </p>

                      <button
                        className="lime-button"
                        onClick={openCreateGame}
                      >
                        Organise a game ↗
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                className="refresh-button"
                onClick={loadData}
                disabled={loading}
              >
                {loading ? "Refreshing…" : "↻ Refresh matches"}
              </button>
            </section>
          )}

          {/* MY GAMES / PAYMENT APPROVAL */}
          {page === "my-games" && (
            <section className="content-section page-section">
              <div className="section-heading">
                <div>
                  <div className="section-eyebrow">YOUR LINE-UP</div>

                  <h1>
                    {pageTitle}<span>.</span>
                  </h1>

                  <p>
                    Every match you've joined and every game
                    you're organising.
                  </p>
                </div>

                <button
                  className="lime-button"
                  onClick={() => goTo("games")}
                >
                  Find a game ↗
                </button>
              </div>

              {paymentRequests.some(
                (request) =>
                  String(request.status || "").toUpperCase() ===
                    "PENDING" &&
                  games.some(
                    (game) =>
                      game.id === request.game_id &&
                      game.organiser_id === user.id
                  )
              ) && (
                <section className="content-section payment-approval-section">
                  <div className="section-heading">
                    <div>
                      <div className="section-eyebrow">
                        HOST CONTROLS
                      </div>

                      <h2>
                        Payment requests<span>.</span>
                      </h2>

                      <p>
                        Check your UPI app first. A transaction
                        reference alone is not proof of payment.
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "12px" }}>
                    {paymentRequests
                      .filter(
                        (request) =>
                          String(request.status || "").toUpperCase() ===
                            "PENDING" &&
                          games.some(
                            (game) =>
                              game.id === request.game_id &&
                              game.organiser_id === user.id
                          )
                      )
                      .map((request) => {
                        const requestGame = games.find(
                          (game) => game.id === request.game_id
                        );

                        const busy =
                          reviewingRequestId === request.id;

                        return (
                          <article
                            key={request.id}
                            className="profile-panel"
                            style={{
                              padding: "18px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                justifyContent: "space-between",
                                gap: "8px",
                              }}
                            >
                              <strong>
                                {requestGame?.title || "Game payment"}
                              </strong>

                              <span className="section-eyebrow">
                                PENDING VERIFICATION
                              </span>
                            </div>

                            <div>
                              Player:{" "}
                              <strong>
                                {request.player_name || "Player"}
                              </strong>

                              <span className="payment-player-id">
                                {" "}· ID {request.player_id.slice(0, 8)}…
                              </span>
                            </div>

                            <div>
                              Amount reported:{" "}
                              <strong>
                                ₹
                                {(
                                  Number(request.amount_paise || 0) / 100
                                ).toLocaleString("en-IN")}
                              </strong>
                              {" · "}
                              {request.slots_count} slot(s)
                            </div>

                            <div>
                              Playing level:{" "}
                              <strong>
                                {request.match_skill_level || "Beginner"}
                              </strong>
                            </div>

                            <div>
                              UPI reference:{" "}
                              <code>{request.upi_reference}</code>
                            </div>

                            <p
                              className="form-note"
                              style={{ margin: 0 }}
                            >
                              Open your own UPI app and confirm the
                              amount and transaction before approving.
                              Approval reserves the slots in KICKOFF.
                            </p>

                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "8px",
                              }}
                            >
                              <button
                                type="button"
                                className="lime-button"
                                disabled={busy}
                                onClick={() =>
                                  reviewPaymentRequest(request, true)
                                }
                              >
                                {busy
                                  ? "Saving…"
                                  : "I verified payment — approve"}
                              </button>

                              <button
                                type="button"
                                className="outline-dark-button"
                                disabled={busy}
                                onClick={() =>
                                  reviewPaymentRequest(request, false)
                                }
                              >
                                Reject request
                              </button>
                            </div>
                          </article>
                        );
                      })}
                  </div>
                </section>
              )}

              {loading ? (
                <div className="empty-panel">
                  Loading your games…
                </div>
              ) : (
                <div className="games-grid">
                  {myGames.map((game, index) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      index={index}
                    />
                  ))}

                  {myGames.length === 0 && (
                    <div className="empty-panel">
                      <span>▣</span>
                      <h3>Your calendar is wide open.</h3>
                      <p>
                        Join a match or organise one to see it here.
                      </p>

                      <button
                        className="lime-button"
                        onClick={() => goTo("games")}
                      >
                        Explore games ↗
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* FIND A TURF */}
          {page === "turfs" && (
            <section className="content-section page-section">
              <div className="section-heading">
                <div>
                  <div className="section-eyebrow">
                    FIND YOUR GROUND
                  </div>

                  <h1>
                    {pageTitle}<span>.</span>
                  </h1>

                  <p>
                    Explore active venue listings. Live availability
                    and booking are not connected yet.
                  </p>
                </div>
              </div>

              <label className="search-control turf-search">
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search turf name or location…"
                />
              </label>

              {loading ? (
                <div className="empty-panel">Loading venues…</div>
              ) : (
                <div className="turfs-grid">
                  {venues
                    .filter((venue) =>
                      `${venue.name} ${venue.city || ""} ${
                        venue.address || ""
                      }`
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    )
                    .map((venue) => (
                      <article
                        className="turf-card"
                        key={venue.id}
                      >
                        <div className="turf-art">
                          <span>🏟</span>
                          <small>VENUE LISTING</small>
                        </div>

                        <div className="turf-info">
                          <div className="section-eyebrow">
                            BENGALURU · FOOTBALL
                          </div>

                          <h3>{venue.name}</h3>

                          <p>
                            ⌖ {venue.address || "Address to be confirmed"}
                            {venue.city ? `, ${venue.city}` : ""}
                          </p>

                          <div className="turf-status">
                            <span className="live-indicator" />
                            Active listing
                            <span>Booking not available</span>
                          </div>
                        </div>
                      </article>
                    ))}

                  {venues.length === 0 && (
                    <div className="empty-panel">
                      <span>⌖</span>
                      <h3>No turfs listed yet.</h3>
                      <p>
                        Active venue listings will show up here
                        when added by the team.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* PLAYER PROFILE */}
          {page === "profile" && (
            <section className="content-section page-section">
              <div className="section-heading">
                <div>
                  <div className="section-eyebrow">PLAYER ID</div>
                  <h1>
                    Your player card<span>.</span>
                  </h1>
                  <p>
                    Tell your squad how you play. You only need
                    to set this up once.
                  </p>
                </div>

                <div
                  className={`profile-status-pill ${
                    profileComplete ? "is-complete" : "is-incomplete"
                  }`}
                >
                  <span />
                  {profileComplete
                    ? "PROFILE READY"
                    : "SETUP REQUIRED"}
                </div>
              </div>

              <div className="profile-panel player-profile-panel">
                <div className="profile-cover">
                  <span>KICKOFF · PLAYER ID</span>
                  <div className="profile-big-avatar">
                    {initials || "P"}
                  </div>
                  <div className="profile-cover-tag">
                    {playerProfile.skill_level || "CHOOSE YOUR LEVEL"}
                  </div>
                </div>

                <form
                  className="profile-edit-form"
                  key={
                    profileLoaded
                      ? "profile-loaded"
                      : "profile-loading"
                  }
                  onSubmit={savePlayerProfile}
                >
                  <div className="profile-form-intro">
                    <div>
                      <div className="section-eyebrow">
                        YOUR PLAYER DETAILS
                      </div>

                      <h2>
                        {profileComplete
                          ? "Keep your card current"
                          : "Build your player card"}
                      </h2>

                      <p>
                        Your name, playing level and main position
                        are required before joining or publishing
                        a match.
                      </p>
                    </div>

                    <span className="profile-form-icon">⚽</span>
                  </div>

                  <label>
                    Full name <span className="required-mark">*</span>
                    <input
                      name="full_name"
                      type="text"
                      minLength={2}
                      maxLength={60}
                      autoComplete="name"
                      defaultValue={playerProfile.full_name}
                      placeholder="Your full name"
                      required
                    />
                  </label>

                  <div className="form-two-columns">
                    <label>
                      Playing level{" "}
                      <span className="required-mark">*</span>
                      <select
                        name="skill_level"
                        defaultValue={playerProfile.skill_level || ""}
                        required
                      >
                        <option value="">Choose your level</option>
                        {SKILL_LEVELS.map((level) => (
                          <option value={level} key={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Main position{" "}
                      <span className="required-mark">*</span>
                      <select
                        name="primary_position"
                        defaultValue={
                          playerProfile.primary_position || ""
                        }
                        required
                      >
                        <option value="">Choose a position</option>
                        {POSITIONS.map((position) => (
                          <option value={position} key={position}>
                            {position}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="form-two-columns">
                    <label>
                      Secondary position <small>(optional)</small>
                      <select
                        name="secondary_position"
                        defaultValue={
                          playerProfile.secondary_position || ""
                        }
                      >
                        <option value="">None</option>
                        {POSITIONS.map((position) => (
                          <option value={position} key={position}>
                            {position}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Preferred foot
                      <select
                        name="preferred_foot"
                        defaultValue={
                          playerProfile.preferred_foot || "Right"
                        }
                      >
                        <option value="Right">Right-footed</option>
                        <option value="Left">Left-footed</option>
                        <option value="Both">Both feet</option>
                      </select>
                    </label>
                  </div>

                  <div className="form-two-columns">
                    <label>
                      Jersey number <small>(optional)</small>
                      <input
                        name="jersey_number"
                        type="number"
                        min="0"
                        max="99"
                        defaultValue={
                          playerProfile.jersey_number ?? ""
                        }
                        placeholder="e.g. 10"
                      />
                    </label>

                    <label>
                      Email address
                      <input
                        type="email"
                        value={user.email || ""}
                        readOnly
                        disabled
                      />
                    </label>
                  </div>

                  <label>
                    Short player intro{" "}
                    <small>(optional · max 240 characters)</small>
                    <textarea
                      name="bio"
                      rows={3}
                      maxLength={240}
                      defaultValue={playerProfile.bio || ""}
                      placeholder="Your style of play, experience, or what kind of games you enjoy…"
                    />
                  </label>

                  <div className="profile-preview-strip">
                    <div className="profile-preview-avatar">
                      {initials || "P"}
                    </div>

                    <div className="profile-preview-copy">
                      <strong>{displayName}</strong>
                      <span>
                        {playerProfile.skill_level || "Level not set"}
                        {" · "}
                        {playerProfile.primary_position ||
                          "Position not set"}
                      </span>
                    </div>

                    <span className="profile-preview-check">
                      {profileComplete ? "✓ SAVED" : "PLAYER CARD"}
                    </span>
                  </div>

                  <button
                    className="lime-button submit-button"
                    type="submit"
                    disabled={profileSaving}
                  >
                    {profileSaving
                      ? "Saving player card…"
                      : profileComplete
                      ? "Save player card ↗"
                      : "Save & get match-ready ↗"}
                  </button>
                </form>
              </div>

              <div className="profile-benefit-row">
                <div>
                  <span>01</span>
                  <strong>Find your fit</strong>
                  <small>Hosts can see your level and role.</small>
                </div>

                <div>
                  <span>02</span>
                  <strong>Join faster</strong>
                  <small>Your player details are reused.</small>
                </div>

                <div>
                  <span>03</span>
                  <strong>Play as a squad</strong>
                  <small>Meet the players already signed up.</small>
                </div>
              </div>

              {/* HOST ACCOUNT: guest -> email + password */}
              <SecureAccount user={user} />

              {/* LOGOUT OPTION IS ALSO AVAILABLE HERE */}
              <section className="profile-account-panel">
                <div className="profile-account-copy">
                  <div className="section-eyebrow">
                    ACCOUNT & SESSION
                  </div>

                  <h2>Signed in to KICKOFF</h2>

                  <p>
                    {user.email || "Your authenticated player account"}
                  </p>

                  <small>
                    Logging out will return you to the sign-in screen.
                  </small>
                </div>

                <button
                  type="button"
                  className="profile-logout-button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  <span aria-hidden="true">↗</span>
                  {loggingOut
                    ? "Logging out…"
                    : "Log out of KICKOFF"}
                </button>
              </section>
            </section>
          )}

          {notice && page !== "games" && (
            <div className="feedback success global-feedback">
              {notice}
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}

          {error && page !== "games" && (
            <div className="feedback failure global-feedback">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}

          <footer className="main-footer">
            <div className="footer-brand">
              <span className="brand-mark">
                K<span>•</span>
              </span>

              <span className="brand-word">
                KICK<span>OFF</span>
              </span>
            </div>

            <span>Made for the love of football.</span>
            <span>PLAY TOGETHER. PLAY MORE.</span>
          </footer>
        </main>
      </div>

      {/* MOBILE NAV */}
      <nav className="mobile-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? "active" : ""}
            onClick={() => goTo(item.id)}
          >
            <span>{item.icon}</span>

            <small>
              {item.label === "Find a game"
                ? "Games"
                : item.label === "My profile"
                ? "Profile"
                : item.label === "Find a turf"
                ? "Turfs"
                : item.label === "My games"
                ? "My games"
                : item.id === "community"
                ? "Potato FC"
                : "Home"}
            </small>
          </button>
        ))}
      </nav>

      {/* CREATE GAME MODAL */}
      {showForm && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              !saving
            ) {
              setShowForm(false);
              setGameDraftTemplate(null);
            }
          }}
        >
          <form
            className="game-form"
            key={gameDraftTemplate?.id || "manual-game"}
            onSubmit={createGame}
          >
            <div className="form-heading">
              <div>
                <div className="section-eyebrow">
                  BRING YOUR SQUAD
                </div>

                <h2>
                  {gameDraftTemplate
                    ? "Set up the weekly run"
                    : "Organise a game"}
                  <span>.</span>
                </h2>

                <p>
                  {gameDraftTemplate
                    ? `${gameDraftTemplate.day} · ${gameDraftTemplate.formatLabel} · ${new Date(
                        `${gameDraftTemplate.date}T12:00:00`
                      ).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}. Confirm the time and price before publishing.`
                    : "Set the details. We'll bring the players."}
                </p>
              </div>

              <button
                type="button"
                className="close-button"
                disabled={saving}
                onClick={() => {
                  setShowForm(false);
                  setGameDraftTemplate(null);
                }}
              >
                ×
              </button>
            </div>

            <label>
              Game name
              <input
                name="title"
                placeholder="e.g. Friday Night Football"
                defaultValue={gameDraftTemplate?.title || ""}
                maxLength={150}
                required
              />
            </label>

            <label>
              Venue
              <input
                name="venue_name"
                placeholder="e.g. Bengaluru Football Turf"
                defaultValue={gameDraftTemplate?.venueName || ""}
                maxLength={200}
                required
              />
            </label>

            <div className="form-two-columns">
              <label>
                Date
                <input
                  name="date"
                  type="date"
                  min={localDateISO(new Date())}
                  defaultValue={gameDraftTemplate?.date || ""}
                  required
                />
              </label>

              <label>
                Kick-off time
                <input name="time" type="time" required />
              </label>
            </div>

            <div className="form-two-columns">
              <label>
                Duration
                <select name="duration" defaultValue="60">
                  <option value="60">60 minutes</option>
                  <option value="90">90 minutes</option>
                  <option value="120">120 minutes</option>
                </select>
              </label>

              <label>
                Match format
                <select
                  name="format"
                  defaultValue={
                    gameDraftTemplate?.format || "7-a-side"
                  }
                >
                  <option>5-a-side</option>
                  <option>7-a-side</option>
                  <option>9-a-side</option>
                  <option>11-a-side</option>
                </select>
              </label>
            </div>

            <div className="form-two-columns">
              <label>
                Price per slot (₹)
                <input
                  name="price"
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  defaultValue={gameDraftTemplate ? "" : "200"}
                  required
                />
              </label>

              <label>
                Total slots available
                <input
                  name="total"
                  type="number"
                  min="2"
                  max="50"
                  defaultValue={gameDraftTemplate?.maxPlayers || 14}
                  required
                />
              </label>
            </div>

            <label>
              Host UPI ID{" "}
              <small>(required for paid games)</small>
              <input
                name="host_upi_id"
                type="text"
                placeholder="yourname@upi"
                maxLength={100}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>

            <p className="form-note">
              Players pay separately in their UPI app and submit a
              transaction reference. You must verify each payment
              yourself before approving slots. This does not
              reserve a turf.
            </p>

            <button
              className="lime-button submit-button"
              type="submit"
              disabled={saving}
            >
              {saving ? "Saving match…" : "Publish game ↗"}
            </button>
          </form>
        </div>
      )}

      {/* FREE GAME JOIN MODAL */}
      {freeJoinGame && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              joiningGameId !== freeJoinGame.id
            ) {
              setFreeJoinGame(null);
            }
          }}
        >
          <form
            className="game-form"
            onSubmit={confirmFreeJoin}
          >
            <div className="form-heading">
              <div>
                <div className="section-eyebrow">
                  POTATO FC · TEAM BALANCING
                </div>

                <h2>
                  Pick your match level<span>.</span>
                </h2>

                <p>{freeJoinGame.title}</p>
              </div>

              <button
                type="button"
                className="close-button"
                disabled={joiningGameId === freeJoinGame.id}
                onClick={() => setFreeJoinGame(null)}
              >
                ×
              </button>
            </div>

            <label>
              Your playing level for this match
              <select
                value={selectedMatchSkillLevel}
                onChange={(event) =>
                  setSelectedMatchSkillLevel(event.target.value)
                }
                required
              >
                {SKILL_LEVELS.map((level) => (
                  <option value={level} key={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>

            <div className="kit-choice-preview">
              <div className="kit-choice kit-choice-black">
                <span>◉</span>
                <strong>BLACK TEAM</strong>
                <small>Dark jersey</small>
              </div>

              <div className="kit-choice kit-choice-white">
                <span>◉</span>
                <strong>WHITE TEAM</strong>
                <small>Light jersey</small>
              </div>
            </div>

            <p className="form-note">
              Your selected level is used to balance the match.
              KICKOFF automatically distributes confirmed players
              between Black and White, then rebalances as players join.
            </p>

            <button
              className="lime-button submit-button"
              type="submit"
              disabled={joiningGameId === freeJoinGame.id}
            >
              {joiningGameId === freeJoinGame.id
                ? "Joining match…"
                : "Confirm level & join ↗"}
            </button>
          </form>
        </div>
      )}

      {/* PAID GAME REQUEST MODAL */}
      {paymentGame && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              joiningGameId !== paymentGame.id
            ) {
              setPaymentGame(null);
            }
          }}
        >
          <form
            className="game-form"
            onSubmit={submitPaymentRequest}
          >
            <div className="form-heading">
              <div>
                <div className="section-eyebrow">
                  DIRECT UPI PAYMENT
                </div>

                <h2>
                  Request your slots<span>.</span>
                </h2>

                <p>{paymentGame.title}</p>
              </div>

              <button
                type="button"
                className="close-button"
                disabled={joiningGameId === paymentGame.id}
                onClick={() => setPaymentGame(null)}
              >
                ×
              </button>
            </div>

            <div
              className="profile-panel"
              style={{
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <span className="section-eyebrow">PAY THE HOST</span>

              <strong style={{ overflowWrap: "anywhere" }}>
                {paymentGame.host_upi_id}
              </strong>

              <button
                type="button"
                className="outline-dark-button"
                onClick={() =>
                  copyHostUpi(paymentGame.host_upi_id)
                }
              >
                Copy host UPI ID
              </button>

              <p className="form-note" style={{ margin: 0 }}>
                Open your UPI app separately, pay the host, and
                return here. KICKOFF does not automatically verify
                bank or UPI payments.
              </p>
            </div>

            <label>
              Number of slots
              <input
                type="number"
                min="1"
                max={Math.max(
                  1,
                  Math.min(
                    50,
                    Number(paymentGame.max_players) -
                      (participantCounts[paymentGame.id] || 0)
                  )
                )}
                value={paymentSlots}
                onChange={(event) =>
                  setPaymentSlots(event.target.value)
                }
                required
              />
            </label>

            <label>
              Playing level for this match
              <select
                value={selectedMatchSkillLevel}
                onChange={(event) =>
                  setSelectedMatchSkillLevel(event.target.value)
                }
                required
              >
                {SKILL_LEVELS.map((level) => (
                  <option value={level} key={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>

            <p className="form-note">
              Choose honestly so Potato FC can balance the Black
              and White teams. This level applies to all slots in
              this booking.
            </p>

            <div className="kit-choice-preview">
              <div className="kit-choice kit-choice-black">
                <span>◉</span>
                <strong>BLACK TEAM</strong>
                <small>Dark jersey</small>
              </div>

              <div className="kit-choice kit-choice-white">
                <span>◉</span>
                <strong>WHITE TEAM</strong>
                <small>Light jersey</small>
              </div>
            </div>

            <div
              className="profile-panel"
              style={{
                padding: "14px",
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span>Total to pay</span>

              <strong>
                ₹
                {(
                  (Number(
                    paymentGame.price_per_player_paise || 0
                  ) /
                    100) *
                  Math.max(0, Number(paymentSlots) || 0)
                ).toLocaleString("en-IN")}
              </strong>
            </div>

            <label>
              UPI transaction reference / UTR
              <input
                value={upiReference}
                onChange={(event) =>
                  setUpiReference(event.target.value)
                }
                placeholder="Enter the reference shown by your UPI app"
                minLength={4}
                maxLength={100}
                autoCapitalize="characters"
                required
              />
            </label>

            <p className="form-note">
              Submitting a reference does not prove payment.
              Your slots are not confirmed until the host checks
              their UPI app and approves your request.
            </p>

            <button
              className="lime-button submit-button"
              type="submit"
              disabled={
                joiningGameId === paymentGame.id ||
                Number(paymentSlots) < 1 ||
                Number(paymentSlots) >
                  Number(paymentGame.max_players) -
                    (participantCounts[paymentGame.id] || 0)
              }
            >
              {joiningGameId === paymentGame.id
                ? "Submitting request…"
                : "Submit payment reference ↗"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
