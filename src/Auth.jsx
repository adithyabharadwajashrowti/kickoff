
import { useState } from "react";
import { supabase } from "./supabase";
import "./Auth.css";

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() },
          },
        });

        if (error) throw error;

        if (data.session) {
          onLogin(data.session.user);
        } else {
          setMessage(
            "Account created! Check your email to confirm your account before logging in."
          );
        }
      } else {
        const { data, error } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

        if (error) throw error;
        onLogin(data.user);
      }
    } catch (error) {
      setMessage(error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <button
          className="auth-brand"
          onClick={() => window.location.reload()}
          type="button"
        >
          ⚽ KICK<span>OFF</span>
        </button>

        <div className="auth-label">BENGALURU FOOTBALL COMMUNITY</div>

        <h1>
          {mode === "login" ? "Welcome back." : "Join the community."}
        </h1>

        <p className="auth-subtitle">
          {mode === "login"
            ? "Your next game is waiting for you."
            : "Find your squad. Get out there and play."}
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "selected" : ""}
            onClick={() => {
              setMode("login");
              setMessage("");
            }}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "selected" : ""}
            onClick={() => {
              setMode("signup");
              setMessage("");
            }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <label>
              Your name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                minLength={1}
                maxLength={80}
                required
                autoComplete="name"
              />
            </label>
          )}

          <label>
            Email address
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
              placeholder="At least 8 characters"
              minLength={8}
              required
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>

          {message && (
            <div className="auth-message" role="status">
              {message}
            </div>
          )}

          <button className="auth-submit" disabled={loading} type="submit">
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Log in to KICKOFF →"
                : "Create my account →"}
          </button>
        </form>

        <p className="auth-footer">
          By continuing, you agree to use KICKOFF respectfully and safely.
        </p>
      </section>
    </main>
  );
}
