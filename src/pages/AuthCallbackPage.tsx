import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { DiscordIcon } from "../components/ui";
import { buttonClass } from "../components/simulator/styles";
import { parseAuthHash, setToken, startLogin } from "../services/authService";

/**
 * /auth/callback: the API sends the browser here after Discord with `#token=…&return=…` or
 * `#auth_error=…` (a fragment, so the token never reaches a server log). Stores the token, clears
 * the fragment and goes back to where the login started.
 */
export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [result] = useState(() => (typeof window === "undefined" ? null : parseAuthHash(window.location.hash)));

  useEffect(() => {
    if (result?.kind !== "token") return;
    setToken(result.token);
    navigate(result.returnPath, { replace: true });
  }, [result, navigate]);

  useEffect(() => {
    // Never leave a token (or an error code) in the address bar or history.
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);

  if (result?.kind === "token")
    return (
      <div className="container mx-auto px-4 py-16 flex items-center justify-center gap-2 text-sm text-slate-300">
        <Loader2 className="w-4 h-4 animate-spin" /> Logging you in...
      </div>
    );

  return (
    <div className="container mx-auto px-4 py-16 max-w-md">
      <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-5 space-y-3 text-sm">
        <div className="flex items-center gap-2 text-amber-200 font-medium">
          <AlertTriangle className="w-4 h-4" /> {result?.kind === "error" ? "Login didn't work" : "Nothing to do here"}
        </div>
        <p className="text-slate-300">{result?.kind === "error" ? result.message : "This page finishes a Discord login. Start one from the leaderboard or the simulator."}</p>
        <div className="flex flex-wrap gap-2">
          {result?.kind === "error" && result.code !== "account_too_new" && (
            <button type="button" className={buttonClass.primary} onClick={() => startLogin("/flows")}>
              <DiscordIcon className="w-3.5 h-3.5" /> Try again
            </button>
          )}
          <Link to="/flows" className={buttonClass.neutral}>
            Go to the leaderboard
          </Link>
        </div>
      </div>
    </div>
  );
};
