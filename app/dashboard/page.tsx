"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";

export default function DashboardPage() {
  const [totalViews, setTotalViews] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ga4-views")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setTotalViews(data.totalViews);
        }
      })
      .catch(() => setError("No se pudo conectar con la API de Analytics"));
  }, []);

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Dashboard</h1>
      <p className={styles.subtitle}>
        Vistas de página de los últimos 30 días
      </p>
      <div className={styles.card}>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : totalViews === null ? (
          <p className={styles.loading}>Cargando...</p>
        ) : (
          <span className={styles.count}>
            {totalViews.toLocaleString("es-AR")}
          </span>
        )}
      </div>
    </main>
  );
}
