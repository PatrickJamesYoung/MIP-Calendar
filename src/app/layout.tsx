import type { Metadata } from "next";
import { Work_Sans } from "next/font/google";
import "./globals.css";

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-work-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Movement Calendar — Movement Infrastructure Project",
  description:
    "A resource for our community, to help people find ways to plug into actions and events, support organizers in getting the word out, and compile important dates in our political and economic landscape.",
  openGraph: {
    title: "MIP Movement Calendar",
    description: "Grassroots actions and events, Congressional & SCOTUS schedules, and major political timelines.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={workSans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
