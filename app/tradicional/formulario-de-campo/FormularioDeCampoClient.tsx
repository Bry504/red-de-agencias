// app/tradicional/formulario-de-campo/FormularioDeCampoClient.tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';

export default function FormularioDeCampoClient() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usuarioId, setUsuarioId] = useState<string | null | undefined>(
    undefined
  );

  // Leer ?t=... desde la URL en el CLIENTE
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('t');
      setUsuarioId(t);
    } catch (e) {
      console.error('Error leyendo search params:', e);
      setUsuarioId(null);
    }
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    if (!usuarioId) {
      setError('Link inválido: falta el identificador de usuario (t).');
      return;
    }

    const formData = new FormData(e.currentTarget);

    const nombre = (formData.get('nombre') as string)?.trim();
    const apellido = (formData.get('apellido') as string)?.trim();
    const celular = (formData.get('celular') as string)?.trim();

    if (!nombre || !apellido || !celular) {
      setError('Nombre, apellido y celular son obligatorios.');
      return;
    }

    const celularClean = celular.replace(/\D/g, '');
    if (!/^9\d{8}$/.test(celularClean)) {
      setError('El celular debe ser peruano: 9 dígitos y empezar en 9.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/tradicional/campo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuarioId,
          lugarProspeccion: formData.get('lugarProspeccion') || null,
          nombre,
          apellido,
          celular: celularClean,
          documentoIdentidad: formData.get('documentoIdentidad') || null,
          email: formData.get('email') || null,
          proyectoInteres: formData.get('proyectoInteres') || null,
          presupuesto: formData.get('presupuesto') || null,
          modalidadPago: formData.get('modalidadPago') || null,
          comentarios: formData.get('comentarios') || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(
          json.error ||
            'Error al registrar el prospecto, contáctese con Bryant Huamaní.'
        );
      } else {
        setMsg('Prospecto registrado correctamente.');
        (e.target as HTMLFormElement).reset();
      }
    } catch (err) {
      console.error('Error en submit:', err);
      setError('Error de conexión.');
    } finally {
      setLoading(false);
    }
  };

  // Mientras aún no sabemos el valor de t (primer render)
  if (usuarioId === undefined) {
    return (
      <main
        className="min-h-screen flex items-center justify-center bg-[#fde9d9]"
        style={{ fontFamily: '"Times New Roman", Times, serif' }}
      >
        <p>Cargando formulario...</p>
      </main>
    );
  }

  // Ya leímos la URL y NO hay t
  if (!usuarioId) {
    return (
      <main
        className="min-h-screen flex items-center justify-center bg-[#fde9d9]"
        style={{ fontFamily: '"Times New Roman", Times, serif' }}
      >
        <p>
          Link inválido. Falta el parámetro <code>t</code>.
        </p>
      </main>
    );
  }

  // Todo OK: mostramos el formulario
  return (
  <main
    className="min-h-screen flex flex-col items-center justify-start bg-[#fde9d9] px-4 pt-6 pb-10"
    style={{ fontFamily: '"Times New Roman", Times, serif' }}
  >
    {/* TÍTULOS FUERA DEL CUADRO */}
    <div className="text-center mb-4">
      <h1 className="text-3xl sm:text-4xl font-bold text-[#d4551f]">
        REALTY GRUPO INMOBILIARIO
      </h1>
      <h2 className="text-lg sm:text-xl mt-1 text-[#b1451b]">
        Registro de prospectos de campo
      </h2>
    </div>

    {/* FORMULARIO EN EL CUADRO BLANCO */}
    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg p-6 sm:p-8 my-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Lugar de prospección */}
        <div>
          <label className="block font-semibold mb-1 text-black">
            Lugar de prospección
          </label>
          <input
            name="lugarProspeccion"
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2"
            placeholder="Ej: Jockey Plaza, Mercado Unicachi, Centro de Lima, etc."
          />
        </div>

        {/* Nombre */}
        <div>
          <label className="block font-semibold mb-1 text-black">
            Nombre <span className="text-red-500">*</span>
          </label>
          <input
            name="nombre"
            required
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2"
          />
        </div>

        {/* ... EL RESTO DEL FORMULARIO SE MANTIENE IGUAL ... */}

        {error && <p className="text-red-600">{error}</p>}
        {msg && <p className="text-green-600">{msg}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#d4551f] hover:bg-[#b1451b] text-white font-semibold py-2 rounded-md disabled:opacity-60"
        >
          {loading ? 'REGISTRANDO...' : 'REGISTRAR'}
        </button>
      </form>
    </div>
  </main>
);
}