import EntornoPersonalClient from '../entorno-personal/EntornoPersonalClient';

export const metadata = {
  title: 'Registrar entorno personal',
};

export default function EntornoPersonalPage() {
  return (
    <main className="min-h-screen bg-[#ffe3cf] flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg p-6">
        <h1 className="text-center text-2xl font-extrabold text-[#b74b1e] mb-1">
          GRUPO INMOBILIARIO REALTY
        </h1>
        <p className="text-center text-lg text-[#b74b1e] mb-6">
          Registro de entorno personal
        </p>

        <EntornoPersonalClient />
      </div>
    </main>
  );
}