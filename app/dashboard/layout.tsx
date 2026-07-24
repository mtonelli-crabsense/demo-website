import { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import styles from "./layout.module.css";

// Scoped to the dashboard subtree (not the root layout) so the public
// marketing landing page never pays for fonts it doesn't use.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} ${styles.shell}`}>
      <Sidebar />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
