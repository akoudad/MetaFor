import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "metafor",
  description: "Explore a conversation. Keep your place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
