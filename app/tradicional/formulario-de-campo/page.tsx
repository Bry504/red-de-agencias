'use client';

import { FormEvent, useState } from 'react';

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

export default function FormularioDeCampoPage({ searchParams }: Props) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usuarioId = Array.isArray(searchParams.t)
    ? searchParams.t[0]
    : searchParams.t;

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
      const res = await fetch('/tradicional/formulario-de-campo', {
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
        setError(json.error || 'Error al registrar el prospecto.');
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

  if (!usuarioId) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Link inválido. Falta el parámetro <code>t</code>.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#fde9d9] px-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-center text-2xl font-bold text-[#b1451b]">
          REALTY GRUPO INMOBILIARIO
        </h1>
        <h2 className="text-center text-lg mt-1 mb-6 text-[#b1451b]">
          Registro de Prospectos
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block font-semibold mb-1">Lugar de prospección</label>
            <input name="lugarProspeccion" type="text" className="w-full border rounded-md px-3 py-2" />
          </div>

          <div>
            <label className="block font-semibold mb-1">Nombre *</label>
            <input name="nombre" required type="text" className="w-full border rounded-md px-3 py-2" />
          </div>

          <div>
            <label className="block font-semibold mb-1">Apellido *</label>
            <input name="apellido" required type="text" className="w-full border rounded-md px-3 py-2" />
          </div>

          <div>
            <label className="block font-semibold mb-1">Celular (Perú) *</label>
            <input name="celular" required type="text" className="w-full border rounded-md px-3 py-2" />
          </div>

          <div>
            <label className="block font-semibold mb-1">Documento de identidad</label>
            <input name="documentoIdentidad" type="text" className="w-full border rounded-md px-3 py-2" />
          </div>

          <div>
            <label className="block font-semibold mb-1">Correo electrónico</label>
            <input name="email" type="email" className="w-full border rounded-md px-3 py-2" />
          </div>

          <div>
            <label className="block font-semibold mb-1">Proyecto de interés</label>
            <input name="proyectoInteres" type="text" className="w-full border rounded-md px-3 py-2" />
          </div>

          <div>
            <label className="block font-semibold mb-1">Presupuesto</label>
            <select name="presupuesto" className="w-full border rounded-md px-3 py-2">
              <option value="">Selecciona</option>
              <option value="5000-25000">$5 000 – $25 000</option>
              <option value="25000-50000">$25 000 – $50 000</option>
              <option value="50000-100000">$50 000 – $100 000</option>
              <option value="100000-200000">$100 000 – $200 000</option>
              <option value="200000+">$200 000 a más</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Modalidad de pago</label>
            <select name="modalidadPago" className="w-full border rounded-md px-3 py-2">
              <option value="">Selecciona</option>
              <option value="financiado">Financiado</option>
              <option value="fraccionado">Fraccionado</option>
              <option value="contado">Al contado</option>
              <option value="plan 69">Plan 69</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Comentarios</label>
            <textarea name="comentarios" className="w-full border rounded-md px-3 py-2" rows={3} />
          </div>

          {error && <p className="text-red-600">{error}</p>}
          {msg && <p className="text-green-600">{msg}</p>}

          <button type="submit" disabled={loading} className="w-full bg-[#d4551f] text-white py-2 rounded-md">
            {loading ? 'Registrando...' : 'Registrar'}
          </button>
        </form>
      </div>
    </main>
  );
}