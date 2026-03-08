import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import "@caldwell619/react-kanban/dist/styles.css";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const sans = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CRMnaMao Kanban",
  description: "Kanban operacional do Chatwoot conectado aos canais reais.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${display.variable} ${sans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
