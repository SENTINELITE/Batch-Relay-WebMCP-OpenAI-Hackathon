import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Batch Relay — Print workbench",
  description: "Prepare a real Batch Relay sandbox print order from the public API.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
