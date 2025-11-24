// app/tradicional/entorno-personal/page.tsx
import { Suspense } from 'react';
import EntornoPersonalClient from './EntornoPersonalClient';

export const metadata = {
  title: 'Registrar entorno personal',
};

// (Opcional pero recomendable si usas query params)
export const dynamic = 'force-dynamic';

export default function EntornoPersonalPage() {
  return (
    <Suspense fallback={null}>
      <EntornoPersonalClient />
    </Suspense>
  );
}