// app/tradicional/formulario-de-campo/page.tsx
import { Suspense } from 'react';
import FormularioDeCampoClient from './FormularioDeCampoClient';

export default function Page() {
  return (
    <Suspense
      fallback={
        <main
          className="min-h-screen flex items-center justify-center bg-[#fde9d9]"
          style={{ fontFamily: '"Times New Roman", Times, serif' }}
        >
          <p>Cargando formulario...</p>
        </main>
      }
    >
      <FormularioDeCampoClient />
    </Suspense>
  );
}