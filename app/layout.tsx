import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Todo App',
  description: 'A personal workspace for your tasks.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}