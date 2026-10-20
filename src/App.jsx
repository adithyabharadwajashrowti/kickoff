
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import Dashboard from "./Dashboard";

function App() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) return;

      if (error) {
        console.error("Unable to restore session:", error.message);
      }

      setSession(data?.session ?? null);
      setCheckingSession(false);
    }

    restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setCheckingSession(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout failed:", error.message);
      alert("Unable to log out. Please try again.");
    }
  }

  if (checkingSession) {
    return (
      <div className="app-loading">
        <span>⚽</span>
        <p>Loading KICKOFF...</p>
      </div>
    );
  }

  if (!session) {
    return <Auth onLogin={() => {}} />;
  }

  return (
    <Dashboard
      user={session.user}
      onLogout={handleLogout}
    />
  );
}

export default App;

