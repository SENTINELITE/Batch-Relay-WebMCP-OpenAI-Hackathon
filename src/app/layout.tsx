import type { Metadata } from "next";
import { Barlow_Semi_Condensed, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Agentation } from "agentation";

import { ActivityToaster } from "@/components/storefront/activity-toaster";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { themePreferenceBootstrapScript } from "@/lib/theme/theme-preference";
import "./globals.css";

const generalSans = localFont({
  src: "../fonts/GeneralSans-Variable.woff2",
  variable: "--font-general-sans",
  weight: "200 700",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const barlowSemiCondensed = Barlow_Semi_Condensed({
  subsets: ["latin"],
  variable: "--font-barlow-semi-condensed",
  weight: "700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Batch Relay",
  description: "Prepare a real Batch Relay sandbox print order from the public API.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${generalSans.variable} ${geistMono.variable} ${barlowSemiCondensed.variable}`} lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themePreferenceBootstrapScript }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
          {/* Inside the provider: the toaster reads the resolved theme. */}
          <ActivityToaster />
        </ThemeProvider>
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
