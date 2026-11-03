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

export default function Dashboard({ user, accessToken, onLogout }) {
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
  const [paymentGame, setPaymentGame] = useState(null);
  const [upiReference, setUpiReference] = useState("");
  const [slotQuantity, setSlotQuantity] = useState(1);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [bookingVenue, setBookingVenue] = useState(null);
  const [bookingStart, setBookingStart] = useState("");
  const [bookingHours, setBookingHours] = useState("1");
  const [bookingSaving, setBookingSaving] = useState(false);
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

      const [gamesResult, venuesResult, membershipsResult, requestsResult] =
        await Promise.all([
          supabase
            .from("games")
            .select("*")
            .eq("status", "open")
            .gte("starts_at", now)
            .order("starts_at", { ascending: true }),

          supabase
            .from("venues")
            .select("id, name, city, address, hourly_rate_paise")
            .eq("status", "active")
            .order("name"),

          supabase
            .from("game_participants")
            .select("game_id, status, slots_count")
            .eq("player_id", user.id)
            .eq("status", "joined"),

          supabase
            .from("game_payment_requests")
            .select("id, game_id, player_id, amount_paise, slots_count, upi_reference, status, reviewed_by, reviewed_at, review_note, created_at")
            .order("created_at", { ascending: false }),
        ]);

      if (gamesResult.error) throw gamesResult.error;
      if (venuesResult.error) throw venuesResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      if (requestsResult.error) throw requestsResult.error;
      setPaymentRequests(requestsResult.data || []);

      const loadedGames = gamesResult.data || [];

      setGames(loadedGames);
      setVenues(venuesResult.data || []);
      setMyGameIds(
        (membershipsResult.data || []).map((item) => item.game_id)
      );