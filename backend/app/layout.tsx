import './public.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nuudeltsgeey · Mongolian CS2 Competitive Platform',
  icons: { icon: '/favicon.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
