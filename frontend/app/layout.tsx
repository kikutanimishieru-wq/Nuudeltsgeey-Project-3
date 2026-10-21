import './globals.css';
import './demo.css';
import './onboarding.css';
import MockAuthProvider from '@/components/onboarding/MockAuthProvider';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nuudeltsgeey — Competitive Arena',
  description: 'Nuudeltsgeey visual frontend preview',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><MockAuthProvider>{children}</MockAuthProvider></body></html>;
}
