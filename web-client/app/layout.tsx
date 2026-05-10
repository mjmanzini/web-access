import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import './theme.css';
import { ThemeProvider } from '../components/theme/ThemeProvider';
import { Toaster } from '../components/ui/Toaster';

export const metadata: Metadata = {
  title: 'Web-Access',
  description: 'Remote desktop viewer',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Web-Access' },
  icons: {
    icon: '/icons/icon-192.svg',
    apple: '/icons/icon-192.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0f1115',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
        <Script id="register-sw" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw register failed', e));
            });
          }`}
        </Script>
      </body>
    </html>
  );
}
