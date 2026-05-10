import type { Metadata, Viewport } from 'next';
import PolicyEngineHeader from '@/components/PolicyEngineHeader';
import './globals.css';

const TITLE = 'Energy Price Shock: Budget Impact Analysis | PolicyEngine';
const DESCRIPTION =
  'Microsimulation of UK energy price shocks and policy responses across the UK and devolved nations.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  authors: [{ name: 'PolicyEngine' }],
};

export const viewport: Viewport = {
  themeColor: '#319795',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PolicyEngineHeader />
        {children}
      </body>
    </html>
  );
}
