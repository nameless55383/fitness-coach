import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Fitness Coach AI",
  description: "Supabase-backed AI fitness coach chatbot"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}

