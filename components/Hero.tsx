"use client";

import styles from "./Hero.module.css";

export default function Hero() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>¡Hola, mundo! 🚀</h1>
      <p className={styles.description}>
        Esta es una página de ejemplo, lista para desplegarse en Vercel.
        Editá este archivo para hacer tu primer cambio.
      </p>
      <button
        className={styles.toggleButton}
        onClick={() => {
          document.body.style.background = "#1e293b";
        }}
      >
        Cambiar fondo
      </button>
    </main>
  );
}
