import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl = new URL(`${protocol}://${host}`);
  return {
    metadataBase: baseUrl,
    title: "Codex Board",
    description: "A private command center for coding tasks, repositories, and Codex threads.",
    openGraph: {
      title: "Codex Board",
      description: "A private command center for coding tasks, repositories, and Codex threads.",
      type: "website",
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1536, height: 1024, alt: "Codex Board developer dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Codex Board",
      description: "A private command center for coding tasks, repositories, and Codex threads.",
      images: [new URL("/og.png", baseUrl).toString()],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
