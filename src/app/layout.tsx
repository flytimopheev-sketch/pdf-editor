import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Редактор PDF — слои, аннотации, JPEG → PDF",
  description:
    "Профессиональный редактор PDF: слои изменений с отменой действий, текст и подписи, поворот и обрезка, сжатие, преобразование изображений JPEG и PNG в PDF. Работает офлайн.",
  authors: [{ name: "flytimopheev", url: "https://github.com/flytimopheev-sketch" }],
  icons: {
    icon: "/logo-new2.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
