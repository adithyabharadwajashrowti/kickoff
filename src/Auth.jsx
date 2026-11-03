
import { useState } from "react";
import { supabase } from "./supabase";
import "./Auth.css";

export default function Auth({ onLogin }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const cleanName = name.trim();

      // Accept a 10-digit Indian number or a number with +91.
      let digits = phone.replace(/\D/g, "");

      if (digits.startsWith("91") && digits.length === 12) {
        digits = digits.slice(2);
      }

      if (cleanName.length < 2) {
        throw new Error("Please enter your full name.");
      }

      if (!/^[6-9]\d{9}$/.test(digits)) {
        throw new Error("Please enter a valid 10-digit mobile number.");
      }

      const normalizedPhone = `+91${digits}`;

      // Create a guest account without email, password or OTP.
      const { data, error } =
        await supabase.auth.signInAnonymously({
          options: {
            data: {
              full_name: cleanName,
              display_name: cleanName,
              phone_number: normalizedPhone,
            },
          },
        });

      if (error) throw error;

      if (!data.session) {
        throw new Error("Unable to create your session. Please try again.");
      }

      // App.jsx listens for Supabase authentication changes.
      if (onLogin && data.user) {
        onLogin(data.user);
      }
    } catch (error) {
      console.error("KICKOFF registration error:", error);
      setMessage(error.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          ⚽ KICK<span>OFF</span>
        </div>

        <div className="auth-label">
          BENGALURU FOOTBALL COMMUNITY
        </div>

        <h1>Let's get you playing.</h1>

        <p className="auth-subtitle">
          Join your football community. Find your squad.
          Get out there and play.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Your full name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your name"
              minLength={2}
              maxLength={80}
              required
              autoComplete="name"
            />
          </label>

          <label>
            Mobile number
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 98765 43210"
              maxLength={15}
              required
              autoComplete="tel"
              inputMode="tel"
            />
          </label>

          {message && (
            <div className="auth-message" role="alert">
              {message}
            </div>
          )}

          <button
            className="auth-submit"
            disabled={loading}
            type="submit"
          >
            {loading ? "Joining..." : "Join KICKOFF →"}
          </button>
        </form>

        <p className="auth-footer">
          No email. No password. No OTP.
          Your mobile number is not verified.
        </p>
      </section>
    </main>
  );
}
