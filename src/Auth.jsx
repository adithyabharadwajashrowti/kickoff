import { useState } from "react";
import { supabase } from "./supabase";
import "./Auth.css";

export default function Auth({ onLogin }) {
  // "player"    = quick guest signup with name + mobile (unchanged)
  // "organiser" = email + password login for secured host accounts
  const [mode, setMode] = useState("player");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(nextMode) {
    setMode(nextMode);
    setMessage("");
  }

  async function handlePlayerSubmit(event) {
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

  async function handleForgotPassword() {
    setMessage("");
    const cleanEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setMessage("Type your email above first, then tap Forgot password.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: window.location.origin,
    });

    setLoading(false);

    if (error) {
      console.error("KICKOFF password reset error:", error);
      setMessage(error.message || "Couldn't send the reset email.");
      return;
    }

    setMessage(
      `If ${cleanEmail} has a host account, a reset link is on its way. Check your inbox and spam.`
    );
  }

  async function handleOrganiserSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (!cleanEmail || !password) {
        throw new Error("Enter your email and password.");
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        if (error.message?.toLowerCase().includes("invalid login")) {
          throw new Error(
            "Wrong email or password. New hosts: join as a player first, then secure your account on My profile."
          );
        }
        throw error;
      }

      if (onLogin && data.user) {
        onLogin(data.user);
      }
    } catch (error) {
      console.error("KICKOFF organiser login error:", error);
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

        <h1>
          {mode === "player" ? "Let's get you playing." : "Welcome back, host."}
        </h1>

        <p className="auth-subtitle">
          {mode === "player"
            ? "Join your football community. Find your squad. Get out there and play."
            : "Log in with the email and password you set on your profile."}
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "player"}
            className={mode === "player" ? "selected" : ""}
            onClick={() => switchMode("player")}
          >
            New player
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "organiser"}
            className={mode === "organiser" ? "selected" : ""}
            onClick={() => switchMode("organiser")}
          >
            Organiser login
          </button>
        </div>

        {mode === "player" ? (
          <form onSubmit={handlePlayerSubmit}>
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
        ) : (
          <form onSubmit={handleOrganiserSubmit}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                required
                autoComplete="current-password"
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
              {loading ? "Logging in..." : "Log in →"}
            </button>

            <button
              type="button"
              className="auth-link-button"
              onClick={handleForgotPassword}
              disabled={loading}
            >
              Forgot password?
            </button>
          </form>
        )}

        <p className="auth-footer">
          {mode === "player"
            ? "No email. No password. No OTP. Your mobile number is not verified."
            : "Hosting for the first time? Join as a player, then secure your account on My profile."}
        </p>
      </section>
    </main>
  );
}

// Shown after a host opens the password-reset link from their email.
export function ResetPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (password.length < 8) {
      setMessage("Use at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("The two passwords don't match.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
      data: { has_password: true },
    });

    setLoading(false);

    if (error) {
      console.error("KICKOFF set new password error:", error);
      setMessage(error.message || "Couldn't save the new password.");
      return;
    }

    onDone?.();
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          ⚽ KICK<span>OFF</span>
        </div>

        <div className="auth-label">HOST ACCOUNT</div>

        <h1>Set a new password.</h1>

        <p className="auth-subtitle">
          Choose a new password for your host account.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8+ characters"
              autoComplete="new-password"
              required
            />
          </label>

          <label>
            Repeat new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          {message && (
            <div className="auth-message" role="alert">
              {message}
            </div>
          )}

          <button className="auth-submit" disabled={loading} type="submit">
            {loading ? "Saving..." : "Save new password →"}
          </button>
        </form>
      </section>
    </main>
  );
}
