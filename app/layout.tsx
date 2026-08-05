import type { Metadata } from "next";
import { ToastProvider } from "@/components/toast/ToastProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pick8",
  description: "A private Premier League matchday prediction competition",
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
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
