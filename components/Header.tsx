"use client";

import { useState } from "react";
import styles from "./Header.module.css";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.header}>
      <a href="#" className={styles.logo}>
        Ejemplo Co.
      </a>
      <nav className={styles.nav}>
        <ul className={`${styles.navLinks} ${menuOpen ? styles.open : ""}`}>
          <li>
            <a href="#inicio">Inicio</a>
          </li>
          <li>
            <a href="#servicios">Servicios</a>
          </li>
          <li>
            <a href="#contacto">Contacto</a>
          </li>
        </ul>
        <a
          href="#contacto"
          className={`${styles.ctaButton} ${styles.desktopOnly}`}
        >
          Empezar ahora!
        </a>
        <button
          className={styles.menuToggle}
          aria-label="Abrir menú"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </nav>
    </header>
  );
}
