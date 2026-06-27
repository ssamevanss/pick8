import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Predictor",
  description: "Private football score prediction league",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}