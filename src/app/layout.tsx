import type { Metadata } from "next";
import { Montserrat, Playfair_Display } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-playfair",
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
    <html
      lang="en"
      className={`${montserrat.variable} ${playfair.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
