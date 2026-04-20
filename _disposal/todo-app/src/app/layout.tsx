import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/Navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ToDo App",
  description: "日々の業務管理アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${inter.className} bg-gray-50 min-h-screen pb-[72px] md:pb-0`}>
        <Navigation />
        <main className="container mx-auto max-w-2xl p-4 sm:p-6 pb-24 md:pb-12">
          {children}
        </main>
      </body>
    </html>
  );
}

