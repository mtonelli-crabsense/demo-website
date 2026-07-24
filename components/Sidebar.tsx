"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

const SHEETS = [
  { href: "/dashboard/resumen-ejecutivo", label: "Resumen Ejecutivo" },
  { href: "/dashboard/articulos", label: "Artículos" },
  { href: "/dashboard/tematicas", label: "Temáticas" },
  { href: "/dashboard/podcast-video", label: "Podcast/Video" },
  { href: "/dashboard/audiencia", label: "Audiencia" },
  { href: "/dashboard/retencion", label: "Retención" },
  { href: "/dashboard/inventario-publicitario", label: "Inventario Publicitario" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.brandMark}>Perspectivas · Cohen</div>
        <div className={styles.brandSub}>Tablero GA4</div>
      </div>

      <nav className={styles.nav}>
        {SHEETS.map((sheet) => {
          const isActive = pathname?.startsWith(sheet.href);
          return (
            <Link
              key={sheet.href}
              href={sheet.href}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
            >
              {sheet.label}
            </Link>
          );
        })}
      </nav>

      <div className={styles.sidebarFoot}>Conectado a GA4 en vivo.</div>
    </aside>
  );
}
