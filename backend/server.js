
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();

const PORT = Number(process.env.KICKOFF_BACKEND_PORT || 6300);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KICKPAY_URL = (
  process.env.KICKPAY_BASE_URL || "http://127.0.0.1:6200"
).replace(/\/+$/, "");
const KICKPAY_KEY = process.env.KICKPAY_MERCHANT_API_KEY;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "UP",
    service: "kickoff-backend",
  });
});

function requireConfig() {
  const missing = [];

  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_KEY) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!KICKPAY_KEY) missing.push("KICKPAY_MERCHANT_API_KEY");

  if (missing.length) {
    throw new Error(
      `Missing backend configuration: ${missing.join(", ")}`,
    );
  }
}

function isValidDate(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value)) &&
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  );
}

function getUserSupabaseClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

async function createKickpaySession(booking) {
  const response = await fetch(
    `${KICKPAY_URL}/api/v1/payment-sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kickpay-Api-Key": KICKPAY_KEY,
        "Idempotency-Key": `booking-${booking.id}`,
      },
      body: JSON.stringify({
        merchantOrderId: booking.id,
        amountPaise: booking.amount_paise,
      }),
      signal: AbortSignal.timeout(8000),
    },
  );

  const payment = await response.json().catch(() => null);

  if (!response.ok || !payment?.paymentId) {
    const error = new Error("KICKPAY_SESSION_CREATION_FAILED");
    error.code = "KICKPAY_SESSION_CREATION_FAILED";
    throw error;
  }

  // Validate the returned session before attaching it.
  if (
    payment.merchantOrderId !== booking.id ||
    payment.amountPaise !== booking.amount_paise ||
    payment.currency !== "INR"
  ) {
    const error = new Error("KICKPAY_SESSION_MISMATCH");
    error.code = "KICKPAY_SESSION_MISMATCH";
    throw error;
  }

  return payment;
}

async function attachPaymentSession(supabase, booking, payment) {
  const { data, error } = await supabase.rpc(
    "attach_payment_session",
    {
      p_booking_id: booking.id,
      p_payment_session_id: payment.paymentId,
    },
  );

  if (error || data !== true) {
    console.error(
      "Payment session linking failed:",
      error?.message || "Unexpected RPC response",
    );

    const linkError = new Error("PAYMENT_SESSION_LINK_FAILED");
    linkError.code = "PAYMENT_SESSION_LINK_FAILED";
    throw linkError;
  }
}

app.post("/api/bookings", async (req, res) => {
  let bookingId;

  try {
    requireConfig();

    const authHeader = req.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        error: "AUTHENTICATION_REQUIRED",
      });
    }

    const token = match[1];
    const supabase = getUserSupabaseClient(token);

    const { data: userResult, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !userResult?.user) {
      return res.status(401).json({
        error: "INVALID_SESSION",
      });
    }

    const { venueId, startsAt, endsAt } = req.body ?? {};

    if (
      typeof venueId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(venueId) ||
      !isValidDate(startsAt) ||
      !isValidDate(endsAt) ||
      Date.parse(endsAt) <= Date.parse(startsAt)
    ) {
      return res.status(400).json({
        error: "INVALID_BOOKING_REQUEST",
        message:
          "Provide a valid venue ID and start/end timestamps with time zones.",
      });
    }

    // Supabase calculates the price and creates the pending booking.
    const { data: bookingData, error: bookingError } =
      await supabase.rpc("create_turf_booking", {
        p_venue_id: venueId,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
      });

    if (bookingError) {
      console.error(
        "Booking creation rejected:",
        bookingError.message,
      );

      return res.status(409).json({
        error: "BOOKING_CREATION_FAILED",
        message: bookingError.message,
      });
    }

    const booking = Array.isArray(bookingData)
      ? bookingData[0]
      : bookingData;

    if (
      !booking?.id ||
      booking.user_id !== userResult.user.id ||
      !Number.isInteger(booking.amount_paise) ||
      booking.amount_paise <= 0 ||
      booking.status !== "PENDING_PAYMENT"
    ) {
      console.error("Unexpected booking RPC response");

      return res.status(502).json({
        error: "INVALID_BOOKING_RESPONSE",
      });
    }

    bookingId = booking.id;

    let payment;

    try {
      payment = await createKickpaySession(booking);
    } catch (error) {
      console.error(
        "KICKPAY session creation failed:",
        error.code || "KICKPAY_UNAVAILABLE",
      );

      return res.status(502).json({
        error: error.code || "KICKPAY_UNAVAILABLE",
        bookingId: booking.id,
        bookingStatus: booking.status,
        message:
          "The booking is not confirmed. Check the booking status before retrying.",
      });
    }

    try {
      await attachPaymentSession(supabase, booking, payment);
    } catch {
      return res.status(502).json({
        error: "PAYMENT_SESSION_LINK_FAILED",
        bookingId: booking.id,
        bookingStatus: booking.status,
        paymentId: payment.paymentId,
        message:
          "The payment session exists but could not be linked. Do not create another booking.",
      });
    }

    return res.status(201).json({
      bookingId: booking.id,
      bookingStatus: booking.status,
      amountPaise: booking.amount_paise,
      currency: "INR",
      expiresAt: booking.expires_at,
      paymentSession: {
        paymentId: payment.paymentId,
        status: payment.status,
        currency: payment.currency,
      },
      message:
        "Payment session created and linked. Payment is not completed; no UPI checkout is configured yet.",
    });
  } catch (error) {
    console.error(
      "KICKOFF backend error:",
      error.message,
    );

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
      ...(bookingId ? { bookingId } : {}),
    });
  }
});

try {
  requireConfig();

  app.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[KICKOFF] Backend listening at http://127.0.0.1:${PORT}`,
    );
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
