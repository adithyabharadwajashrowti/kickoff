import { useState } from "react";
import { supabase } from "./supabase";

// Turns a guest (anonymous) account into a permanent email + password
// account. The user ID stays the same, so games, payments and the
// player card stay attached.
//
// Flow:
//   1. Guest enters email  -> Supabase sends a confirmation email.
//   2. Guest clicks the link in the email.
//   3. Back in KICKOFF, they set a password.
//   4. From now on they can log in from any device with email + password.

export default function SecureAccount({ user }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const isGuest = Boolean(user.is_anonymous);
  const pendingEmail = user.new_email || "";
  const hasPassword = Boolean(user.user_metadata?.has_password);

  let stage = "done";
  if (isGuest && !pendingEmail) stage = "enter-email";
  else if (isGuest && pendingEmail) stage = "check-inbox";
  else if (!hasPassword) stage = "set-password";

  function showResult(text, failed = false) {
    setMessage(text);
    setIsError(failed);
  }

  async function sendConfirmation(event) {
    event?.preventDefault();
    const cleanEmail = (email || pendingEmail).trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      showResult("Please enter a valid email address.", true);
      return;
    }

    setBusy(true);
    showResult("");

    const { error } = await supabase.auth.updateUser(
      { email: cleanEmail },
      { emailRedirectTo: window.location.origin }
    );

    setBusy(false);

    if (error) {
      console.error("KICKOFF secure-account email error:", error);
      showResult(error.message || "Couldn't send the email.", true);
      return;
    }

    showResult(
      `Confirmation email sent to ${cleanEmail}. Open it and click the link.`
    );
  }

  async function checkConfirmed() {
    setBusy(true);
    showResult("");

    // Fetch a fresh session so the app sees the confirmed email.
    const { data, error } = await supabase.auth.refreshSession();

    setBusy(false);

    if (error) {
      showResult(error.message || "Couldn't check right now.", true);
      return;
    }

    if (data?.user?.is_anonymous) {
      showResult(
        "Not confirmed yet. Click the link in the email, then try again.",
        true
      );
    }
  }

  async function savePassword(event) {
    event.preventDefault();

    if (password.length < 8) {
      showResult("Use at least 8 characters for your password.", true);
      return;
    }

    if (password !== confirmPassword) {
      showResult("The two passwords don't match.", true);
      return;
    }

    setBusy(true);
    showResult("");

    const { error } = await supabase.auth.updateUser({
      password,
      data: { has_password: true },
    });

    setBusy(false);

    if (error) {
      console.error("KICKOFF secure-account password error:", error);
      showResult(error.message || "Couldn't save the password.", true);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    showResult("Password saved. Your host account is secure.");
  }

  return (
    <section className="profile-account-panel secure-account-panel">
      <div className="profile-account-copy secure-account-copy">
        <div className="section-eyebrow">HOST ACCOUNT</div>

        {stage === "enter-email" && (
          <>
            <h2>Secure your account to host games</h2>
            <p>
              You're on a guest account. Add an email and password so you
              can log back in from any device and keep managing your games
              and payments.
            </p>

            <form className="secure-account-form" onSubmit={sendConfirmation}>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              <button className="lime-button" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send confirmation email"}
              </button>
            </form>
          </>
        )}

        {stage === "check-inbox" && (
          <>
            <h2>Check your inbox</h2>
            <p>
              We sent a confirmation link to <strong>{pendingEmail}</strong>.
              Click it, then come back here.
            </p>

            <div className="secure-account-form">
              <button
                className="lime-button"
                type="button"
                onClick={checkConfirmed}
                disabled={busy}
              >
                {busy ? "Checking…" : "I've confirmed my email"}
              </button>
              <button
                className="secure-account-link"
                type="button"
                onClick={() => sendConfirmation()}
                disabled={busy}
              >
                Resend email
              </button>
            </div>
          </>
        )}

        {stage === "set-password" && (
          <>
            <h2>Set your password</h2>
            <p>
              Email confirmed: <strong>{user.email}</strong>. Choose a
              password to finish securing your account.
            </p>

            <form className="secure-account-form" onSubmit={savePassword}>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="New password (8+ characters)"
                autoComplete="new-password"
                required
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
                required
              />
              <button className="lime-button" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save password"}
              </button>
            </form>
          </>
        )}

        {stage === "done" && (
          <>
            <h2>Host account secured ✓</h2>
            <p>
              Log in on any device with <strong>{user.email}</strong> using
              "Organiser login".
            </p>
          </>
        )}

        {message && (
          <small
            className={isError ? "secure-account-error" : "secure-account-ok"}
            role={isError ? "alert" : "status"}
          >
            {message}
          </small>
        )}
      </div>
    </section>
  );
}
