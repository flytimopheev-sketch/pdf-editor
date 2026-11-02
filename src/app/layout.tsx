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
  authors: [{ name: "Редактор PDF" }],
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-128.png", sizes: "128x128", type: "image/png" },
      { url: "/app-icon.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

/** Применяет сохранённую тему до гидрации — без мигания */
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("pdf-editor-theme");
    if (!t) return;
    var classes = document.documentElement.classList;
    if (t === "dark") { classes.add("dark"); }
    else if (t && t !== "light") { classes.add("theme-" + t); }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
