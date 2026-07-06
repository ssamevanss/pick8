import type { Metadata } from "next";
import { ToastProvider } from "@/components/toast/ToastProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Who You Got?",
  description: "Private football prediction league",
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
