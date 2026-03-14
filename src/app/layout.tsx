import type { Metadata } from "next";
import "@caldwell619/react-kanban/dist/styles.css";
import "./globals.css";

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
