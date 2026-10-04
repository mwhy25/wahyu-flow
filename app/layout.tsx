import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FlowBoxes - Drag & Drop Dataflow',
  description: 'Spawn info boxes, connect them, run data through AI / code.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
