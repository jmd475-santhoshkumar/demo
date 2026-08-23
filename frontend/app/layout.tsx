import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import { UploadManagerWidget } from "@/components/layout/UploadManagerWidget";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JMAN | ResourceIQ",
  description:
    "The resourcing co-pilot for JMAN -- evidence-driven staffing, forecasting, and health monitoring.",
  icons: { icon: "/favicon_logo.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <AppShell>{children}</AppShell>
          <UploadManagerWidget />
        </Providers>

        <Script id="ms-clarity" strategy="afterInteractive">
          {`    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "xelvukajst");`}
        </Script>
      </body>
    </html>
  );
}