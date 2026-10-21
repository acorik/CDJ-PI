import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { useAuthStore } from "./store/auth";
import { api, setUnauthorizedHandler } from "./api/client";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthenticated(false));
    api
      .post("/auth/refresh")
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setChecked(true));
  }, [setAuthenticated]);

  if (!checked) return null;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
