import { useState } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiError } from "@/admin/api";
import { useAdminAuth } from "@/admin/AuthContext";
import { Field, InlineNotice, LoadingState, useAdminTitle } from "@/admin/components/AdminUI";

function getReturnPath(location) {
  const from = location.state?.from;
  const isAdminPath = typeof from === "string" && (from === "/admin" || from.startsWith("/admin/"));
  return isAdminPath && from !== "/admin/login" ? from : "/admin/dashboard";
}

export default function LoginPage() {
  useAdminTitle("Sign in");
  const location = useLocation();
  const navigate = useNavigate();
  const { status, error: bootstrapError, login } = useAdminAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);
  const returnPath = getReturnPath(location);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;

    setBusy(true);
    setSubmitError(null);
    try {
      await login({ username: username.trim(), password });
      toast.success("Signed in to Suvi Invoice Desk.");
      navigate(returnPath, { replace: true });
    } catch (error) {
      setSubmitError(apiError(error, "We couldn't sign you in. Check your details and try again."));
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="admin-login admin-login--loading">
        <div className="admin-login__loading">
          <ShieldCheck aria-hidden="true" />
          <LoadingState label="Checking your secure session…" />
        </div>
      </main>
    );
  }

  if (status === "authenticated") {
    return <Navigate to={returnPath} replace />;
  }

  return (
    <main className="admin-login">
      <div className="admin-login__shell">
        <section className="admin-login__welcome" aria-labelledby="admin-login-welcome-title">
          <div className="admin-login__brand">
            <span className="admin-login__brand-mark" aria-hidden="true">S</span>
            <div>
              <strong>Suvi Interior</strong>
              <span>Invoice desk</span>
            </div>
          </div>

          <div className="admin-login__welcome-copy">
            <p className="admin-eyebrow">Private workspace</p>
            <h2 id="admin-login-welcome-title">A focused desk for billing, collections, and compliance.</h2>
            <p>Manage customers, prepare GST invoices, record payments, and keep a clear operational trail in one secure place.</p>
          </div>

          <ul className="admin-login__assurances" aria-label="Workspace protections">
            <li><ShieldCheck aria-hidden="true" /><span><strong>Restricted access</strong>Only authorized team members can enter.</span></li>
            <li><LockKeyhole aria-hidden="true" /><span><strong>Private by design</strong>Session recording is disabled in this workspace.</span></li>
            <li><UserRoundCheck aria-hidden="true" /><span><strong>Accountable actions</strong>Important invoice activity is recorded for review.</span></li>
          </ul>
        </section>

        <section className="admin-login__panel" aria-labelledby="admin-login-title">
          <div className="admin-login__form-wrap">
            <div className="admin-login__heading">
              <span className="admin-login__lock" aria-hidden="true"><LockKeyhole /></span>
              <p className="admin-eyebrow">Authorized access</p>
              <h1 id="admin-login-title">Sign in to Invoice Desk</h1>
              <p>Use your assigned workspace credentials to continue.</p>
            </div>

            {bootstrapError ? (
              <div className="admin-login__notice" role="status">
                <InlineNotice tone="warning" title="Session check unavailable">
                  <p>{bootstrapError.message} You can still try to sign in below.</p>
                </InlineNotice>
              </div>
            ) : null}

            {submitError ? (
              <div className="admin-login__notice" role="alert" aria-live="assertive">
                <InlineNotice tone="error" title="Sign-in failed">
                  <p>{submitError.message}</p>
                  {submitError.errors?.length ? (
                    <ul className="admin-login__errors">
                      {submitError.errors.slice(0, 4).map((item, index) => (
                        <li key={`${item.field || "login"}-${index}`}>{item.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </InlineNotice>
              </div>
            ) : null}

            <form className="admin-login__form" onSubmit={handleSubmit} aria-busy={busy}>
              <Field label="Username" required>
                <input
                  className="admin-input"
                  type="text"
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  disabled={busy}
                  required
                  autoFocus
                />
              </Field>

              <div className="admin-field">
                <label className="admin-field__label" htmlFor="admin-login-password">Password<em> *</em></label>
                <span className="admin-password-input">
                  <input
                    id="admin-login-password"
                    className="admin-input admin-password-input__control"
                    type={passwordVisible ? "text" : "password"}
                    name="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    disabled={busy}
                    required
                  />
                  <button
                    className="admin-password-input__toggle"
                    type="button"
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    disabled={busy}
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                    aria-pressed={passwordVisible}
                  >
                    {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </span>
              </div>

              <button
                className="admin-button admin-button--primary admin-login__submit"
                type="submit"
                disabled={busy || !username.trim() || !password}
              >
                {busy ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                {busy ? "Signing in…" : "Sign in securely"}
              </button>
            </form>

            <p className="admin-login__support">Having trouble signing in? Contact the workspace administrator.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
