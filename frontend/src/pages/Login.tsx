import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuthStore } from "../store/auth";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiClient.login(username, password);
      setAuthenticated(true);
      navigate("/");
    } catch {
      setError("credenciales inválidas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-form">
        <h1>CDJ-PI</h1>
        <label>
          Usuario
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
