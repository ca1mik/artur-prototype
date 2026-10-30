import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ARTUR PRO | Платформа управления перевозками",
  description:
    "Telegram-бот, кабинет перевозчика, тарифный движок и управленческая панель для пассажирских и грузовых перевозок.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
