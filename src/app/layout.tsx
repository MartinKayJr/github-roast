import type { Metadata } from "next";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://githubroast.icu"),
  title: "毒舌 GitHub 评分 · githubroast.icu",
  description:
    "输入 GitHub 账号，30 秒得到一份 0-100 分的价值与信任评分，外加一句扎心的毒舌点评。专治刷量号、AI 机器人、收藏夹开发者。githubroast.icu",
  openGraph: {
    title: "毒舌 GitHub 评分 · githubroast.icu",
    description:
      "输入 GitHub 账号，30 秒得到 0-100 分的价值与信任评分 + 一句扎心毒舌点评。来测测你的含金量。",
    url: "https://githubroast.icu",
    siteName: "毒舌 GitHub 评分",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "毒舌 GitHub 评分 · githubroast.icu",
    description: "输入 GitHub 账号，30 秒出分 + 毒舌点评。来测测你的含金量。",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
