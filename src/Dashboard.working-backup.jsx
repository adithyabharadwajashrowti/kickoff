import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "games", label: "Find a game", icon: "⚽" },
  { id: "my-games", label: "My games", icon: "▣" },
  { id: "turfs", label: "Find a turf", icon: "⌖" },
  { id: "profile", label: "My profile", icon: "◉" },
];

export default function Dashboard({ user, onLogout }) {
  const [page, setPage] = useState("home");
  const [games, setGames] = useState([]);
  const [venues, setVenues] = useState([]);
  const [participantCounts, setParticipantCounts] = useState({});
  const [myGameIds, setMyGameIds] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All games");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [joiningGameId, setJoiningGameId] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const displayName =
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "Player";

  const initials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const now = new Date().toISOString();

      const [gamesResult, venuesResult, membershipsResult] =
        await Promise.all([
          supabase
            .from("games")
            .select("*")
            .eq("status", "open")
            .gte("starts_at", now)
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
        ]);

      if (gamesResult.error) throw gamesResult.error;
      if (venuesResult.error) throw venuesResult.error;
      if (membershipsResult.error) throw membershipsResult.error;

      const loadedGames = gamesResult.data || [];

      setGames(loadedGames);
      setVenues(venuesResult.data || []);
      setMyGameIds(
        (membershipsResult.data || []).map((item) => item.game_id)
      );

      if (loadedGames.length) {
        const { data: participants, error: participantError } =
          await supabase
            .from("game_participants")
            .select("game_id, status")
            .in(
              "game_id",
              loadedGames.map((game) => game.id)
            )
            .eq("status", "joined");

        if (participantError) throw participantError;

        const counts = {};

        for (const participant of participants || []) {
          counts[participant.game_id] =
            (counts[participant.game_id] || 0) + 1;
        }

        setParticipantCounts(counts);
      } else {
        setParticipantCounts({});
      }
    } catch (err) {
      console.error("KICKOFF data loading error:", err);
      setError(err.message || "We couldn't load the latest information.");
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const venueFor = (game) =>
    venues.find((venue) => venue.id === game.venue_id);

  const myGames = useMemo(
    () =>
      games.filter(
        (game) =>
          myGameIds.includes(game.id) || game.organiser_id === user.id
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

  async function createGame(event) {
    event.preventDefault();

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

      if (!title) {
        throw new Error("Enter a name for your game.");
      }

      const { data, error: createError } = await supabase
        .from("games")
        .insert({
          organiser_id: user.id,
          venue_id: form.get("venue_id") || null,
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

      const { error: participantError } = await supabase
        .from("game_participants")
        .insert({
          game_id: data.id,
          player_id: user.id,
          status: "joined",
        });

      if (participantError) {
        console.error(
          "Organizer participant entry failed:",
          participantError
        );

        setNotice(
          "Game created, but your organizer entry could not be saved."
        );
      } else {
        setNotice(
          "Your game is live. Get your squad together! ⚽"
        );
      }

      setShowForm(false);
      setPage("games");
      setFilter("All games");
      setSearch("");

      await loadData();
    } catch (err) {
      console.error("KICKOFF create-game error:", err);
      setError(err.message || "We couldn't create your game.");
    } finally {
      setSaving(false);
    }
  }

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

    if (
      (participantCounts[game.id] || 0) >= game.max_players
    ) {
      setError("This game is full.");
      return;
    }

    setJoiningGameId(game.id);

    try {
      const { data, error: joinError } = await supabase.rpc(
        "join_game",
        { p_game_id: game.id }
      );

      if (joinError) throw joinError;

      if (data && data.success === false) {
        throw new Error(
          data.message || "Unable to join this game."
        );
      }

      setNotice("You're in! See you on the pitch. ⚽");

      await loadData();
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

  function GameCard({ game, index = 0 }) {
    const venue = venueFor(game);
    const count = participantCounts[game.id] || 0;
    const full = count >= game.max_players;
    const joined = myGameIds.includes(game.id);
    const organizer = game.organiser_id === user.id;
    const isJoining = joiningGameId === game.id;

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
            <span className="status-dot" /> OPEN MATCH
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
              ♟ {count}/{game.max_players} players
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

          <div className="game-footer">
            <div className="price">
              <strong>
                ₹
                {(
                  (game.price_per_player_paise || 0) / 100
                ).toLocaleString("en-IN")}
              </strong>

              <small> / player</small>
            </div>

            <button
              className={`game-action ${
                joined || organizer ? "game-action-muted" : ""
              }`}
              disabled={
                isJoining || (!organizer && !joined && full)
              }
              onClick={() => joinGame(game)}
            >
              {isJoining
                ? "Joining…"
                : organizer
                ? "Your game"
                : joined
                ? "✓ Joined"
                : full
                ? "Game full"
                : "Join game ↗"}
            </button>
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

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const pageTitle = {
    home: "Your pitch. Your people.",
    games: "Find your next game.",
    "my-games": "Your football calendar.",
    turfs: "Find your next turf.",
    profile: "Your player card.",
  }[page];

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

              {item.id === "my-games" &&
                myGames.length > 0 && (
                  <span className="nav-count">
                    {myGames.length}
                  </span>
                )}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-promo">
          <div className="promo-ball">⚽</div>
          <strong>Game on.</strong>
          <p>Good people. Great football. No excuses.</p>

          <button onClick={() => setShowForm(true)}>
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
            onClick={onLogout}
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

          <button className="mobile-logout" onClick={onLogout}>
            Log out ↗
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
                      onClick={() => setShowForm(true)}
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
                    {games
                      .slice(0, 3)
                      .map((game, index) => (
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
                          onClick={() => setShowForm(true)}
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
                  onClick={() => setShowForm(true)}
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
                        onClick={() => setShowForm(true)}
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

          {page === "profile" && (
            <section className="content-section page-section">
              <div className="section-heading">
                <div>
                  <div className="section-eyebrow">PLAYER ID</div>

                  <h1>
                    {pageTitle}<span>.</span>
                  </h1>

                  <p>
                    Your KICKOFF account and football activity.
                  </p>
                </div>
              </div>

              <div className="profile-panel">
                <div className="profile-cover">
                  <span>KICKOFF PLAYER</span>

                  <div className="profile-big-avatar">
                    {initials || "P"}
                  </div>
                </div>

                <div className="profile-details">
                  <div>
                    <div className="section-eyebrow">
                      PLAYER NAME
                    </div>
                    <h2>{displayName}</h2>
                  </div>

                  <div>
                    <div className="section-eyebrow">
                      EMAIL ADDRESS
                    </div>
                    <p>{user.email}</p>
                  </div>

                  <div className="profile-metrics">
                    <div>
                      <strong>{myGames.length}</strong>
                      <span>Your matches</span>
                    </div>

                    <div>
                      <strong>{games.length}</strong>
                      <span>Open games</span>
                    </div>

                    <div>
                      <strong>{venues.length}</strong>
                      <span>Active venues</span>
                    </div>
                  </div>

                  <button
                    className="outline-dark-button"
                    onClick={onLogout}
                  >
                    Log out ↗
                  </button>
                </div>
              </div>
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
                : "Home"}
            </small>
          </button>
        ))}
      </nav>

      {showForm && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              !saving
            ) {
              setShowForm(false);
            }
          }}
        >
          <form className="game-form" onSubmit={createGame}>
            <div className="form-heading">
              <div>
                <div className="section-eyebrow">
                  BRING YOUR SQUAD
                </div>

                <h2>
                  Organise a game<span>.</span>
                </h2>

                <p>
                  Set the details. We'll bring the players.
                </p>
              </div>

              <button
                type="button"
                className="close-button"
                disabled={saving}
                onClick={() => setShowForm(false)}
              >
                ×
              </button>
            </div>

            <label>
              Game name
              <input
                name="title"
                placeholder="e.g. Friday Night Football"
                maxLength={150}
                required
              />
            </label>

            <label>
              Venue
              <select name="venue_id" defaultValue="">
                <option value="">Venue to be confirmed</option>

                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                    {venue.city ? ` — ${venue.city}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-two-columns">
              <label>
                Date
                <input
                  name="date"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
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
                <select name="format" defaultValue="7-a-side">
                  <option>5-a-side</option>
                  <option>7-a-side</option>
                  <option>9-a-side</option>
                  <option>11-a-side</option>
                </select>
              </label>
            </div>

            <div className="form-two-columns">
              <label>
                Price per player (₹)
                <input
                  name="price"
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  defaultValue="200"
                  required
                />
              </label>

              <label>
                Total player spots
                <input
                  name="total"
                  type="number"
                  min="2"
                  max="50"
                  defaultValue="14"
                  required
                />
              </label>
            </div>

            <p className="form-note">
              This publishes a community match. It does not reserve
              a turf or collect payments.
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
    </div>
  );
}